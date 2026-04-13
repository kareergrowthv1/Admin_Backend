const db = require('./src/config/db');

async function checkCandidates() {
  try {
    await db.initializePool();
    const rows = await db.query('SELECT * FROM candidates_db.college_candidates LIMIT 10');
    console.log(JSON.stringify(rows, null, 2));
    process.exit(0);
  } catch (err) {
    console.error(err);
    process.exit(1);
  }
}

checkCandidates();
