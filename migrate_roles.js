const db = require('./src/config/db');

async function migrateRoles() {
    try {
        await db.initializePool();
        const colRows = await db.authQuery(
            `SELECT COUNT(*) as cnt
             FROM INFORMATION_SCHEMA.COLUMNS
             WHERE TABLE_SCHEMA = DATABASE()
               AND TABLE_NAME = 'roles'
               AND COLUMN_NAME = 'created_by'`
        );

        if (colRows[0]?.cnt > 0) {
            console.log('roles.created_by already exists. No migration needed.');
            process.exit(0);
        }

        console.log('Adding created_by column to roles table...');
        await db.authQuery('ALTER TABLE roles ADD COLUMN created_by CHAR(36) NULL AFTER organization_id');
        console.log('Migration complete.');
        process.exit(0);
    } catch (error) {
        console.error('Migration failed:', error);
        process.exit(1);
    }
}

migrateRoles();
