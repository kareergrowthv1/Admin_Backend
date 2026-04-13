const db = require('./src/config/db');

async function fixCredits() {
    await db.initializePool();
    const tenantDb = 'smith_mnitalrm';
    try {
        console.log(`Updating credits in ${tenantDb}...`);
        const result = await db.query(`UPDATE \`${tenantDb}\`.credits SET is_active = 1 WHERE is_active = 0`);
        console.log('Update result:', result);
        
        const rows = await db.query(`SELECT * FROM \`${tenantDb}\`.credits`);
        console.log('Updated Credits rows:', JSON.stringify(rows, null, 2));
    } catch (err) {
        console.error('Error fixing credits:', err.message);
    }
    process.exit(0);
}

fixCredits().catch(err => {
    console.error(err);
    process.exit(1);
});
