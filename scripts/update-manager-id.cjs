const { Pool, neonConfig } = require('@neondatabase/serverless');
const ws = require('ws');

neonConfig.webSocketConstructor = ws;

const pool = new Pool({
  connectionString: process.env.DEV_DATABASE_URL
});

async function update() {
  const client = await pool.connect();
  try {
    // 먼저 현재 상태 확인
    const before = await client.query(`
      SELECT case_number, manager_id, created_by FROM cases ORDER BY created_at DESC LIMIT 5
    `);
    console.log('Before update:', before.rows);
    
    // 업데이트
    const result = await client.query(`
      UPDATE cases 
      SET manager_id = created_by 
      WHERE manager_id IS NULL AND created_by IS NOT NULL
    `);
    console.log('Updated rows:', result.rowCount);
    
    // 업데이트 후 확인
    const after = await client.query(`
      SELECT case_number, manager_id, created_by FROM cases ORDER BY created_at DESC LIMIT 5
    `);
    console.log('After update:', after.rows);
  } finally {
    client.release();
    await pool.end();
  }
}

update().catch(console.error);
