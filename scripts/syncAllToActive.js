const db = require('../src/config/db');

async function sync() {
    try {
        await db.initializePool();
        const database = 'candidates_db';
        console.log('--- Syncing Legacy "ALL" Stages to "active_candidates" ---');

        // 1. Update application records
        const res = await db.query(
            `UPDATE \`${database}\`.\`ats_candidate_jobs\` SET stage = 'active_candidates' WHERE stage = 'ALL' OR stage IS NULL`
        );
        console.log(`Updated ${res.affectedRows} application records to "active_candidates".`);

        // 2. Ensure default stages are correctly formatted
        await db.query(
            `UPDATE \`${database}\`.\`ats_job_stages\` SET title = 'Active' WHERE stage_id = 'active_candidates'`
        );
        
        console.log('--- Sync Complete ---');
        process.exit(0);
    } catch (error) {
        console.error('Sync failed:', error);
        process.exit(1);
    }
}

sync();
