const db = require('./src/config/db');
(async () => {
    try {
        const rows = await db.query('SHOW COLUMNS FROM `qwikhire_mnnbl6li`.positions');
        console.log(rows.map(r => r.Field));
    } catch(err) {
        console.error(err);
    }
    process.exit(0);
})();
