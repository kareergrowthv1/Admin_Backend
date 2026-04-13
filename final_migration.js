const { initializePool, query } = require('./src/config/db');

async function migrate() {
    try {
        console.log('--- Starting Final Column Migration ---');
        await initializePool();
        
        const dbs = ['smith_mnitalrm', 'sharan_m_mmhgw1ga'];
        const columns = [
            { name: 'job_title', type: 'VARCHAR(255)' },
            { name: 'job_code', type: 'VARCHAR(100)' },
            { name: 'candidate_name', type: 'VARCHAR(255)' },
            { name: 'assessment_status', type: 'VARCHAR(50)', default: 'Invited' },
            { name: 'recommendation', type: 'VARCHAR(50)', default: 'PENDING' },
            { name: 'question_set_id', type: 'BINARY(16)' },
            { name: 'link_active_at', type: 'DATETIME' },
            { name: 'link_expires_at', type: 'DATETIME' },
            { name: 'invitation_sent_at', type: 'DATETIME' }
        ];

        for (const dbName of dbs) {
            console.log(`Checking database: ${dbName}...`);
            const existing = await query(`DESCRIBE \`${dbName}\`.\`candidates_job\``);
            const existingNames = existing.map(r => r.Field.toLowerCase());
            
            for (const col of columns) {
                if (!existingNames.includes(col.name.toLowerCase())) {
                    let sql = `ALTER TABLE \`${dbName}\`.\`candidates_job\` ADD COLUMN \`${col.name}\` ${col.type}`;
                    if (col.default) sql += ` DEFAULT '${col.default}'`;
                    
                    await query(sql);
                    console.log(`  - Added column: ${col.name}`);
                }
            }
        }
        
        console.log('--- Final Column Migration Completed Successfully ---');
        process.exit(0);
    } catch (err) {
        console.error('--- Column Migration Failed ---');
        console.error(err);
        process.exit(1);
    }
}

migrate();
