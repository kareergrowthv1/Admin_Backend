const db = require('../src/config/db');

async function fixCreditsTable() {
    let pool;
    try {
        await db.initializePool();
        const schemaName = 'smith_mnitalrm';
        
        console.log(`Altering credits table for DB: ${schemaName}`);
        
        const alterQuery = `
            ALTER TABLE \`${schemaName}\`.credits 
            ADD COLUMN IF NOT EXISTS total_screening_credits INT NOT NULL DEFAULT 0 AFTER utilized_position_credits,
            ADD COLUMN IF NOT EXISTS utilized_screening_credits INT NOT NULL DEFAULT 0 AFTER total_screening_credits,
            ADD COLUMN IF NOT EXISTS screening_credits_min INT NOT NULL DEFAULT 0 AFTER utilized_screening_credits,
            ADD COLUMN IF NOT EXISTS screening_credits_cost_per_price DECIMAL(10,2) NOT NULL DEFAULT 0.00 AFTER screening_credits_min;
        `;
        
        pool = require('mysql2/promise').createPool({
            host: db.getPool().pool.config.connectionConfig.host,
            user: db.getPool().pool.config.connectionConfig.user,
            password: db.getPool().pool.config.connectionConfig.password,
            database: schemaName,
            waitForConnections: true,
            connectionLimit: 1
        });
        
        const conn = await pool.getConnection();
        
        try {
            await conn.query(alterQuery);
            console.log('Columns added successfully');
        } catch(e) {
            // IF NOT EXISTS syntax error on older MySQL? 
            // We use try-catch over individual ALTERs if needed
            if (e.code === 'ER_PARSE_ERROR') {
                console.log('IF NOT EXISTS not supported, running individually with try-catch');
                const cols = [
                    'ADD COLUMN total_screening_credits INT NOT NULL DEFAULT 0 AFTER utilized_position_credits',
                    'ADD COLUMN utilized_screening_credits INT NOT NULL DEFAULT 0 AFTER total_screening_credits',
                    'ADD COLUMN screening_credits_min INT NOT NULL DEFAULT 0 AFTER utilized_screening_credits',
                    'ADD COLUMN screening_credits_cost_per_price DECIMAL(10,2) NOT NULL DEFAULT 0.00 AFTER screening_credits_min'
                ];
                for (const col of cols) {
                    try {
                        await conn.query(`ALTER TABLE \`${schemaName}\`.credits ${col}`);
                    } catch(err) {
                        if (err.errno !== 1060) { // 1060: Duplicate column name
                            console.error(`Error on ${col}:`, err.message);
                        }
                    }
                }
            } else {
                throw e;
            }
        }
        
        const checkRows = await conn.query(`SHOW COLUMNS FROM \`${schemaName}\`.credits`);
        console.log(`Columns in credits:`, checkRows[0].map(r => r.Field).join(', '));
        conn.release();
        
    } catch(e) {
        console.error(e);
    } finally {
        if(pool) await pool.end();
        process.exit();
    }
}
fixCreditsTable();
