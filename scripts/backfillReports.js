/**
 * Script to backfill AI reports for candidates who have completed the test
 * but do not have an AI report generated yet.
 */
require('dotenv').config();
const axios = require('axios');
const mysql = require('mysql2/promise');

// DB Credentials from .env
const dbConfig = {
    host: process.env.DB_HOST,
    port: parseInt(process.env.DB_PORT, 10),
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
};

const STREAMING_AI_URL = (process.env.STREAMING_SERVICE_URL || process.env.AI_SERVICE_URL || 'https://streamingai.onrender.com').replace(/\/$/, '');
const TERMINAL_STATUSES = ['TEST_COMPLETED', 'RECOMMENDED', 'NOT_RECOMMENDED', 'CAUTIOUSLY_RECOMMENDED'];

async function backfill() {
    console.log('Starting Aggressive Report Backfill Migration...');
    let pool;
    try {
        pool = mysql.createPool(dbConfig);
        const candidatesToTrigger = new Set(); // Stores "candidateId|positionId|tenantId"

        // 1. Scan candidates_db.assessment_report_generation for pending reports
        console.log('Scanning assessment_report_generation for pending reports...');
        try {
            const [pending] = await pool.query(
                `SELECT BIN_TO_UUID(candidate_id) as cid, BIN_TO_UUID(position_id) as pid 
                 FROM candidates_db.assessment_report_generation 
                 WHERE is_generated = 0 OR is_generated = FALSE`
            );
            pending.forEach(p => {
                if (p.cid && p.pid) candidatesToTrigger.add(`${p.cid}|${p.pid}|candidates_db`);
            });
            console.log(`Found ${pending.length} pending entries in assessment_report_generation.`);
        } catch (e) { console.warn('assessment_report_generation scan failed:', e.message); }

        // 2. Scan all tenant DBs for terminal statuses
        console.log('Scanning tenant databases for completed tests without reports...');
        const [dbs] = await pool.query('SHOW DATABASES');
        for (const dbRow of dbs) {
            const dbName = dbRow.Database;
            if (!dbName.match(/^(tenant_|client_|qwikhire_)/)) continue;

            try {
                // Check candidate_positions
                const [cpRows] = await pool.query(
                    `SELECT BIN_TO_UUID(candidate_id) as cid, BIN_TO_UUID(position_id) as pid 
                     FROM \`${dbName}\`.candidate_positions 
                     WHERE status IN (?) OR recommendation_status IN (?)`,
                    [TERMINAL_STATUSES, TERMINAL_STATUSES]
                );
                cpRows.forEach(r => {
                    if (r.cid && r.pid) candidatesToTrigger.add(`${r.cid}|${r.pid}|${dbName}`);
                });

                // Check position_candidates
                const [pcRows] = await pool.query(
                    `SELECT BIN_TO_UUID(candidate_id) as cid, BIN_TO_UUID(position_id) as pid 
                     FROM \`${dbName}\`.position_candidates 
                     WHERE recommendation IN (?)`,
                    [TERMINAL_STATUSES]
                );
                pcRows.forEach(r => {
                    if (r.cid && r.pid) candidatesToTrigger.add(`${r.cid}|${r.pid}|${dbName}`);
                });
            } catch (_) { /* Table might not exist in this tenant */ }
        }

        console.log(`Discovered ${candidatesToTrigger.size} distinct candidate-position pairs requiring report check.`);

        // 3. Trigger reports
        let triggeredCount = 0;
        for (const item of candidatesToTrigger) {
            const [candidateId, positionId, tenantId] = item.split('|');
            const candHex = candidateId.replace(/-/g, '');
            const posHex = positionId.replace(/-/g, '');

            // Final check: Does a generated report ALREADY exist?
            const [exists] = await pool.query(
                `SELECT 1 FROM candidates_db.assessment_report_generation 
                 WHERE candidate_id = UNHEX(?) AND position_id = UNHEX(?) AND is_generated = 1`,
                [candHex, posHex]
            );

            if (exists.length > 0) continue;

            console.log(`Triggering report for Candidate: ${candidateId}, Position: ${positionId}, Tenant: ${tenantId}`);
            
            const payload = {
                candidateId,
                positionId,
                tenantId,
                clientId: tenantId
            };

            try {
                await axios.post(`${STREAMING_AI_URL}/report/generate`, payload);
                triggeredCount++;
            } catch (err) {
                console.error(`Failed to trigger for ${candidateId}:`, err.response?.data || err.message);
            }
        }

        console.log(`Backfill complete. Successfully triggered ${triggeredCount} reports.`);
    } catch (err) {
        console.error('Migration failed:', err.message);
    } finally {
        if (pool) await pool.end();
    }
}

backfill();
