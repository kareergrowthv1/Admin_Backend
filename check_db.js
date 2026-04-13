const mysql = require('mysql2/promise');
const config = require('./src/config');

async function checkTable() {
    const pool = mysql.createPool({
        host: config.database.host,
        port: config.database.port,
        user: config.database.user,
        password: config.database.password
    });

    try {
        const [rows] = await pool.query("SHOW DATABASES");
        console.log('Available databases:');
        console.table(rows);
        
        const dbName = config.database.name || 'sharan_m_mmhgw1ga';
        console.log(`Checking if ${dbName} exists...`);
        const exists = rows.some(r => Object.values(r)[0] === dbName);
        
        if (exists) {
            const [tables] = await pool.query(`SHOW TABLES FROM \`${dbName}\` LIKE 'candidate_course_points'`);
            if (tables.length > 0) {
                console.log('✓ candidate_course_points table exists');
                const [columns] = await pool.query(`DESCRIBE \`${dbName}\`.candidate_course_points`);
                console.table(columns);
            } else {
                console.log('✗ candidate_course_points table MISSING');
            }
        } else {
            console.log(`✗ Database ${dbName} NOT FOUND`);
        }
    } catch (err) {
        console.error('Error:', err);
    } finally {
        await pool.end();
    }
}

checkTable();
