const { initializePool, query } = require('./src/config/db');
async function check() {
  await initializePool();
  try {
    const rows = await query('DESCRIBE qwikhire_mnnbl6li.assessments_summary');
    console.log(rows.map(r => r.Field).join(', '));
  } catch (e) {
    console.log('Table does not exist or error:', e.message);
  }
  process.exit(0);
}
check();
