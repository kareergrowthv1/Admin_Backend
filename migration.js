const { initializePool, query, authQuery } = require('./src/config/db');
const AtsCandidateModel = require('./src/models/atsCandidateModel');
require('dotenv').config();

async function runMigration() {
    try {
        console.log('--- Starting Schema Migration & Initialization ---');
        await initializePool();

        // 1. Cleanup global candidates_db
        console.log('Cleaning up candidates_db...');
        await query(`DROP TABLE IF EXISTS \`candidates_db\`.\`ats_private_link\``);
        await query(`DROP TABLE IF EXISTS \`candidates_db\`.\`ats_position_candidates\``);
        
        // Ensure shared tables exist (if any logic in model depends on it)
        // No specific shared table creation in model except ats_candidates

        // 2. Fetch all organizations to identify tenant databases
        console.log('Fetching organizations from auth_db...');
        const orgs = await authQuery('SELECT name FROM organizations');
        
        console.log(`Found ${orgs.length} organizations.`);

        const skipDbs = ['information_schema', 'mysql', 'performance_schema', 'sys', 'auth_db', 'candidates_db', 'remotetv', 'sendmails', 'superadmin_db', 'testserv'];

        for (const org of orgs) {
            const tenantDb = org.name.toLowerCase();
            if (skipDbs.includes(tenantDb)) continue;

            console.log(`Processing tenant DB: ${tenantDb}...`);

            try {
                // This will handle DROP, RENAME and CREATE/ALTER with all columns
                await AtsCandidateModel.ensureAtsCandidatesTable(tenantDb);
                console.log(`  - Successfully initialized/updated schema in ${tenantDb}.`);
            } catch (err) {
                if (err.message.includes("Unknown database")) {
                    console.warn(`  - [Skip] Database ${tenantDb} does not exist.`);
                } else {
                    console.warn(`  - [Error] Failed to process ${tenantDb}:`, err.message);
                }
            }
        }

        console.log('--- Migration Completed Successfully ---');
        process.exit(0);
    } catch (err) {
        console.error('--- Migration Failed ---');
        console.error(err);
        process.exit(1);
    }
}

runMigration();
