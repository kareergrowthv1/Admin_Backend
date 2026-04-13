const fs = require('fs');
const path = require('path');
const db = require('../src/config/db');

async function patchSchema() {
    let pool;
    try {
        await db.initializePool();
        const schemaName = 'smith_mnitalrm';
        const schemaFilePath = path.join(__dirname, '../schemas/ats_schema.sql');
        
        console.log(`Executing ATS schema on database: ${schemaName}`);
        
        const rawSql = fs.readFileSync(schemaFilePath, 'utf8');
        const cleanedSql = rawSql.replace(/--.*$/gm, '').replace(/\n/g, ' ');
        const statements = cleanedSql.split(';').map(s => s.trim()).filter(s => s.length > 0);
        
        pool = require('mysql2/promise').createPool({
            host: db.getPool().pool.config.connectionConfig.host,
            user: db.getPool().pool.config.connectionConfig.user,
            password: db.getPool().pool.config.connectionConfig.password,
            database: schemaName,
            waitForConnections: true,
            connectionLimit: 1
        });
        
        const conn = await pool.getConnection();
        for (const stmt of statements) {
            try {
                // To avoid duplicate index error, ignore CREATE INDEX if it already exists
                // MySQL doesn't have CREATE INDEX IF NOT EXISTS before 8.0, so we just catch the error
                await conn.query(stmt);
            } catch (err) {
                // ER_DUP_KEYNAME is 1061. Duplicate table is handled by IF NOT EXISTS
                // Duplicate column handled by something else if applicable
                if (err.errno !== 1061 && err.errno !== 1050) {
                    console.warn(`Warning on statement: ${stmt.substring(0, 50)}... -> ${err.message}`);
                }
            }
        }
        conn.release();
        
        console.log('Schema patched successfully.');
        
        const checkRows = await pool.query(`SHOW TABLES`);
        console.log(`Tables in ${schemaName}:`, checkRows[0].map(r => Object.values(r)[0]).join(', '));
        
    } catch(e) {
        console.error(e);
    } finally {
        if(pool) await pool.end();
        process.exit();
    }
}
patchSchema();
