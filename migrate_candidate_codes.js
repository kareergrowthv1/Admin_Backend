/**
 * Migration: Backfill candidate_code for all ats_candidates
 * Format: first 3 alpha chars of name (UPPERCASE) + 001, 002, ...
 * Run: node AdminBackend/migrate_candidate_codes.js
 */

const path = require('path');
const dbPath = path.join(__dirname, 'src/config/db');
const { initializePool, query } = require(dbPath);

async function migrate() {
    await initializePool();
    const database = 'candidates_db';

    console.log('[Migration] Fetching all ats_candidates...');
    const allRows = await query(
        `SELECT LOWER(BIN_TO_UUID(id)) as id, name, candidate_code FROM \`${database}\`.\`ats_candidates\` ORDER BY created_at ASC`
    );

    console.log(`[Migration] Found ${allRows.length} candidates total.`);

    // Build prefix counters from already-valid codes (e.g. SHA001 → SHA:1)
    const prefixCounters = {};
    for (const row of allRows) {
        if (row.candidate_code && !row.candidate_code.startsWith('CAN-')) {
            const m = row.candidate_code.match(/^([A-Z]{3})(\d+)$/);
            if (m) {
                const p = m[1];
                const n = parseInt(m[2], 10);
                prefixCounters[p] = Math.max(prefixCounters[p] || 0, n);
            }
        }
    }

    // Only update rows with NULL or old CAN-XXXXXX codes
    const toUpdate = allRows.filter(r => !r.candidate_code || r.candidate_code.startsWith('CAN-'));
    console.log(`[Migration] ${toUpdate.length} rows need backfilling.`);

    let updated = 0;
    for (const row of toUpdate) {
        const prefix = (row.name || 'CAN')
            .replace(/[^a-zA-Z]/g, '')
            .substring(0, 3)
            .toUpperCase()
            .padEnd(3, 'X');

        prefixCounters[prefix] = (prefixCounters[prefix] || 0) + 1;
        const newCode = `${prefix}${String(prefixCounters[prefix]).padStart(3, '0')}`;
        const idClean = row.id.replace(/-/g, '');

        await query(
            `UPDATE \`${database}\`.\`ats_candidates\` SET candidate_code = ? WHERE id = UNHEX(?)`,
            [newCode, idClean]
        );
        console.log(`  ✓ [${row.name}]  "${row.candidate_code || 'NULL'}"  →  "${newCode}"`);
        updated++;
    }

    console.log(`\n[Migration] Done. ${updated} candidates updated.`);
    process.exit(0);
}

migrate().catch(err => {
    console.error('[Migration] Error:', err.message);
    process.exit(1);
});
