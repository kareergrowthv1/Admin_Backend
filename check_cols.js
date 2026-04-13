const { initializePool, query } = require('./src/config/db');
async function check() {
  await initializePool();
  const rows = await query('DESCRIBE candidates_db.assessments_summary');
  console.log(rows.map(r => r.Field).join(', '));
  process.exit(0);
}
check();
