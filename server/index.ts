import express, { type Request, Response, NextFunction } from "express";
import session from "express-session";
import connectPgSimple from "connect-pg-simple";
import { registerRoutes } from "./routes";
import { setupVite, serveStatic, log } from "./vite";
import { storage, warmUpUsersCache, warmUpCasesCache } from "./storage";
import { initializeEmailTransporter } from "./hiworks-email";
import { pool } from "./db";
import { Pool, neonConfig } from '@neondatabase/serverless';
import ws from "ws";
import { activeUserSessions } from "./session-store";

neonConfig.webSocketConstructor = ws;

const PgStore = connectPgSimple(session);

const app = express();

declare module 'http' {
  interface IncomingMessage {
    rawBody: unknown
  }
}

declare module 'express-session' {
  interface SessionData {
    userId: string;
    userRole: string;
    isSuperAdmin: boolean;
    rememberMe: boolean;
  }
}

const isProduction = process.env.NODE_ENV === 'production' || process.env.REPLIT_DEPLOYMENT === '1';

console.log("[SESSION CONFIG]", {
  nodeEnv: process.env.NODE_ENV,
  replitDeployment: process.env.REPLIT_DEPLOYMENT,
  isProduction,
  cookieSecure: isProduction,
});

if (isProduction) {
  app.set('trust proxy', 1);
  console.log("[SESSION] Trust proxy enabled for production");
}

const sessionDbUrl = isProduction
  ? process.env.PROD_DATABASE_URL
  : process.env.DEV_DATABASE_URL;

const sessionPool = new Pool({
  connectionString: sessionDbUrl,
  max: 10,
});

const SESSION_CACHE = new Map<string, { data: any; ts: number }>();
const SESSION_PENDING = new Map<string, Promise<session.SessionData | null | undefined>>();
const SESSION_CACHE_TTL = 60_000;

const pgStore = new PgStore({
  pool: sessionPool as any,
  tableName: 'session',
  createTableIfMissing: true,
  pruneSessionInterval: 60 * 15,
});

const originalGet = pgStore.get.bind(pgStore);
const originalSet = pgStore.set.bind(pgStore);
const originalDestroy = pgStore.destroy.bind(pgStore);

pgStore.get = function (sid: string, callback: (err: any, session?: session.SessionData | null) => void) {
  const cached = SESSION_CACHE.get(sid);
  if (cached && (Date.now() - cached.ts) < SESSION_CACHE_TTL) {
    return callback(null, cached.data);
  }

  const pending = SESSION_PENDING.get(sid);
  if (pending) {
    pending.then(data => callback(null, data)).catch(err => callback(err));
    return;
  }

  const promise = new Promise<session.SessionData | null | undefined>((resolve, reject) => {
    originalGet(sid, (err: any, sessionData: session.SessionData | null | undefined) => {
      SESSION_PENDING.delete(sid);
      if (err) {
        reject(err);
        return;
      }
      if (sessionData) {
        SESSION_CACHE.set(sid, { data: sessionData, ts: Date.now() });
      }
      resolve(sessionData);
    });
  });

  SESSION_PENDING.set(sid, promise);
  promise.then(data => callback(null, data)).catch(err => callback(err));
};

pgStore.set = function (sid: string, sessionData: session.SessionData, callback?: (err?: any) => void) {
  SESSION_CACHE.set(sid, { data: sessionData, ts: Date.now() });
  originalSet(sid, sessionData, (err: any) => {
    if (err) console.error("[SESSION] PG set error:", err);
    if (callback) callback(err);
  });
};

const originalTouch = pgStore.touch?.bind(pgStore);
const SESSION_TOUCH_TIMES = new Map<string, number>();
const SESSION_TOUCH_INTERVAL = 5 * 60 * 1000;

