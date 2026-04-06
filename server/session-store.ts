import { pool } from "./db";
import { withTimeout, SESSION_OP_TIMEOUT } from "./user-columns";

export async function setCurrentSession(userId: string, sessionId: string): Promise<void> {
  await withTimeout(
    pool.query(
      `UPDATE users SET current_session_id = $1, last_login_at = $2 WHERE id = $3`,
      [sessionId, new Date().toISOString(), userId]
    ),
    SESSION_OP_TIMEOUT,
    "setCurrentSession",
  );
}

export async function getCurrentSessionId(userId: string): Promise<string | null> {
  const result = await withTimeout(
    pool.query(
      `SELECT current_session_id FROM users WHERE id = $1`,
      [userId]
    ),
    SESSION_OP_TIMEOUT,
    "getCurrentSessionId",
  );
  return result.rows[0]?.current_session_id || null;
}

export async function clearCurrentSession(userId: string): Promise<void> {
  await withTimeout(
    pool.query(
      `UPDATE users SET current_session_id = NULL WHERE id = $1`,
      [userId]
    ),
    SESSION_OP_TIMEOUT,
    "clearCurrentSession",
  );
}

export async function clearSessionById(sessionId: string): Promise<string | null> {
  const result = await withTimeout(
    pool.query(
      `UPDATE users SET current_session_id = NULL WHERE current_session_id = $1 RETURNING id`,
      [sessionId]
    ),
    SESSION_OP_TIMEOUT,
    "clearSessionById",
  );
  return result.rows[0]?.id || null;
}

export async function destroyPgSession(sessionPool: any, sid: string): Promise<void> {
  try {
    await withTimeout(
      sessionPool.query(`DELETE FROM session WHERE sid = $1`, [sid]),
      SESSION_OP_TIMEOUT,
      "destroyPgSession",
    );
  } catch (err: any) {
    console.error("[SESSION] Failed to destroy PG session:", sid, err.message);
  }
}
