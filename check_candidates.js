const db = require('./src/config/db');
const organizationId = 'aecb803f-676d-4f79-b3b4-b993ea6c5a0a';
const tenantDb = 'qwikhire_mnnbl6li';

async function checkData() {
    try {
        await db.initializePool();
        const rows = await db.query(`SELECT * FROM \`${tenantDb}\`.college_candidates WHERE organization_id = ? LIMIT 5`, [organizationId]);
        console.log(`Sample rows for org ${organizationId} in ${tenantDb}:`);
        console.log(JSON.stringify(rows, null, 2));
        
        const count = await db.query(`SELECT COUNT(*) as total FROM \`${tenantDb}\`.college_candidates WHERE organization_id = ?`, [organizationId]);
        console.log(`Total count for org ${organizationId} in ${tenantDb}:`, count[0].total);

        process.exit(0);
    } catch (err) {
        console.error(err);
        process.exit(1);
    }
}

checkData();
