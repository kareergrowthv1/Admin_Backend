const db = require('../src/config/db');

async function run() {
    try {
        await db.initializePool();
        console.log("Starting migration to add 'company_name' to positions table...");
        
        // Find all schemas with a 'positions' table
        const schemas = await db.query(`
            SELECT DISTINCT TABLE_SCHEMA 
            FROM INFORMATION_SCHEMA.TABLES 
            WHERE TABLE_NAME = 'positions' AND TABLE_SCHEMA LIKE 'qwikhire_%'
        `);
        
        for (const row of schemas) {
            const schemaName = row.TABLE_SCHEMA;
            
            // Check if column already exists
            const cols = await db.query(`
                SELECT COLUMN_NAME 
                FROM INFORMATION_SCHEMA.COLUMNS 
                WHERE TABLE_SCHEMA = ? AND TABLE_NAME = 'positions' AND COLUMN_NAME = 'company_name'
            `, [schemaName]);
            
            if (cols.length === 0) {
                console.log(`Adding company_name to ${schemaName}.positions...`);
                await db.query(`ALTER TABLE \`${schemaName}\`.positions ADD COLUMN company_name VARCHAR(255) AFTER application_deadline`);
                console.log(`Successfully patched ${schemaName}.positions`);
            } else {
                console.log(`Column company_name already exists in ${schemaName}.positions`);
            }
        }
        
        console.log("Migration complete.");
    } catch (err) {
        console.error("Migration failed:", err);
    } finally {
        process.exit(0);
    }
}

run();
