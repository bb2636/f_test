import { Pool, neonConfig } from '@neondatabase/serverless';
import ws from "ws";

neonConfig.webSocketConstructor = ws;

const isProduction = process.env.REPLIT_DEPLOYMENT === '1' || process.env.NODE_ENV === 'production';

async function ensureColumns(label: string, dbUrl: string | undefined) {
  if (!dbUrl) {
    console.log(`[SCHEMA-SYNC] ${label}: No URL configured, skipping`);
    return;
  }

  const hostMatch = dbUrl.match(/@([^/]+)\//);
  const dbHost = hostMatch ? hostMatch[1] : 'unknown';

  const pool = new Pool({ connectionString: dbUrl, max: 1, connectionTimeoutMillis: 10000 });

  try {
    const migrations: string[] = [
      `ALTER TABLE notices ADD COLUMN IF NOT EXISTS images text`,
      `CREATE TABLE IF NOT EXISTS ilwidaega_link_settings (
        id SERIAL PRIMARY KEY,
        location TEXT NOT NULL,
        category TEXT NOT NULL,
        work_name TEXT NOT NULL,
        sort_order INTEGER NOT NULL DEFAULT 0,
        created_at TIMESTAMP DEFAULT NOW() NOT NULL,
        updated_at TIMESTAMP DEFAULT NOW() NOT NULL,
        UNIQUE(location, category, work_name)
      )`,
      `ALTER TABLE cases ADD COLUMN IF NOT EXISTS created_at_timestamp text`,
    ];

    let applied = 0;
    for (const sql of migrations) {
      try {
        await pool.query(sql);
        applied++;
      } catch (err: any) {
        if (err.code === '42P01') {
          console.log(`[SCHEMA-SYNC] ${label}: Table not found, skipping: ${sql.slice(0, 60)}`);
        } else {
          console.error(`[SCHEMA-SYNC] ${label}: Migration failed: ${err.message}`);
        }
      }
    }

    console.log(`[SCHEMA-SYNC] ${label} (${dbHost}): ${applied}/${migrations.length} migrations applied`);
  } catch (err: any) {
    console.error(`[SCHEMA-SYNC] ${label}: Connection failed - ${err.message}`);
  } finally {
    await pool.end().catch(() => {});
  }
}

export async function autoSchemaSync() {
  console.log("[SCHEMA-SYNC] Starting automatic schema synchronization...");

  const devUrl = process.env.DEV_DATABASE_URL;
  const prodUrl = process.env.PROD_DATABASE_URL;

  if (isProduction) {
    await ensureColumns("PROD", prodUrl);
  } else {
    await ensureColumns("DEV", devUrl);
    if (prodUrl) {
      await ensureColumns("PROD", prodUrl);
    }
  }

  console.log("[SCHEMA-SYNC] Done");
}
