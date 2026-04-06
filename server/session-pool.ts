import { Pool, neonConfig } from '@neondatabase/serverless';
import ws from "ws";

neonConfig.webSocketConstructor = ws;

const isProduction = process.env.NODE_ENV === 'production' || process.env.REPLIT_DEPLOYMENT === '1';
const sessionDbUrl = isProduction
  ? process.env.PROD_DATABASE_URL
  : process.env.DEV_DATABASE_URL;

let _sessionPool: Pool | null = null;

export function getSessionPool(): Pool {
  if (!_sessionPool) {
    _sessionPool = new Pool({
      connectionString: sessionDbUrl,
      max: 5,
      connectionTimeoutMillis: 10000,
      idleTimeoutMillis: 20000,
      maxUses: 7500,
      allowExitOnIdle: false,
    });

    _sessionPool.on('error', (err: Error) => {
      console.error('[SESSION-POOL] Background error (connection recycled):', err.message);
    });

    _sessionPool.on('connect', (client: any) => {
      client.on('error', (err: Error) => {
        console.error('[SESSION-POOL] Client error:', err.message);
      });
    });
  }
  return _sessionPool;
}

export function setSessionPool(pool: Pool) {
  _sessionPool = pool;
}
