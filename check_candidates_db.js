const mysql = require('mysql2/promise');
const config = require('./src/config');

async function checkTable() {
    const pool = mysql.createPool({
        host: config.database.host,
        port: config.database.port,
        user: config.database.user,
        password: config.database.password,
        database: 'candidates_db'
    });

    try {
        const [rows] = await pool.query("SHOW TABLES LIKE 'candidate_course_points'");
        if (rows.length > 0) {
            console.log('✓ candidate_course_points table exists');
            const [columns] = await pool.query("DESCRIBE candidate_course_points");
            console.table(columns);
        } else {
            console.log('✗ candidate_course_points table MISSING');
        }
    } catch (err) {
        console.error('Error:', err);
    } finally {
        await pool.end();
    }
}

checkTable();
