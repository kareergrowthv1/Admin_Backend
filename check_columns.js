const db = require('./src/config/db');

async function checkColumns() {
    await db.initializePool();
    const tenantDb = 'smith_mnitalrm';
    try {
        const jobsCols = await db.query(`SHOW COLUMNS FROM \`${tenantDb}\`.jobs`);
        console.log('Jobs columns:', jobsCols.map(c => c.Field));
        
        const posCols = await db.query(`SHOW COLUMNS FROM \`${tenantDb}\`.positions`);
        console.log('Positions columns:', posCols.map(c => c.Field));
    } catch (err) {
        console.error('Error querying columns:', err.message);
    }
    process.exit(0);
}

checkColumns().catch(err => {
    console.error(err);
    process.exit(1);
});
