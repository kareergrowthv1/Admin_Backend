/**
 * Migration 001: Add UNIQUE constraint to assessment_report_generation(candidate_id, position_id)
 * 
 * Run with: node scripts/run-migration-001-report-generation-unique.js
 *
 * What this does:
 *  1. Removes duplicate rows — keeps only the most-recent row per (candidate_id, position_id)
 *  2. Adds UNIQUE KEY uk_arg_candidate_position(candidate_id, position_id)
 *     so INSERT IGNORE / ON DUPLICATE KEY UPDATE work correctly going forward.
 */
require('dotenv').config({ path: __dirname + '/../.env' });
const mysql = require('mysql2/promise');

const DB_HOST     = process.env.DB_HOST     || 'localhost';
const DB_PORT     = parseInt(process.env.DB_PORT || '3306', 10);
const DB_USER     = process.env.DB_USER     || 'root';
const DB_PASSWORD = process.env.DB_PASSWORD || '';
const DB_NAME     = process.env.DB_NAME     || 'candidates_db';

async function run() {
  const conn = await mysql.createConnection({
    host: DB_HOST,
    port: DB_PORT,
    user: DB_USER,
    password: DB_PASSWORD,
    database: DB_NAME,
    multipleStatements: false,
  });

  try {
    console.log('Connected to MySQL. Starting migration 001...\n');

    // ── Step 1: Show existing row count ─────────────────────────────────────
    const [countRows] = await conn.query(
      `SELECT COUNT(*) AS total FROM \`candidates_db\`.assessment_report_generation`
    );
    console.log(`Current row count: ${countRows[0].total}`);

    // ── Step 2: Delete duplicates — keep the latest updated_at row per pair ─
    console.log('Step 1: Removing duplicate rows (keeping most-recent per candidate+position)...');
    const [del1] = await conn.query(`
      DELETE t1
      FROM \`candidates_db\`.assessment_report_generation t1
      INNER JOIN \`candidates_db\`.assessment_report_generation t2
        ON  t1.candidate_id = t2.candidate_id
        AND t1.position_id  = t2.position_id
        AND t1.created_at   < t2.created_at
    `);
    console.log(`  Deleted ${del1.affectedRows} older-created_at duplicate(s).`);

    // Tie-break: if two rows share the same created_at, keep the one with the larger id
    const [del2] = await conn.query(`
      DELETE t1
      FROM \`candidates_db\`.assessment_report_generation t1
      INNER JOIN \`candidates_db\`.assessment_report_generation t2
        ON  t1.candidate_id = t2.candidate_id
        AND t1.position_id  = t2.position_id
        AND t1.created_at   = t2.created_at
        AND t1.id           < t2.id
    `);
    console.log(`  Deleted ${del2.affectedRows} same-created_at tie-break duplicate(s).`);

    // ── Step 3: Verify no duplicates remain ─────────────────────────────────
    const [dupCheck] = await conn.query(`
      SELECT candidate_id, position_id, COUNT(*) AS cnt
      FROM \`candidates_db\`.assessment_report_generation
      GROUP BY candidate_id, position_id
      HAVING cnt > 1
    `);
    if (dupCheck.length > 0) {
      console.error('ERROR: Still have duplicates! Cannot add UNIQUE constraint.');
      console.error(dupCheck);
      process.exit(1);
    }
    console.log('  No duplicates remain. Proceeding...\n');

    // ── Step 4: Check if constraint already exists ────────────────────────────
    const [keyRows] = await conn.query(`
      SELECT COUNT(*) AS cnt
      FROM INFORMATION_SCHEMA.TABLE_CONSTRAINTS
      WHERE TABLE_SCHEMA    = 'candidates_db'
        AND TABLE_NAME      = 'assessment_report_generation'
        AND CONSTRAINT_NAME = 'uk_arg_candidate_position'
        AND CONSTRAINT_TYPE = 'UNIQUE'
    `);
    if (keyRows[0].cnt > 0) {
      console.log('Step 2: UNIQUE constraint uk_arg_candidate_position already exists. Skipping.\n');
    } else {
      console.log('Step 2: Adding UNIQUE constraint uk_arg_candidate_position...');
      await conn.query(`
        ALTER TABLE \`candidates_db\`.assessment_report_generation
          ADD CONSTRAINT uk_arg_candidate_position UNIQUE (candidate_id, position_id)
      `);
      console.log('  UNIQUE constraint added successfully.\n');
    }

    // ── Final row count ───────────────────────────────────────────────────────
    const [finalCount] = await conn.query(
      `SELECT COUNT(*) AS total FROM \`candidates_db\`.assessment_report_generation`
    );
    console.log(`Final row count: ${finalCount[0].total}`);
    console.log('\nMigration 001 completed successfully.');

  } finally {
    await conn.end();
  }
}

run().catch((err) => {
  console.error('Migration 001 FAILED:', err.message);
  process.exit(1);
});
