const db = require('./src/config/db');

async function checkFeatures() {
    try {
        await db.initializePool();
        const features = await db.authQuery('SELECT * FROM features');
        console.log('--- FEATURES TABLE ---');
        console.table(features);
        process.exit(0);
    } catch (error) {
        console.error('Error checking features:', error);
        process.exit(1);
    }
}

checkFeatures();