if (originalTouch) {
  pgStore.touch = function (sid: string, sess: session.SessionData, callback?: (err?: any) => void) {
    const now = Date.now();
    const lastTouched = SESSION_TOUCH_TIMES.get(sid) || 0;
    if ((now - lastTouched) < SESSION_TOUCH_INTERVAL) {
      if (callback) callback();
      return;
    }
    SESSION_TOUCH_TIMES.set(sid, now);
    originalTouch(sid, sess, callback);
  };
}

pgStore.destroy = function (sid: string, callback?: (err?: any) => void) {
  SESSION_CACHE.delete(sid);
  SESSION_PENDING.delete(sid);
  SESSION_TOUCH_TIMES.delete(sid);
  
        // 세션 파괴 시 activeUserSessions에서도 제거
        // sessionId로 userId를 찾아서 제거
        for (const [userId, sessionId] of Array.from(activeUserSessions.entries())) {
          if (sessionId === sid) {
            activeUserSessions.delete(userId);
            console.log("[SESSION] Removed from activeUserSessions on destroy:", { userId, sessionId: sid });
            break;
          }
        }
  
  originalDestroy(sid, callback);
};

app.use(session({
  secret: (() => {
    const secret = process.env.SESSION_SECRET;
    if (!secret && isProduction) {
      throw new Error("SESSION_SECRET must be set in production environment.");
    }
    return secret || 'dev-only-session-secret-not-for-production';
  })(),
  resave: false,
  saveUninitialized: false,
  proxy: isProduction,
  store: pgStore,
  cookie: {
    secure: isProduction,
    httpOnly: true,
    maxAge: 24 * 60 * 60 * 1000,
    sameSite: isProduction ? 'none' : 'lax',
  },
}));

app.get("/_health", (_req, res) => {
  res.status(200).send("OK");
});

app.use(express.json({
  limit: '500mb',
  verify: (req, _res, buf) => {
    req.rawBody = buf;
  }
}));
app.use(express.urlencoded({ extended: false, limit: '500mb' }));

app.use((req, res, next) => {
  const start = Date.now();
  const path = req.path;
  let capturedJsonResponse: Record<string, any> | undefined = undefined;

  const originalResJson = res.json;
  res.json = function (bodyJson, ...args) {
    capturedJsonResponse = bodyJson;
    return originalResJson.apply(res, [bodyJson, ...args]);
  };

  res.on("finish", () => {
    const duration = Date.now() - start;
    if (path.startsWith("/api")) {
      let logLine = `${req.method} ${path} ${res.statusCode} in ${duration}ms`;
      if (capturedJsonResponse) {
        logLine += ` :: ${JSON.stringify(capturedJsonResponse)}`;
      }

      if (logLine.length > 80) {
        logLine = logLine.slice(0, 79) + "…";
      }

      log(logLine);
    }
  });

  next();
});

(async () => {
  const server = await registerRoutes(app);

  app.use((err: any, _req: Request, res: Response, _next: NextFunction) => {
    const status = err.status || err.statusCode || 500;
    const message = err.message || "Internal Server Error";

    res.status(status).json({ message });
    console.error("[ERROR]", err);
  });

  if (isProduction) {
    serveStatic(app);
  } else {
    await setupVite(app, server);
  }

  const port = parseInt(process.env.PORT || '5000', 10);
  
  server.timeout = 300000;
  server.keepAliveTimeout = 120000;
  server.headersTimeout = 310000;
  
  server.listen({
    port,
    host: "0.0.0.0",
    reusePort: true,
  }, () => {
    log(`serving on port ${port} (timeout: ${server.timeout}ms)`);

    warmUpUsersCache();
    warmUpCasesCache();

    (async () => {
      try {
        const migratedCount = await storage.migrateExistingCaseDates();
        if (migratedCount > 0) {
          log(`Date migration completed: ${migratedCount} cases updated`);
        }
      } catch (error) {
        console.error("Date migration failed:", error);
      }

      initializeEmailTransporter();
    })();
  });
})();
