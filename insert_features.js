const db = require('./src/config/db');
const { v4: uuidv4 } = require('uuid');

async function insertMissingFeatures() {
    try {
        await db.initializePool();
        
        const missingFeatures = [
            { name: 'STUDENTS', key: 'STUDENTS', cat: 'COLLEGE', order: 15, uri: '/students/**' },
            { name: 'ATTENDANCE', key: 'ATTENDANCE', cat: 'COLLEGE', order: 16, uri: '/attendance/**' },
            { name: 'DEPARTMENTS', key: 'DEPARTMENTS', cat: 'COLLEGE', order: 17, uri: '/departments/**' },
            { name: 'BRANCHES', key: 'BRANCHES', cat: 'COLLEGE', order: 18, uri: '/branches/**' },
            { name: 'SUBJECTS', key: 'SUBJECTS', cat: 'COLLEGE', order: 19, uri: '/subjects/**' },
            { name: 'TASKS', key: 'TASKS', cat: 'CORE', order: 20, uri: '/tasks/**' },
            { name: 'BULK EMAIL', key: 'MASSEMAIL', cat: 'CORE', order: 21, uri: '/mass-email/**' },
            { name: 'SETTINGS', key: 'SETTINGS', cat: 'CORE', order: 22, uri: '/settings/**' },
            { name: 'INBOX', key: 'INBOX', cat: 'CORE', order: 23, uri: '/inbox/**' }
        ];

        console.log('Inserting missing features...');
        for (const f of missingFeatures) {
            const existing = await db.authQuery('SELECT id FROM features WHERE feature_key = ?', [f.key]);
            if (existing.length === 0) {
                const id = uuidv4();
                await db.authQuery(
                    `INSERT INTO features (id, name, feature_key, category, description, uri_pattern, display_order, is_system, is_active, requires_auth, created_at, updated_at)
                     VALUES (?, ?, ?, ?, ?, ?, ?, 1, 1, 1, NOW(), NOW())`,
                    [id, f.name, f.key, f.cat, f.name, f.uri, f.order]
                );
                console.log(`Inserted: ${f.key}`);
            } else {
                console.log(`Skipped (exists): ${f.key}`);
            }
        }

        console.log('Feature insertion complete.');
        process.exit(0);
    } catch (error) {
        console.error('Error inserting features:', error);
        process.exit(1);
    }
}

insertMissingFeatures();
