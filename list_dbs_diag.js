const db = require('./src/config/db');

async function listDbs() {
  try {
    await db.initializePool();
    const rows = await db.query('SHOW DATABASES');
    console.log(JSON.stringify(rows, null, 2));
    
    // Also check auth_db.users to see common clients
    const users = await db.authQuery('SELECT DISTINCT client FROM users WHERE client IS NOT NULL');
    console.log('Common clients:', JSON.stringify(users, null, 2));
    
    process.exit(0);
  } catch (err) {
    console.error(err);
    process.exit(1);
  }
}

listDbs();
