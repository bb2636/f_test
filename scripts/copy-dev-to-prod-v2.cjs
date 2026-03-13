const { Pool } = require('pg');

async function copyDevToProd() {
  console.log('=== Copying Development DB to Production DB (v2) ===\n');
  
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
  
  try {
    const devClient = await devPool.connect();
    const prodClient = await prodPool.connect();
    
    try {
      // Step 1: Build user ID mapping (dev username -> prod user id)
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
      
      // Helper function to map user IDs
      const mapUserId = (devId) => {
        if (!devId) return null;
        return userIdMap[devId] || null;
      };
      
      // Step 2: Copy cases with mapped user IDs
      console.log('📦 Copying cases...');
      const devCases = await devClient.query('SELECT * FROM cases');
      let casesInserted = 0;
      
      for (const c of devCases.rows) {
        try {
          // Check if case already exists
          const exists = await prodClient.query('SELECT id FROM cases WHERE id = $1', [c.id]);
          if (exists.rows.length > 0) continue;
          
          // Map user IDs
          const mappedCase = {
            ...c,
            created_by: mapUserId(c.created_by),
            manager_id: mapUserId(c.manager_id),
            assigned_to: mapUserId(c.assigned_to),
            assessor_id: mapUserId(c.assessor_id),
            investigator_id: mapUserId(c.investigator_id)
          };
          
          const columns = Object.keys(mappedCase).filter(k => mappedCase[k] !== undefined);
          const values = columns.map(k => mappedCase[k]);
          const placeholders = columns.map((_, i) => `$${i + 1}`).join(', ');
          const columnNames = columns.map(c => `"${c}"`).join(', ');
          
          await prodClient.query(
            `INSERT INTO cases (${columnNames}) VALUES (${placeholders}) ON CONFLICT (id) DO NOTHING`,
            values
          );
          casesInserted++;
        } catch (err) {
          console.log(`   ⚠️ Case error: ${err.message.substring(0, 80)}`);
        }
      }
      console.log(`   ✅ Inserted ${casesInserted} cases\n`);
      
      // Step 3: Copy drawings
      console.log('📦 Copying drawings...');
      const devDrawings = await devClient.query('SELECT * FROM drawings');
      let drawingsInserted = 0;
      
      for (const d of devDrawings.rows) {
        try {
          const exists = await prodClient.query('SELECT id FROM drawings WHERE id = $1', [d.id]);
          if (exists.rows.length > 0) continue;
          
          // Handle JSON fields properly
          const mappedDrawing = {
            ...d,
            created_by: mapUserId(d.created_by),
            images: typeof d.images === 'string' ? d.images : JSON.stringify(d.images || []),
            rectangles: typeof d.rectangles === 'string' ? d.rectangles : JSON.stringify(d.rectangles || []),
            leak_markers: typeof d.leak_markers === 'string' ? d.leak_markers : JSON.stringify(d.leak_markers || [])
          };
          
          const columns = Object.keys(mappedDrawing).filter(k => mappedDrawing[k] !== undefined);
          const values = columns.map(k => mappedDrawing[k]);
          const placeholders = columns.map((_, i) => `$${i + 1}`).join(', ');
          const columnNames = columns.map(c => `"${c}"`).join(', ');
          
          await prodClient.query(
            `INSERT INTO drawings (${columnNames}) VALUES (${placeholders}) ON CONFLICT (id) DO NOTHING`,
            values
          );
          drawingsInserted++;
        } catch (err) {
          console.log(`   ⚠️ Drawing error: ${err.message.substring(0, 80)}`);
        }
      }
      console.log(`   ✅ Inserted ${drawingsInserted} drawings\n`);
      
      // Step 4: Copy case_documents
      console.log('📦 Copying case_documents...');
      const devDocs = await devClient.query('SELECT * FROM case_documents');
      let docsInserted = 0;
      
      for (const d of devDocs.rows) {
        try {
          const exists = await prodClient.query('SELECT id FROM case_documents WHERE id = $1', [d.id]);
          if (exists.rows.length > 0) continue;
          
          const mappedDoc = {
            ...d,
            uploaded_by: mapUserId(d.uploaded_by)
          };
          
          const columns = Object.keys(mappedDoc).filter(k => mappedDoc[k] !== undefined);
          const values = columns.map(k => mappedDoc[k]);
          const placeholders = columns.map((_, i) => `$${i + 1}`).join(', ');
          const columnNames = columns.map(c => `"${c}"`).join(', ');
          
          await prodClient.query(
            `INSERT INTO case_documents (${columnNames}) VALUES (${placeholders}) ON CONFLICT (id) DO NOTHING`,
            values
          );
          docsInserted++;
        } catch (err) {
          console.log(`   ⚠️ Doc error: ${err.message.substring(0, 80)}`);
        }
      }
      console.log(`   ✅ Inserted ${docsInserted} documents\n`);
      
      // Step 5: Copy excel_data (노무비/자재비)
      console.log('📦 Copying excel_data...');
      const devExcel = await devClient.query('SELECT * FROM excel_data');
      let excelInserted = 0;
      
      for (const e of devExcel.rows) {
        try {
          const exists = await prodClient.query('SELECT id FROM excel_data WHERE id = $1', [e.id]);
          if (exists.rows.length > 0) continue;
          
          const mappedExcel = {
            ...e,
            headers: typeof e.headers === 'string' ? e.headers : JSON.stringify(e.headers || []),
            data: typeof e.data === 'string' ? e.data : JSON.stringify(e.data || [])
          };
          
          const columns = Object.keys(mappedExcel).filter(k => mappedExcel[k] !== undefined);
          const values = columns.map(k => mappedExcel[k]);
          const placeholders = columns.map((_, i) => `$${i + 1}`).join(', ');
          const columnNames = columns.map(c => `"${c}"`).join(', ');
          
          await prodClient.query(
            `INSERT INTO excel_data (${columnNames}) VALUES (${placeholders}) ON CONFLICT (id) DO NOTHING`,
            values
          );
          excelInserted++;
        } catch (err) {
          console.log(`   ⚠️ Excel error: ${err.message.substring(0, 80)}`);
        }
      }
      console.log(`   ✅ Inserted ${excelInserted} excel data\n`);
      
      // Step 6: Copy notices
      console.log('📦 Copying notices...');
      const devNotices = await devClient.query('SELECT * FROM notices');
      let noticesInserted = 0;
      
      for (const n of devNotices.rows) {
        try {
          const exists = await prodClient.query('SELECT id FROM notices WHERE id = $1', [n.id]);
          if (exists.rows.length > 0) continue;
          
          const mappedNotice = {
            ...n,
            author_id: mapUserId(n.author_id)
          };
          
          const columns = Object.keys(mappedNotice).filter(k => mappedNotice[k] !== undefined);
          const values = columns.map(k => mappedNotice[k]);
          const placeholders = columns.map((_, i) => `$${i + 1}`).join(', ');
          const columnNames = columns.map(c => `"${c}"`).join(', ');
          
          await prodClient.query(
            `INSERT INTO notices (${columnNames}) VALUES (${placeholders}) ON CONFLICT (id) DO NOTHING`,
            values
          );
          noticesInserted++;
        } catch (err) {
          console.log(`   ⚠️ Notice error: ${err.message.substring(0, 80)}`);
        }
      }
      console.log(`   ✅ Inserted ${noticesInserted} notices\n`);
      
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
