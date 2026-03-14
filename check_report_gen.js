const m = require('mysql2/promise');
require('dotenv').config();

(async () => {
  const c = await m.createConnection({
    host: process.env.DB_HOST || 'localhost',
    port: 3306,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: 'candidates_db'
  });

  // Show all rows
  const [rows] = await c.execute(
    'SELECT HEX(id) hid, HEX(candidate_id) cid, HEX(position_id) pid, is_generated FROM assessment_report_generation LIMIT 20'
  );
  console.log('=== assessment_report_generation rows ===');
  rows.forEach(r => console.log(r));

  // Try to update CAN0002
  const cid = '294945a1675a4e83b3e2bbaccf578e7e';
  const pid = '83866e8d22de4b5396caed1b28b4f597';
  const [r1] = await c.execute(
    'SELECT HEX(candidate_id) cid, HEX(position_id) pid, is_generated FROM assessment_report_generation WHERE candidate_id = UNHEX(?) AND position_id = UNHEX(?)',
    [cid, pid]
  );
  console.log('\n=== Direct UNHEX lookup ===');
  console.log(r1);

  // Try update
  const [upd] = await c.execute(
    'UPDATE assessment_report_generation SET is_generated = 0 WHERE candidate_id = UNHEX(?) AND position_id = UNHEX(?)',
    [cid, pid]
  );
  console.log('\nRows updated:', upd.affectedRows);

  await c.end();
})().catch(e => console.error('ERROR:', e.message));
