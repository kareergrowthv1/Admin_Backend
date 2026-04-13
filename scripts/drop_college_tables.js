const db = require('../src/config/db');

async function fixTables() {
    let pool;
    try {
        await db.initializePool();
        const schemaName = 'smith_mnitalrm';
        
        pool = require('mysql2/promise').createPool({
            host: db.getPool().pool.config.connectionConfig.host,
            user: db.getPool().pool.config.connectionConfig.user,
            password: db.getPool().pool.config.connectionConfig.password,
            database: schemaName,
            waitForConnections: true,
            connectionLimit: 1
        });
        
        const conn = await pool.getConnection();
        const tablesToDrop = [
            'final_remarks',
            'interview_evaluations',
            'college_candidates',
            'candidate_positions',
            'job_candidates',
            'interview_instructions',
            'question_sections',
            'question_sets',
            'positions',
            'position_mandatory_skills',
            'position_optional_skills'
        ];
        
        for (const tbl of tablesToDrop) {
            try {
                await conn.query(`DROP TABLE IF EXISTS ${tbl}`);
                console.log(`Dropped ${tbl}`);
            } catch(e) {
                console.log(`Error dropping ${tbl}: ${e.message}`);
            }
        }
        conn.release();
    } catch(e) {
        console.error(e);
    } finally {
        if(pool) await pool.end();
        process.exit();
    }
}
fixTables();
