// Script to add job_description column to positions table if it does not exist
// Usage: node migrate_add_job_description.js


const db = require('./src/config/db');


async function addJobDescriptionColumn() {
    const config = require('./src/config/index');
    console.log('Loaded DB config:', config.database);
    await db.initializePool();
    const tenantDbs = await db.query("SELECT schema_name FROM information_schema.schemata WHERE schema_name NOT IN ('mysql','information_schema','performance_schema','sys','auth_db','superadmin_db')");
    for (const row of tenantDbs) {
        const dbName = row.schema_name;
        console.log('Processing database:', dbName);
        try {
            const columns = await db.query(`SHOW COLUMNS FROM \`${dbName}\`.positions LIKE 'job_description'`);
            if (columns.length === 0) {
                await db.query(`ALTER TABLE \`${dbName}\`.positions ADD COLUMN job_description TEXT DEFAULT NULL`);
                console.log(`[${dbName}] job_description column added.`);
            } else {
                console.log(`[${dbName}] job_description column already exists.`);
            }
        } catch (err) {
            if (err.code === 'ER_NO_SUCH_TABLE') {
                console.log(`[${dbName}] positions table does not exist.`);
            } else {
                console.error(`[${dbName}] Error:`, err.message);
            }
        }
    }
    process.exit(0);
}

addJobDescriptionColumn();
