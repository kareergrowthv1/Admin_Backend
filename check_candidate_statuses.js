const db = require('./src/config/db');

async function checkStatuses() {
    await db.initializePool();
    const database = 'candidates_db';
    try {
        const rows = await db.query(`SELECT stage, COUNT(*) as count FROM \`${database}\`.ats_candidates GROUP BY stage`);
        console.log('Status counts:', JSON.stringify(rows, null, 2));
    } catch (err) {
        console.error('Error querying statuses:', err.message);
    }
    process.exit(0);
}

checkStatuses().catch(err => {
    console.error(err);
    process.exit(1);
});
