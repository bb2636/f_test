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
      max: 10,
      connectionTimeoutMillis: 10000,
    });
  }
  return _sessionPool;
}

export function setSessionPool(pool: Pool) {
  _sessionPool = pool;
}
