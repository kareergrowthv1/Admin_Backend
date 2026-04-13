const mysql = require('mysql2/promise');

async function diagnose() {
  const connection = await mysql.createConnection({
    host: 'localhost',
    user: 'root',
    password: 'radhe123'
  });

  const candidateId = '48f03f5f-c4a3-4c0e-923d-a0268e870b85';
  const orgId = 'aecb803f-676d-4f79-b3b4-b993ea6c5a0a';

  try {
    console.log(`Diagnosing Candidate: ${candidateId} (Org: ${orgId})`);

    const [dbs] = await connection.query('SHOW DATABASES');
    for (const dbRow of dbs) {
      const dbName = dbRow.Database;
      if (dbName === 'information_schema' || dbName === 'performance_schema' || dbName === 'sys' || dbName === 'mysql') continue;

      try {
          const [tables] = await connection.query(`SHOW TABLES IN \`${dbName}\` LIKE 'college_candidates'`);
          if (tables.length > 0) {
            const [rows] = await connection.query(
              `SELECT * FROM \`${dbName}\`.college_candidates WHERE candidate_id = ? OR REPLACE(candidate_id, '-', '') = ?`,
              [candidateId, candidateId.replace(/-/g, '')]
            );
            if (rows.length > 0) {
              console.log(`[FOUND] Candidate in ${dbName}.college_candidates:`, JSON.stringify(rows[0], null, 2));
            }
          }
          
          const [tables2] = await connection.query(`SHOW TABLES IN \`${dbName}\` LIKE 'candidate_positions'`);
          if (tables2.length > 0) {
            const [rows] = await connection.query(
              `SELECT * FROM \`${dbName}\`.candidate_positions WHERE candidate_id = ? OR REPLACE(candidate_id, '-', '') = ?`,
              [candidateId, candidateId.replace(/-/g, '')]
            );
            if (rows.length > 0) {
              console.log(`[FOUND] Mapping in ${dbName}.candidate_positions:`, JSON.stringify(rows[0], null, 2));
            }
          }
      } catch (err) {
          // Skip DBs that we can't access
      }
    }

  } catch (err) {
    console.error('Error:', err.message);
  } finally {
    await connection.end();
    process.exit();
  }
}

diagnose();
