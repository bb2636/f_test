const { Pool } = require('pg');

async function setAdminPermissions() {
  console.log('=== Setting Admin Full Permissions in Production DB ===');
  
  const prodDbUrl = process.env.PROD_DATABASE_URL;
  
  if (!prodDbUrl) {
    console.error('ERROR: PROD_DATABASE_URL is not set');
    process.exit(1);
  }
  
  // Use connection pooler for scripts
  const poolUrl = prodDbUrl.replace('.us-east-2', '-pooler.us-east-2');
  
  const pool = new Pool({ 
    connectionString: poolUrl,
    max: 5,
    ssl: { rejectUnauthorized: false }
  });
  
  const allPermissions = {
    "홈": {"enabled": true, "items": {}},
    "새로운접수": {"enabled": true, "items": {}},
    "현장조사": {"enabled": true, "items": {"현장입력": true, "도면작성": true, "증빙자료 업로드": true, "견적서 작성": true, "보고서 작성": true}},
    "종합진행관리": {"enabled": true, "items": {}},
    "정산 및 통계": {"enabled": true, "items": {"통계": true, "정산조회": true, "정산하기": true}},
    "관리자 설정": {"enabled": true, "items": {"계정관리": true, "DB관리": true, "기준정보 관리": true, "접근권한관리": true}}
  };
  
  const permissionsJson = JSON.stringify(allPermissions);
  const now = new Date().toISOString();
  
  try {
    const client = await pool.connect();
    
    try {
      // Set permissions for all roles
      const roles = ['관리자', '협력사', '보험사', '심사사', '조사사', '의뢰사'];
      
      for (const role of roles) {
        const roleCheck = await client.query(
          `SELECT * FROM role_permissions WHERE role_name = $1`,
          [role]
        );
        
        if (roleCheck.rows.length > 0) {
          await client.query(
            `UPDATE role_permissions SET permissions = $1, updated_at = $2 WHERE role_name = $3`,
            [permissionsJson, now, role]
          );
          console.log(`✅ Updated permissions for ${role}`);
        } else {
          await client.query(
            `INSERT INTO role_permissions (role_name, permissions, created_at, updated_at) VALUES ($1, $2, $3, $4)`,
            [role, permissionsJson, now, now]
          );
          console.log(`✅ Created permissions for ${role}`);
        }
      }
      
      console.log('\n=== All roles now have full access permissions! ===');
      
    } finally {
      client.release();
    }
  } catch (error) {
    console.error('❌ Error:', error.message);
    console.error('Full error:', error);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

setAdminPermissions();
