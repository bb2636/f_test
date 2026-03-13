const { Pool } = require('pg');

async function copyDevToProd() {
  console.log('=== Copying Development DB to Production DB (v3) ===\n');
  
  const devDbUrl = process.env.DEV_DATABASE_URL || process.env.DATABASE_URL;
  const prodDbUrl = process.env.PROD_DATABASE_URL;
  
  if (!devDbUrl || !prodDbUrl) {
    console.error('ERROR: Database URLs not set');
    process.exit(1);
  }
  
  const prodPoolUrl = prodDbUrl.replace('.us-east-2', '-pooler.us-east-2');
  const devPoolUrl = devDbUrl.replace('.us-east-2', '-pooler.us-east-2');
  
  const devPool = new Pool({ connectionString: devPoolUrl, max: 5, ssl: { rejectUnauthorized: false } });
  const prodPool = new Pool({ connectionString: prodPoolUrl, max: 5, ssl: { rejectUnauthorized: false } });
  
  // User ID columns that need remapping
  const userIdColumns = ['created_by', 'manager_id', 'assigned_to', 'assessor_id', 'uploaded_by', 'author_id'];
  
  try {
    const devClient = await devPool.connect();
    const prodClient = await prodPool.connect();
    
    try {
      // Build user ID mapping
      console.log('📋 Building user ID mapping...');
      const devUsers = await devClient.query('SELECT id, username FROM users');
      const prodUsers = await prodClient.query('SELECT id, username FROM users');
      
      const userIdMap = {};
      for (const devUser of devUsers.rows) {
        const prodUser = prodUsers.rows.find(p => p.username === devUser.username);
        if (prodUser) {
          userIdMap[devUser.id] = prodUser.id;
        }
      }
      console.log(`   ✅ Mapped ${Object.keys(userIdMap).length} users\n`);
      
      const mapUserId = (devId) => devId ? (userIdMap[devId] || devId) : null;
      
      // Get common columns between dev and prod for a table
      async function getCommonColumns(tableName) {
        const devCols = await devClient.query(
          `SELECT column_name FROM information_schema.columns WHERE table_name = $1`,
          [tableName]
        );
        const prodCols = await prodClient.query(
          `SELECT column_name FROM information_schema.columns WHERE table_name = $1`,
          [tableName]
        );
        
        const devColSet = new Set(devCols.rows.map(r => r.column_name));
        const prodColSet = new Set(prodCols.rows.map(r => r.column_name));
        
        return [...devColSet].filter(c => prodColSet.has(c));
      }
      
      // Copy table function
      async function copyTable(tableName) {
        console.log(`📦 Copying ${tableName}...`);
        
        const commonCols = await getCommonColumns(tableName);
        if (commonCols.length === 0) {
          console.log(`   ⚠️ No common columns found, skipping`);
          return;
        }
        
        const colList = commonCols.map(c => `"${c}"`).join(', ');
        const devData = await devClient.query(`SELECT ${colList} FROM ${tableName}`);
        
        if (devData.rows.length === 0) {
          console.log(`   ⏭️ No data, skipping`);
          return;
        }
        
        console.log(`   📊 Found ${devData.rows.length} rows, ${commonCols.length} columns`);
        
        let inserted = 0, skipped = 0, errors = 0;
        
        for (const row of devData.rows) {
          try {
            // Check if exists
            const exists = await prodClient.query(`SELECT id FROM ${tableName} WHERE id = $1`, [row.id]);
            if (exists.rows.length > 0) {
              skipped++;
              continue;
            }
            
            // Map user ID columns
            const mappedRow = { ...row };
            for (const col of userIdColumns) {
              if (mappedRow[col]) {
                mappedRow[col] = mapUserId(mappedRow[col]);
              }
            }
            
            const values = commonCols.map(c => mappedRow[c]);
            const placeholders = commonCols.map((_, i) => `$${i + 1}`).join(', ');
            
            await prodClient.query(
              `INSERT INTO ${tableName} (${colList}) VALUES (${placeholders}) ON CONFLICT (id) DO NOTHING`,
              values
            );
            inserted++;
          } catch (err) {
            errors++;
            if (errors <= 2) {
              console.log(`   ⚠️ Error: ${err.message.substring(0, 100)}`);
            }
          }
        }
        
        console.log(`   ✅ Inserted: ${inserted}, Skipped: ${skipped}${errors > 0 ? `, Errors: ${errors}` : ''}\n`);
      }
      
      // Copy tables in order
      await copyTable('cases');
      await copyTable('drawings');
      await copyTable('case_documents');
      await copyTable('estimates');
      await copyTable('estimate_rows');
      await copyTable('labor_costs');
      await copyTable('field_survey_data');
      
      console.log('=== Copy Complete! ===');
      
    } finally {
      devClient.release();
      prodClient.release();
    }
  } catch (error) {
    console.error('❌ Error:', error.message);
    process.exit(1);
  } finally {
    await devPool.end();
    await prodPool.end();
  }
}

copyDevToProd();
