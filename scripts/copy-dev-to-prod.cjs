const { Pool } = require('pg');

async function copyDevToProd() {
  console.log('=== Copying Development DB to Production DB ===\n');
  
  const devDbUrl = process.env.DEV_DATABASE_URL || process.env.DATABASE_URL;
  const prodDbUrl = process.env.PROD_DATABASE_URL;
  
  if (!devDbUrl) {
    console.error('ERROR: DEV_DATABASE_URL or DATABASE_URL is not set');
    process.exit(1);
  }
  
  if (!prodDbUrl) {
    console.error('ERROR: PROD_DATABASE_URL is not set');
    process.exit(1);
  }
  
  // Use connection pooler for production
  const prodPoolUrl = prodDbUrl.replace('.us-east-2', '-pooler.us-east-2');
  const devPoolUrl = devDbUrl.replace('.us-east-2', '-pooler.us-east-2');
  
  const devPool = new Pool({ 
    connectionString: devPoolUrl,
    max: 5,
    ssl: { rejectUnauthorized: false }
  });
  
  const prodPool = new Pool({ 
    connectionString: prodPoolUrl,
    max: 5,
    ssl: { rejectUnauthorized: false }
  });
  
  try {
    const devClient = await devPool.connect();
    const prodClient = await prodPool.connect();
    
    try {
      // Tables to copy (in order of dependencies)
      const tablesToCopy = [
        'users',
        'cases',
        'progress_updates',
        'drawings',
        'shared_drawings',
        'field_survey_data',
        'case_documents',
        'estimates',
        'estimate_rows',
        'labor_costs',
        'materials',
        'master_data',
        'excel_data',
        'notices',
        'inquiries',
        'user_favorites'
      ];
      
      for (const table of tablesToCopy) {
        console.log(`\n📦 Processing table: ${table}`);
        
        // Get all data from dev
        const devData = await devClient.query(`SELECT * FROM ${table}`);
        
        if (devData.rows.length === 0) {
          console.log(`   ⏭️ No data in ${table}, skipping`);
          continue;
        }
        
        console.log(`   📊 Found ${devData.rows.length} rows in dev`);
        
        // Get column names
        const columns = Object.keys(devData.rows[0]);
        
        // Check existing data in prod (to avoid duplicates)
        const prodData = await prodClient.query(`SELECT id FROM ${table}`);
        const existingIds = new Set(prodData.rows.map(r => r.id));
        
        // Filter out existing records
        const newRows = devData.rows.filter(row => !existingIds.has(row.id));
        
        if (newRows.length === 0) {
          console.log(`   ⏭️ All ${devData.rows.length} rows already exist in prod`);
          continue;
        }
        
        console.log(`   ➕ Inserting ${newRows.length} new rows`);
        
        // Insert each row
        let inserted = 0;
        let errors = 0;
        
        for (const row of newRows) {
          try {
            const values = columns.map(col => row[col]);
            const placeholders = columns.map((_, i) => `$${i + 1}`).join(', ');
            const columnNames = columns.map(c => `"${c}"`).join(', ');
            
            await prodClient.query(
              `INSERT INTO ${table} (${columnNames}) VALUES (${placeholders}) ON CONFLICT (id) DO NOTHING`,
              values
            );
            inserted++;
          } catch (err) {
            errors++;
            if (errors <= 3) {
              console.log(`   ⚠️ Error inserting row: ${err.message.substring(0, 100)}`);
            }
          }
        }
        
        console.log(`   ✅ Inserted ${inserted} rows${errors > 0 ? `, ${errors} errors` : ''}`);
      }
      
      console.log('\n=== Copy Complete! ===');
      
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
