/**
 * migrate_assessment_summaries.js
 * 
 * 1. Creates assessments_summary table in all tenant databases.
 * 2. Migrates existing records from candidates_db.assessments_summary to correct tenant DBs.
 * 3. Populates missing summaries from linkage tables (candidate_positions / position_candidates).
 */

const { initializePool, query, authQuery } = require('../src/config/db');
const fs = require('fs');

async function runMigration() {
  console.log('--- Starting Assessment Summary Migration ---');
  await initializePool();

  // Get all potential tenants by looking at organizations
  const tenants = await authQuery(`
    SELECT id, name FROM auth_db.organizations WHERE is_active = 1
  `);

  if (!tenants || tenants.length === 0) {
    console.log('No active organizations found.');
    process.exit(0);
  }

  console.log(`Found ${tenants.length} active organizations.\n`);

  const summarySchema = `
    CREATE TABLE IF NOT EXISTS assessments_summary (
        id BINARY(16) PRIMARY KEY,
        candidate_id BINARY(16) NOT NULL,
        position_id BINARY(16) NOT NULL,
        question_id BINARY(16) NOT NULL,
        total_rounds_assigned INT DEFAULT 0,
        total_rounds_completed INT DEFAULT 0,
        total_interview_time VARCHAR(255),
        assessment_start_time VARCHAR(255),
        assessment_end_time VARCHAR(255),
        is_assessment_completed BIT(1) DEFAULT 0,
        is_report_generated BIT(1) DEFAULT 0,
        round1_assigned BIT(1) DEFAULT 0,
        round1_completed BIT(1) DEFAULT 0,
        round1_start_time VARCHAR(255),
        round1_end_time VARCHAR(255),
        round1_time_taken VARCHAR(255),
        round1_given_time VARCHAR(20),
        round2_assigned BIT(1) DEFAULT 0,
        round2_completed BIT(1) DEFAULT 0,
        round2_start_time VARCHAR(255),
        round2_end_time VARCHAR(255),
        round2_time_taken VARCHAR(255),
        round2_given_time VARCHAR(20),
        round3_assigned BIT(1) DEFAULT 0,
        round3_completed BIT(1) DEFAULT 0,
        round3_start_time VARCHAR(255),
        round3_end_time VARCHAR(255),
        round3_time_taken VARCHAR(255),
        round3_given_time VARCHAR(20),
        round4_assigned BIT(1) DEFAULT 0,
        round4_completed BIT(1) DEFAULT 0,
        round4_start_time VARCHAR(255),
        round4_end_time VARCHAR(255),
        round4_time_taken VARCHAR(255),
        round4_given_time VARCHAR(20),
        created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
        updated_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
        INDEX idx_candidate_id (candidate_id),
        INDEX idx_position_id (position_id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
  `;

  for (const tenant of tenants) {
    const dbName = tenant.name;
    const orgId = tenant.id;
    console.log(`\nMoving to tenant DB: ${dbName} (Org: ${orgId})`);

    try {
      // Ensure the table exists in tenant DB. 
      // We drop it first to ensure the schema is fresh and matches the migration script.
      await query(`USE \`${dbName}\``);
      await query(`DROP TABLE IF EXISTS assessments_summary`);
      await query(summarySchema);
      console.log(`- assessments_summary table recreated in ${dbName}`);

      // 2. Migrate existing data from shared candidates_db if mapped to this organization
      // We join with private_link / public_link to find the organization for each summary record.
      try {
        const sharedTableExists = await query(`SHOW TABLES FROM candidates_db LIKE 'assessments_summary'`);
        if (sharedTableExists.length > 0) {
          const migrateSql = `
            INSERT IGNORE INTO \`${dbName}\`.assessments_summary (
              id, candidate_id, position_id, question_id,
              total_rounds_assigned, total_rounds_completed, total_interview_time,
              assessment_start_time, assessment_end_time,
              is_assessment_completed, is_report_generated,
              round1_assigned, round1_completed, round1_start_time, round1_end_time, round1_time_taken, round1_given_time,
              round2_assigned, round2_completed, round2_start_time, round2_end_time, round2_time_taken, round2_given_time,
              round3_assigned, round3_completed, round3_start_time, round3_end_time, round3_time_taken, round3_given_time,
              round4_assigned, round4_completed, round4_start_time, round4_end_time, round4_time_taken, round4_given_time,
              created_at, updated_at
            )
            SELECT s.id, s.candidate_id, s.position_id, s.question_id,
              s.total_rounds_assigned, s.total_rounds_completed, s.total_interview_time,
              s.assessment_start_time, s.assessment_end_time,
              s.is_assessment_completed, s.is_report_generated,
              s.round1_assigned, s.round1_completed, s.round1_start_time, s.round1_end_time, s.round1_time_taken, s.round1_given_time,
              s.round2_assigned, s.round2_completed, s.round2_start_time, s.round2_end_time, s.round2_time_taken, s.round2_given_time,
              s.round3_assigned, s.round3_completed, s.round3_start_time, s.round3_end_time, s.round3_time_taken, s.round3_given_time,
              s.round4_assigned, s.round4_completed, s.round4_start_time, s.round4_end_time, s.round4_time_taken, s.round4_given_time,
              s.created_at, s.updated_at
            FROM candidates_db.assessments_summary s
            JOIN (
              -- Join with either private_link or public_link to resolve the client_id/org
              SELECT candidate_id, position_id, client_id FROM candidates_db.private_link
              UNION ALL
              SELECT UNHEX(REPLACE(c.candidate_id, '-', '')), l.position_id, l.client_id 
              FROM candidates_db.public_link l
              JOIN candidates_db.college_candidates c ON (l.client_id = c.organization_id)
            ) l ON (s.candidate_id = l.candidate_id AND s.position_id = l.position_id)
            WHERE l.client_id = ?
          `;
          const migrationResult = await query(migrateSql, [orgId]);
          console.log(`- Migrated ${migrationResult.affectedRows || 0} existing records from candidates_db.`);
        } else {
          console.log(`- Shared assessments_summary table missing; skipping donor migration.`);
        }
      } catch (migrateErr) {
        console.warn(`- Error during donor migration:`, migrateErr.message);
      }

      // 3. Populate missing summaries from candidate_positions linkage table
      // Checks for existence of candidate_positions first
      const tables = await query(`SHOW TABLES LIKE 'candidate_positions'`);
      if (tables.length > 0) {
        const populateSql = `
          INSERT IGNORE INTO \`${dbName}\`.assessments_summary (
            id, candidate_id, position_id, question_id,
            total_rounds_assigned, total_rounds_completed,
            round1_assigned, round2_assigned, round3_assigned, round4_assigned,
            created_at, updated_at
          )
          SELECT 
            UNHEX(REPLACE(UUID(), '-', '')), 
            UNHEX(REPLACE(candidate_id, '-', '')), 
            UNHEX(REPLACE(position_id, '-', '')), 
            UNHEX(REPLACE(COALESCE(question_set_id, ''), '-', '')),
            4, 0,
            1, 1, 1, 1,
            NOW(), NOW()
          FROM \`${dbName}\`.candidate_positions cp
          WHERE NOT EXISTS (
            SELECT 1 FROM \`${dbName}\`.assessments_summary s 
            WHERE s.candidate_id = UNHEX(REPLACE(cp.candidate_id, '-', '')) 
              AND s.position_id = UNHEX(REPLACE(cp.position_id, '-', ''))
          )
        `;
        const populateResult = await query(populateSql);
        console.log(`- Populated ${populateResult.affectedRows} new summaries from candidate_positions.`);
      }

      // 4. Populate missing summaries from position_candidates linkage table (if it exists)
      const posTables = await query(`SHOW TABLES LIKE 'position_candidates'`);
      if (posTables.length > 0) {
        const populateSql2 = `
          INSERT IGNORE INTO \`${dbName}\`.assessments_summary (
            id, candidate_id, position_id, question_id,
            total_rounds_assigned, total_rounds_completed,
            round1_assigned, round2_assigned, round3_assigned, round4_assigned,
            created_at, updated_at
          )
          SELECT 
            UNHEX(REPLACE(UUID(), '-', '')), 
            candidate_id, 
            position_id, 
            COALESCE(question_set_id, UNHEX('00000000000000000000000000000000')),
            4, 0,
            1, 1, 1, 1,
            NOW(), NOW()
          FROM \`${dbName}\`.position_candidates pc
          WHERE NOT EXISTS (
            SELECT 1 FROM \`${dbName}\`.assessments_summary s 
            WHERE s.candidate_id = pc.candidate_id 
              AND s.position_id = pc.position_id
          )
        `;
        const populateResult2 = await query(populateSql2);
        console.log(`- Populated ${populateResult2.affectedRows} new summaries from position_candidates.`);
      }

    } catch (err) {
      console.error(`- Error migrating tenant ${dbName}:`, err.message);
    }
  }

  console.log('\n--- Migration Completed ---');
  process.exit(0);
}

runMigration().catch(err => {
  console.error('Fatal error during migration:', err);
  process.exit(1);
});
