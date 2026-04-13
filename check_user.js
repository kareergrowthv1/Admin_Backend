const db = require('./src/config/db');
const config = require('./src/config');

async function checkUser() {
    await db.initializePool();
    const userId = '62e66c61-cfe1-4ba5-8f87-da7d6df45e7e';
    const rows = await db.authQuery('SELECT * FROM users WHERE id = ?', [userId]);
    console.log(JSON.stringify(rows[0], null, 2));
    process.exit(0);
}

checkUser().catch(err => {
    console.error(err);
    process.exit(1);
});
