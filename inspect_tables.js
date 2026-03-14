const mysql = require('mysql2/promise');

async function run() {
  const c = await mysql.createConnection({host:'localhost', user:'root', password:'radhe123'});

  // positions columns and sample
  const [pc] = await c.execute('DESCRIBE sharan_m_mmd05u2m.positions');
  console.log('positions cols:', pc.map(x => x.Field).join(', '));
  const [pr] = await c.execute(
    "SELECT BIN_TO_UUID(id) as id, code, title, domain_type, minimum_experience, maximum_experience, application_deadline FROM sharan_m_mmd05u2m.positions WHERE BIN_TO_UUID(id,1) = '206c46e4-6ad4-40cc-987b-e9ba8ffbba04' OR BIN_TO_UUID(id) = '206c46e4-6ad4-40cc-987b-e9ba8ffbba04' LIMIT 1"
  );
  console.log('position row:', JSON.stringify(pr[0]));

  // question_sets columns and sample
  try {
    const [qc] = await c.execute('DESCRIBE sharan_m_mmd05u2m.question_sets');
    console.log('question_sets cols:', qc.map(x => x.Field).join(', '));
    // Fetch first row to see id format
    const [qall] = await c.execute('SELECT id, question_set_code, total_duration, question_section_ids FROM sharan_m_mmd05u2m.question_sets LIMIT 3');
    console.log('qs rows:', JSON.stringify(qall));
  } catch(e2) { console.log('question_sets error:', e2.message); }

  await c.end();
}

run().catch(e => { console.error('ERR:', e.message); process.exit(1); });
