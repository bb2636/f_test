import { Pool, neonConfig } from '@neondatabase/serverless';
import { drizzle } from 'drizzle-orm/neon-serverless';
import ws from "ws";
import * as schema from "@shared/schema";
import { types } from 'pg';

neonConfig.webSocketConstructor = ws;

types.setTypeParser(700, (val: string) => parseFloat(val));

const isProduction = process.env.REPLIT_DEPLOYMENT === '1';

const databaseUrl = isProduction 
  ? process.env.PROD_DATABASE_URL
  : process.env.DEV_DATABASE_URL;

if (!databaseUrl) {
  throw new Error(
    isProduction 
      ? "PROD_DATABASE_URL must be set for production deployment."
      : "DEV_DATABASE_URL must be set for development.",
  );
}

const hostMatch = databaseUrl.match(/@([^/]+)\//);
const dbHost = hostMatch ? hostMatch[1] : 'unknown';

console.log(`[DB] Connected to ${isProduction ? 'PRODUCTION' : 'DEVELOPMENT'} database (${dbHost})`);

export const pool = new Pool({ 
  connectionString: databaseUrl,
  max: 10,
  connectionTimeoutMillis: 10000,
  idleTimeoutMillis: 20000,
  maxUses: 7500,
  allowExitOnIdle: false,
});

pool.on('error', (err: Error) => {
  console.error('[DB] Pool background error (connection recycled):', err.message);
});

pool.on('connect', (client: any) => {
  client.on('error', (err: Error) => {
    console.error('[DB] Client error (will be removed from pool):', err.message);
  });
});

export const dbPoolReady = pool.query('SELECT 1').then(() => {
  console.log("[DB] Pool warmed up successfully");
}).catch((err: any) => {
  console.error("[DB] Pool warmup failed:", err.message);
});

export const db = drizzle({ client: pool, schema });
