import express, { type Request, Response, NextFunction } from "express";
import session from "express-session";
import connectPgSimple from "connect-pg-simple";
import { registerRoutes } from "./routes";
import { setupVite, serveStatic, log } from "./vite";
import { storage, warmUpUsersCache, warmUpCasesCache } from "./storage";
import { initializeEmailTransporter } from "./hiworks-email";
import { runPiiBackfill } from "./backfill-pii";
import { pool, dbPoolReady } from "./db";
import { clearSessionById } from "./session-store";
import { getSessionPool } from "./session-pool";

process.on("unhandledRejection", (reason, promise) => {
  console.error("[FATAL] Unhandled Promise Rejection:", reason);
});

process.on("uncaughtException", (err) => {
  console.error("[FATAL] Uncaught Exception:", err);
});

const PgStore = connectPgSimple(session);

const app = express();

declare module "http" {
  interface IncomingMessage {
    rawBody: unknown;
  }
}

declare module "express-session" {
  interface SessionData {
    userId: string;
    userRole: string;
    isSuperAdmin: boolean;
  }
}

const isProduction =
  process.env.NODE_ENV === "production" ||
  process.env.REPLIT_DEPLOYMENT === "1";

console.log("[SESSION CONFIG]", {
  nodeEnv: process.env.NODE_ENV,
  replitDeployment: process.env.REPLIT_DEPLOYMENT,
  isProduction,
  cookieSecure: isProduction,
});

if (isProduction) {
  app.set("trust proxy", 1);
  console.log("[SESSION] Trust proxy enabled for production");
}

const sessionPool = getSessionPool();

const sessionPoolReady = sessionPool
  .query("SELECT 1")
  .then(() => {
    console.log("[SESSION] DB pool warmed up (initial connection)");
    return sessionPool.query(`
    CREATE TABLE IF NOT EXISTS "session" (
      "sid" varchar NOT NULL COLLATE "default",
      "sess" json NOT NULL,
      "expire" timestamp(6) NOT NULL,
      CONSTRAINT "session_pkey" PRIMARY KEY ("sid")
    ) WITH (OIDS=FALSE)
  `);
  })
  .then(() => {
    return sessionPool.query("SELECT COUNT(*) FROM session");
  })
  .then((result: any) => {
    console.log(
      `[SESSION] Session table ready (${result?.rows?.[0]?.count || 0} sessions)`,
    );
  })
  .catch((err: any) => {
    console.error("[SESSION] DB pool warmup failed:", err.message);
  });

const SESSION_CACHE = new Map<string, { data: any; ts: number }>();
const SESSION_PENDING = new Map<
  string,
  Promise<session.SessionData | null | undefined>
>();
const SESSION_CACHE_TTL = 60_000;

const pgStore = new PgStore({
  pool: sessionPool as any,
  tableName: "session",
  createTableIfMissing: true,
  pruneSessionInterval: false,
});

const originalSet = pgStore.set.bind(pgStore);
const originalDestroy = pgStore.destroy.bind(pgStore);

pgStore.get = function (
  sid: string,
  callback: (err: any, session?: session.SessionData | null) => void,
) {
  const cached = SESSION_CACHE.get(sid);
  if (cached && Date.now() - cached.ts < SESSION_CACHE_TTL) {
    return callback(null, cached.data);
  }

  const pending = SESSION_PENDING.get(sid);
  if (pending) {
    pending.then((data) => callback(null, data)).catch((err) => callback(err));
    return;
  }

  const promise = new Promise<session.SessionData | null | undefined>(
    (resolve, reject) => {
      sessionPool.query(
        'SELECT sess FROM session WHERE sid = $1',
        [sid],
        (err: any, result: any) => {
          SESSION_PENDING.delete(sid);
          if (err) {
            reject(err);
            return;
          }
          const sessionData = result?.rows?.[0]?.sess || null;
          if (sessionData) {
            SESSION_CACHE.set(sid, { data: sessionData, ts: Date.now() });
          }
          resolve(sessionData);
        },
      );
    },
  );

  SESSION_PENDING.set(sid, promise);
  promise.then((data) => callback(null, data)).catch((err) => callback(err));
};

pgStore.set = function (
  sid: string,
  sessionData: session.SessionData,
  callback?: (err?: any) => void,
) {
  SESSION_CACHE.set(sid, { data: sessionData, ts: Date.now() });
  originalSet(sid, sessionData, (err: any) => {
    if (err) console.error("[SESSION] PG set error:", err);
    if (callback) callback(err);
  });
};

pgStore.touch = function (
  _sid: string,
  _sess: session.SessionData,
  callback?: (err?: any) => void,
) {
  if (callback) callback();
};

pgStore.destroy = function (sid: string, callback?: (err?: any) => void) {
  SESSION_CACHE.delete(sid);
  SESSION_PENDING.delete(sid);

  clearSessionById(sid)
    .then((userId) => {
      if (userId) {
        console.log("[SESSION] Cleared current_session_id on destroy:", {
          userId,
          sessionId: sid,
        });
      }
    })
    .catch((err) => {
      console.error(
        "[SESSION] Failed to clear current_session_id:",
        err.message,
      );
    });

  originalDestroy(sid, callback);
};

app.use(
  session({
    secret: (() => {
      console.log("asdfasdf");
      const secret = process.env.SESSION_SECRET;
      if (!secret && isProduction) {
        throw new Error(
          "SESSION_SECRET must be set in production environment.",
        );
      }
      return secret || "dev-only-session-secret-not-for-production";
    })(),
    resave: false,
    saveUninitialized: false,
    rolling: true,
    proxy: isProduction,
    store: pgStore,
    cookie: {
      secure: isProduction,
      httpOnly: true,
      // maxAge: 60 * 1000,
      maxAge: 30 * 60 * 1000,
      sameSite: isProduction ? "none" : "lax",
    },
  }),
);

app.get("/_health", (_req, res) => {
  res.status(200).send("OK");
});

app.use(
  express.json({
    limit: "500mb",
    verify: (req, _res, buf) => {
      req.rawBody = buf;
    },
  }),
);
app.use(express.urlencoded({ extended: false, limit: "500mb" }));

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
  const warmupStart = Date.now();
  console.log("[STARTUP] Warming up database connections...");
  await Promise.all([dbPoolReady, sessionPoolReady]);
  console.log(
    `[STARTUP] Database connections ready (${Date.now() - warmupStart}ms)`,
  );

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

  const port = parseInt(process.env.PORT || "5000", 10);

  server.timeout = 300000;
  server.keepAliveTimeout = 120000;
  server.headersTimeout = 310000;

  server.listen(
    {
      port,
      host: "0.0.0.0",
      reusePort: true,
    },
    () => {
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

        if (process.env.PII_ENCRYPTION_KEY) {
          try {
            await runPiiBackfill();
          } catch (error) {
            console.error("[PII Backfill] Failed:", error);
          }
        } else {
          console.log(
            "[PII] PII_ENCRYPTION_KEY not set - encryption disabled (plaintext mode)",
          );
        }
      })();
    },
  );
})();
