import { Pool, neonConfig } from '@neondatabase/serverless';
import { drizzle } from 'drizzle-orm/neon-serverless';
import ws from "ws";
import * as schema from "@shared/schema";
import { types } from 'pg';

neonConfig.webSocketConstructor = ws;

// PostgreSQL real (float4) 타입 = OID 700을 소수점으로 파싱
types.setTypeParser(700, (val: string) => parseFloat(val));

// 환경에 따라 적절한 DB URL 선택
const isProduction = process.env.REPLIT_DEPLOYMENT === '1';

// 개발: DEV_DATABASE_URL, 프로덕션: PROD_DATABASE_URL
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

// DB 호스트 추출하여 로그에 표시
const hostMatch = databaseUrl.match(/@([^/]+)\//);
const dbHost = hostMatch ? hostMatch[1] : 'unknown';

console.log(`[DB] Connected to ${isProduction ? 'PRODUCTION' : 'DEVELOPMENT'} database (${dbHost})`);

export const pool = new Pool({ 
  connectionString: databaseUrl,
  max: 20,
});
export const db = drizzle({ client: pool, schema });
