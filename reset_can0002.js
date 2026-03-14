// One-shot script: reset is_generated=0 for CAN0002 so report regenerates fresh
const mysql = require('mysql2/promise');
require('dotenv').config();

(async () => {
  const conn = await mysql.createConnection({
    host: process.env.DB_HOST || 'localhost',
    port: Number(process.env.DB_PORT) || 3306,
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD || 'radhe123',
    database: process.env.DB_NAME || 'candidates_db',
  });
  const CAN_ID_NODASH = '294945a1675a4e83b3e2bbaccf578e7e';
  const POS_ID_NODASH = '83866e8d22de4b5396caed1b28b4f597';
  // IDs stored as BINARY(16) via UNHEX — compare using HEX()
  const [r] = await conn.execute(
    "UPDATE assessment_report_generation SET is_generated = 0 WHERE HEX(candidate_id) = UPPER(?) AND HEX(position_id) = UPPER(?)",
    [CAN_ID_NODASH, POS_ID_NODASH]
  );
  console.log(`Rows reset: ${r.affectedRows}`);
  await conn.end();
})().catch(e => { console.error('Error:', e.message); process.exit(1); });
