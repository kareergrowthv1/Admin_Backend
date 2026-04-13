const db = require('./src/config/db');

async function checkDbs() {
  try {
    await db.initializePool();
    const email = 'sharanmneeli09@gmail.com'; // Testing with this email found earlier
    
    console.log('--- candidates_db ---');
    const rows1 = await db.query('SELECT candidate_name, email, resume_url FROM candidates_db.college_candidates WHERE email = ?', [email]);
    console.log(JSON.stringify(rows1, null, 2));
    
    console.log('--- qwikhire_mnnbl6li ---');
    const rows2 = await db.query('SELECT candidate_name, email, resume_url FROM qwikhire_mnnbl6li.college_candidates WHERE email = ?', [email]);
    console.log(JSON.stringify(rows2, null, 2));
    
    process.exit(0);
  } catch (err) {
    console.error(err);
    process.exit(1);
  }
}

checkDbs();
