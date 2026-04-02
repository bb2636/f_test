import { pool } from "./db";

export async function setCurrentSession(userId: string, sessionId: string): Promise<void> {
  await pool.query(
    `UPDATE users SET current_session_id = $1, last_login_at = $2 WHERE id = $3`,
    [sessionId, new Date().toISOString(), userId]
  );
}

export async function getCurrentSessionId(userId: string): Promise<string | null> {
  const result = await pool.query(
    `SELECT current_session_id FROM users WHERE id = $1`,
    [userId]
  );
  return result.rows[0]?.current_session_id || null;
}

export async function clearCurrentSession(userId: string): Promise<void> {
  await pool.query(
    `UPDATE users SET current_session_id = NULL WHERE id = $1`,
    [userId]
  );
}

export async function clearSessionById(sessionId: string): Promise<string | null> {
  const result = await pool.query(
    `UPDATE users SET current_session_id = NULL WHERE current_session_id = $1 RETURNING id`,
    [sessionId]
  );
  return result.rows[0]?.id || null;
}

export async function destroyPgSession(sessionPool: any, sid: string): Promise<void> {
  try {
    await sessionPool.query(`DELETE FROM session WHERE sid = $1`, [sid]);
  } catch (err: any) {
    console.error("[SESSION] Failed to destroy PG session:", sid, err.message);
  }
}
