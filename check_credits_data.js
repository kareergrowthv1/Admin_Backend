const db = require('./src/config/db');

async function checkCredits() {
    await db.initializePool();
    const tenantDb = 'smith_mnitalrm';
    try {
        const rows = await db.query(`SELECT * FROM \`${tenantDb}\`.credits`);
        console.log('Credits rows:', JSON.stringify(rows, null, 2));
    } catch (err) {
        console.error('Error querying credits:', err.message);
    }
    process.exit(0);
}

checkCredits().catch(err => {
    console.error(err);
    process.exit(1);
});
