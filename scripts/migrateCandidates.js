const db = require('../src/config/db');
const { v4: uuidv4 } = require('uuid');

async function migrate() {
    await db.initializePool();
    const database = 'candidates_db';
    console.log('--- Starting Candidate Consolidation Migration ---');

    try {
        // 1. Find duplicate groups (Organization + Email)
        const dupQuery = `
            SELECT organization_id, email, COUNT(*) as cnt 
            FROM \`${database}\`.\`ats_candidates\` 
            GROUP BY organization_id, email 
            HAVING cnt > 1
        `;
        const duplicates = await db.query(dupQuery);
        
        if (duplicates.length === 0) {
            console.log('No duplicates found. Database is clean.');
            process.exit(0);
        }

        console.log(`Found ${duplicates.length} duplicate groups. Merging profiles...`);

        let totalMerged = 0;
        for (const dup of duplicates) {
            // Get all records for this group, oldest first
            const rows = await db.query(
                `SELECT id, candidate_code, name FROM \`${database}\`.\`ats_candidates\` 
                 WHERE organization_id = ? AND email = ? 
                 ORDER BY created_at ASC`,
                [dup.organization_id, dup.email]
            );

            const master = rows[0];
            const others = rows.slice(1);

            console.log(`- Merging into ${master.candidate_code} (${master.name}): ${others.length} duplicates for ${dup.email}`);

            for (const other of others) {
                // A. Re-link application records to the Master ID
                const updateRes = await db.query(
                    `UPDATE IGNORE \`${database}\`.\`ats_candidate_jobs\` 
                     SET candidate_id = ? WHERE candidate_id = ?`,
                    [master.id, other.id]
                );
                
                // B. Delete the duplicate profile entry
                await db.query(`DELETE FROM \`${database}\`.\`ats_candidates\` WHERE id = ?`, [other.id]);
                totalMerged++;
            }
        }

        console.log(`\n--- Migration Complete! Total profiles merged: ${totalMerged} ---`);
        
        // 2. Ensure Unique Indexes are applied for future prevention
        console.log('Applying unique constraints to prevent future duplicates...');
        const indexes = await db.query(`SHOW INDEX FROM \`${database}\`.\`ats_candidates\``);
        const indexNames = indexes.map(i => i.Key_name);

        if (!indexNames.includes('uk_ats_org_email')) {
            await db.query(`ALTER TABLE \`${database}\`.\`ats_candidates\` ADD UNIQUE KEY \`uk_ats_org_email\` (organization_id, email)`);
            console.log('- Added unique index for email.');
        }
        if (!indexNames.includes('uk_ats_org_phone')) {
            await db.query(`ALTER TABLE \`${database}\`.\`ats_candidates\` ADD UNIQUE KEY \`uk_ats_org_phone\` (organization_id, mobile_number)`);
            console.log('- Added unique index for mobile_number.');
        }

        process.exit(0);
    } catch (error) {
        console.error('Migration failed:', error);
        process.exit(1);
    }
}

migrate();
