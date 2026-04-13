const cron = require('node-cron');
const db = require('../config/db');

/**
 * Job to automatically deactivate positions whose application deadline has passed.
 * Runs daily at 12:00 PM.
 */
const startPositionExpiryJob = () => {
    // Schedule to run every day at 12:00 PM
    cron.schedule('0 12 * * *', async () => {
        console.log('[Scheduler] Running daily position expiry job...');
        try {
            // 1. Get all unique tenant schemas from auth_db
            const clients = await db.authQuery('SELECT DISTINCT client FROM auth_db.users WHERE client IS NOT NULL');
            
            if (!clients || clients.length === 0) {
                console.log('[Scheduler] No tenant clients found to process.');
                return;
            }

            for (const { client } of clients) {
                try {
                    // 2. Update positions whose deadline has passed (before today) to INACTIVE
                    // CURDATE() returns today's date 'YYYY-MM-DD'
                    const updateQuery = `
                        UPDATE \`${client}\`.positions 
                        SET position_status = 'INACTIVE', 
                            updated_at = NOW() 
                        WHERE application_deadline < CURDATE() 
                          AND position_status = 'ACTIVE'
                    `;
                    
                    const result = await db.query(updateQuery);
                    if (result.affectedRows > 0) {
                        console.log(`[Scheduler] Deactivated ${result.affectedRows} expired positions in schema: ${client}`);
                    }
                } catch (clientErr) {
                    console.error(`[Scheduler] Error processing client ${client}:`, clientErr.message);
                }
            }
            console.log('[Scheduler] Daily position expiry job completed.');
        } catch (err) {
            console.error('[Scheduler] Critical error in position expiry job:', err.message);
        }
    });

    console.log('[Scheduler] Position expiry job scheduled (Daily at 12:00 PM)');
};

/**
 * Core logic to update expired candidate links.
 * Used by both scheduled cron job and one-time execution.
 */
const updateExpiredLinks = async () => {
    console.log('[Scheduler] Updating expired candidate links...');
    try {
        const clients = await db.authQuery('SELECT DISTINCT client, is_college FROM auth_db.users WHERE client IS NOT NULL');
        
        if (!clients || clients.length === 0) {
            console.log('[Scheduler] No tenant clients found for link expiry.');
            return;
        }

        for (const { client, is_college } of clients) {
            try {
                // Statuses that indicate invitation but no test completion
                const invitedStatuses = "'Invited', 'INVITED', 'Manually Invited', 'MANUALLY_INVITED', 'PENDING', 'Pending'";
                const expiredStatus = "'LINK_EXPIRED'";

                if (is_college || is_college === 1) {
                    // College/Standard schema tables
                    const queries = [
                        `UPDATE \`${client}\`.candidate_positions SET status = ${expiredStatus}, recommendation_status = ${expiredStatus}, updated_at = NOW() WHERE link_expires_at < NOW() AND (status IN (${invitedStatuses}) OR recommendation_status IN (${invitedStatuses}))`,
                        `UPDATE \`${client}\`.position_candidates SET recommendation_status = ${expiredStatus}, updated_at = NOW() WHERE link_expires_at < NOW() AND recommendation_status IN (${invitedStatuses})`
                    ];
                    for(const q of queries) {
                        try {
                            const res = await db.query(q);
                            if (res.affectedRows > 0) {
                                console.log(`[Scheduler] Expired ${res.affectedRows} links in College schema (${client}) table: ${q.includes('position_candidates') ? 'position_candidates' : 'candidate_positions'}`);
                            }
                        } catch(_) {} 
                    }
                } else {
                    // ATS/Job schema tables
                    const queries = [
                        `UPDATE \`${client}\`.job_candidates SET recommendation = ${expiredStatus}, updated_at = NOW() WHERE link_expires_at < NOW() AND recommendation IN (${invitedStatuses})`,
                        `UPDATE \`${client}\`.ats_candidates SET recommendation = ${expiredStatus}, updated_at = NOW() WHERE link_expires_at < NOW() AND recommendation IN (${invitedStatuses})`
                    ];
                    for(const q of queries) {
                        try {
                            const res = await db.query(q);
                            if (res.affectedRows > 0) {
                                console.log(`[Scheduler] Expired ${res.affectedRows} links in ATS schema (${client}) table: ${q.includes('ats_candidates') ? 'ats_candidates' : 'job_candidates'}`);
                            }
                        } catch(_) {}
                    }
                }
            } catch (clientErr) {
                console.error(`[Scheduler] Error processing link expiry for ${client}:`, clientErr.message);
            }
        }
        console.log('[Scheduler] Link expiry update cycle completed.');
    } catch (err) {
        console.error('[Scheduler] Critical error in updateExpiredLinks:', err.message);
    }
};

/**
 * Job to automatically update status of expired candidate links.
 * Runs daily at Midnight (00:00 AM).
 */
const startLinkExpiryJob = () => {
    // Schedule to run every day at 12:00 AM (Midnight)
    cron.schedule('0 0 * * *', async () => {
        await updateExpiredLinks();
    });

    console.log('[Scheduler] Link expiry job scheduled (Daily at 00:00 AM)');
};

/**
 * Run link expiry check immediately.
 */
const runLinkExpiryNow = async () => {
    await updateExpiredLinks();
};

module.exports = {
    startPositionExpiryJob,
    startLinkExpiryJob,
    runLinkExpiryNow
};
