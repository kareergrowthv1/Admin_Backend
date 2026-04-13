const db = require('./src/config/db');

async function checkCandidate() {
  try {
    await db.initializePool();
    const email = 'sharanmneeli09@gmail.com';
    const rows = await db.query('SELECT * FROM qwikhire_mnnbl6li.college_candidates WHERE email = ?', [email]);
    console.log(JSON.stringify(rows[0], null, 2));
    process.exit(0);
  } catch (err) {
    console.error(err);
    process.exit(1);
  }
}

checkCandidate();
