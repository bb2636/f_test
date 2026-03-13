const { Pool, neonConfig } = require('@neondatabase/serverless');
const bcrypt = require('bcrypt');
const ws = require('ws');

neonConfig.webSocketConstructor = ws;

async function setup() {
  const pool = new Pool({ connectionString: process.env.DEV_DATABASE_URL });
  const client = await pool.connect();
  
  try {
    const passwordHash = bcrypt.hashSync('admin123', 10);
    
    // 1. Create users
    const now = new Date().toISOString();
    await client.query(`
      INSERT INTO users (id, username, password, name, role, phone, email, company, status, created_at)
      VALUES 
        (gen_random_uuid(), 'admin01', $1, '관리자', '관리자', '010-1234-5678', 'admin@test.com', 'FLOXN', 'active', $2),
        (gen_random_uuid(), 'partner01', $1, '협력사테스트', '협력사', '010-2222-3333', 'partner@test.com', '테스트협력사', 'active', $2),
        (gen_random_uuid(), 'insure01', $1, '보험사테스트', '보험사', '010-3333-4444', 'insure@test.com', '테스트보험사', 'active', $2)
      ON CONFLICT (username) DO NOTHING
    `, [passwordHash, now]);
    console.log('Users created');

    // 2. Create role permissions
    const permissions = {
      '관리자': JSON.stringify({
        "홈": {"enabled": true, "items": {}},
        "새로운접수": {"enabled": true, "items": {}},
        "종합진행관리": {"enabled": true, "items": {}},
        "정산 및 통계": {"enabled": true, "items": {}},
        "관리자 설정": {"enabled": true, "items": {}},
        "기준정보관리": {"enabled": true, "items": {}},
        "현장조사": {"enabled": true, "items": {"현장입력": true, "도면작성": true, "증빙자료 업로드": true, "견적서 작성": true, "보고서 작성": true}}
      }),
      '협력사': JSON.stringify({
        "홈": {"enabled": true, "items": {}},
        "종합진행관리": {"enabled": true, "items": {}},
        "현장조사": {"enabled": true, "items": {"현장입력": true, "도면작성": true, "증빙자료 업로드": true, "견적서 작성": true, "보고서 작성": true}}
      }),
      '보험사': JSON.stringify({
        "홈": {"enabled": true, "items": {}},
        "새로운접수": {"enabled": true, "items": {}},
        "종합진행관리": {"enabled": true, "items": {}},
        "정산 및 통계": {"enabled": true, "items": {}}
      }),
      '심사사': JSON.stringify({
        "홈": {"enabled": true, "items": {}},
        "새로운접수": {"enabled": true, "items": {}},
        "종합진행관리": {"enabled": true, "items": {}}
      }),
      '조사사': JSON.stringify({
        "홈": {"enabled": true, "items": {}},
        "종합진행관리": {"enabled": true, "items": {}}
      }),
      '의뢰사': JSON.stringify({
        "홈": {"enabled": true, "items": {}},
        "새로운접수": {"enabled": true, "items": {}},
        "종합진행관리": {"enabled": true, "items": {}}
      })
    };

    for (const [roleName, perms] of Object.entries(permissions)) {
      await client.query(`
        INSERT INTO role_permissions (id, role_name, permissions, created_at, updated_at)
        VALUES (gen_random_uuid(), $1, $2, $3, $3)
        ON CONFLICT (role_name) DO UPDATE SET permissions = $2, updated_at = $3
      `, [roleName, perms, now]);
    }
    console.log('Permissions created');

    console.log('Setup complete!');
    console.log('Login: admin01 / admin123');
  } finally {
    client.release();
    await pool.end();
  }
}

setup().catch(console.error);
