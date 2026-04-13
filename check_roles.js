const db = require('./src/config/db');

async function checkRolesTable() {
    try {
        await db.initializePool();
        const columns = await db.authQuery('DESCRIBE roles');
        console.log('--- ROLES TABLE COLUMNS ---');
        console.table(columns);
        process.exit(0);
    } catch (error) {
        console.error('Error checking roles table:', error);
        process.exit(1);
    }
}

checkRolesTable();
