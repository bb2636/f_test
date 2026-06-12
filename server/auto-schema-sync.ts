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
      `CREATE TABLE IF NOT EXISTS notice_reads (
        id varchar PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id varchar NOT NULL REFERENCES users(id),
        notice_id varchar NOT NULL REFERENCES notices(id) ON DELETE CASCADE,
        created_at timestamp DEFAULT NOW() NOT NULL,
        CONSTRAINT notice_reads_user_id_notice_id_unique UNIQUE (user_id, notice_id)
      )`,
      // ========== [accidentCause DB-level 보호 트리거 2026-05-19] ==========
      // 사용자 보고: 입력한 사고원인이 반복적으로 사라짐.
      // 코드 레벨 가드(updateCase/updateCaseFieldSurvey/syncFieldSurvey)는 이미
      // 존재하지만, 직접 SQL/알 수 없는 미래 경로/raw db.update를 막지 못함.
      // BEFORE UPDATE 트리거로 DB 자체에서 "비어있지 않던 값을 빈값으로 덮어쓰는"
      // 시도를 자동 복원(silent rollback)하고 NOTICE 로그를 남긴다.
      // 정당한 삭제(관리자가 명시적으로 비우는 경우)는 별도의 SET LOCAL을 통한
      // 우회로(allow_accident_cause_clear=on)로만 가능.
      `CREATE OR REPLACE FUNCTION protect_accident_cause()
       RETURNS TRIGGER AS $$
       DECLARE
         allow_clear TEXT;
       BEGIN
         IF OLD.accident_cause IS NOT NULL
            AND btrim(OLD.accident_cause) <> ''
            AND (NEW.accident_cause IS NULL OR btrim(NEW.accident_cause) = '')
         THEN
           BEGIN
             allow_clear := current_setting('app.allow_accident_cause_clear', true);
           EXCEPTION WHEN OTHERS THEN
             allow_clear := NULL;
           END;
           IF allow_clear IS DISTINCT FROM 'on' THEN
             RAISE NOTICE '[protect_accident_cause] BLOCKED clear attempt on case % (caseNumber=%): keeping old value', OLD.id, OLD.case_number;
             NEW.accident_cause := OLD.accident_cause;
           END IF;
         END IF;
         RETURN NEW;
       END;
       $$ LANGUAGE plpgsql`,
      `DROP TRIGGER IF EXISTS trg_protect_accident_cause ON cases`,
      `CREATE TRIGGER trg_protect_accident_cause
       BEFORE UPDATE ON cases
       FOR EACH ROW
       EXECUTE FUNCTION protect_accident_cause()`,
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
