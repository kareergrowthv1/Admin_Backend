const db = require('./src/config/db');

async function migrateRoles() {
    try {
        await db.initializePool();
        console.log('Adding created_by column to roles table...');
        await db.authQuery('ALTER TABLE roles ADD COLUMN created_by CHAR(36) AFTER organization_id');
        console.log('Migration complete.');
        process.exit(0);
    } catch (error) {
        console.error('Migration failed:', error);
        process.exit(1);
    }
}

migrateRoles();
