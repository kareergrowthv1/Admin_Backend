const { v4: uuidv4 } = require('uuid');
const db = require('../config/db');

class ActivityLogService {
    /**
     * Log a new activity for an organization.
     * Automatically creates the activity_logs table if it doesn't exist in the tenant schema.
     * 
     * @param {string} tenantDb - The tenant's database schema name
     * @param {object} activityData - Activity details
     */
    static async logActivity(tenantDb, activityData) {
        if (!tenantDb || tenantDb === 'auth_db' || tenantDb === 'superadmin_db') {
            console.warn(`[ActivityLogService] Skipping log for non-tenant DB: ${tenantDb}`);
            return null;
        }

        const {
            organizationId,
            actorId,
            actorName,
            actorRole,
            activityType,
            activityTitle,
            activityDescription,
            entityId,
            entityType,
            metadata
        } = activityData;
        
        
        try {
            // 1. Ensure table exists in this tenant's schema
            await this.ensureTableExists(tenantDb);

            // 2. Prepare IDs (assuming BINARY(16) for primary key, VARCHAR(36) or BINARY(16) for others)
            const logId = uuidv4();
            const logIdBuffer = Buffer.from(logId.replace(/-/g, ''), 'hex');
            
            // Note: organizationId and actorId are strings in auth_db, but we store them as VARCHAR(36) in activity_logs for simplicity
            const sql = `
                INSERT INTO \`${tenantDb}\`.activity_logs (
                    id, organization_id, actor_id, actor_name, actor_role,
                    activity_type, activity_title, activity_description,
                    entity_id, entity_type, metadata, created_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW())
            `;

            await db.query(sql, [
                logIdBuffer,
                organizationId || null,
                actorId || null,
                actorName || null,
                actorRole || null,
                activityType,
                activityTitle,
                activityDescription || null,
                entityId || null,
                entityType || null,
                metadata ? JSON.stringify(metadata) : null
            ]);

            console.log(`[ActivityLogService] Activity logged: ${activityType} for org ${organizationId}`);
            return logId;
        } catch (error) {
            console.error('[ActivityLogService] Error logging activity:', error);
            return null;
        }
    }

    /**
     * Ensure the activity_logs table exists in the given tenant schema.
     */
    static async ensureTableExists(tenantDb) {
        try {
            const checkSql = `
                SELECT TABLE_NAME 
                FROM INFORMATION_SCHEMA.TABLES 
                WHERE TABLE_SCHEMA = ? AND TABLE_NAME = 'activity_logs'
            `;
            const rows = await db.query(checkSql, [tenantDb]);

            if (rows.length === 0) {
                console.log(`[ActivityLogService] Creating activity_logs table in ${tenantDb}`);
                const createSql = `
                    CREATE TABLE IF NOT EXISTS \`${tenantDb}\`.activity_logs (
                        id BINARY(16) NOT NULL PRIMARY KEY,
                        organization_id VARCHAR(36) NOT NULL,
                        actor_id VARCHAR(36) NOT NULL,
                        actor_name VARCHAR(255),
                        actor_role VARCHAR(50),
                        activity_type ENUM('INTERVIEW_SCHEDULED', 'CANDIDATE_ADDED', 'STATUS_CHANGED', 'SOURCING_ACTIVITY', 'JOB_POSTED', 'UPDATE', 'MASS_EMAIL', 'SINGLE_EMAIL') NOT NULL,
                        activity_title VARCHAR(255) NOT NULL,
                        activity_description TEXT,
                        entity_id VARCHAR(36),
                        entity_type VARCHAR(50),
                        metadata JSON,
                        created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
                        INDEX idx_activity_org (organization_id),
                        INDEX idx_activity_created (created_at),
                        INDEX idx_activity_type (activity_type)
                    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
                `;
                await db.query(createSql);
            }
        } catch (error) {
            console.error(`[ActivityLogService] Error ensuring table exists in ${tenantDb}:`, error);
            throw error; // Re-throw as this is a setup error
        }
    }

    /**
     * Get recent activities for an organization.
     */
    static async getRecentActivities(tenantDb, organizationId, filters = {}) {
        if (!tenantDb || !organizationId) {
            console.warn(`[ActivityLogService] Missing tenantDb or organizationId for query:`, { tenantDb, organizationId });
            return [];
        }
        

        try {
            await this.ensureTableExists(tenantDb);

            const { activityType, hours, limit = 50, actorId } = filters;
            const orgId = String(organizationId).trim();
            
            let sql = `
                SELECT 
                    HEX(id) as id, 
                    organization_id as organizationId,
                    actor_id as actorId,
                    actor_name as actorName,
                    actor_role as actorRole,
                    activity_type as activityType,
                    activity_title as activityTitle,
                    activity_description as activityDescription,
                    entity_id as entityId,
                    entity_type as entityType,
                    metadata,
                    created_at as createdAt
                FROM \`${tenantDb}\`.activity_logs
                WHERE organization_id = ?
            `;

            const params = [orgId];

            if (hours) {
                sql += ` AND created_at >= DATE_SUB(NOW(), INTERVAL ? HOUR)`;
                params.push(hours);
            }

            if (actorId) {
                sql += ` AND actor_id = ?`;
                params.push(actorId);
            }

            if (activityType && activityType !== 'ALL') {
                if (activityType === 'EMAILS') {
                    sql += ` AND activity_type IN ('MASS_EMAIL', 'SINGLE_EMAIL')`;
                } else {
                    sql += ` AND activity_type = ?`;
                    params.push(activityType);
                }
            }

            sql += ` ORDER BY created_at DESC LIMIT ?`;
            params.push(limit);

            const rows = await db.query(sql, params);
            
            const results = rows.map(r => ({
                ...r,
                metadata: r.metadata ? (typeof r.metadata === 'string' ? JSON.parse(r.metadata) : r.metadata) : null
            }));

            // Enrichment for all activities (Positions and Candidates)
            for (const activity of results) {
                // 1. Enrich Position Info if positionId/entityId is a POSITION
                const potentialPosId = (activity.entityType === 'POSITION' ? activity.entityId : activity.metadata?.positionId);
                if (potentialPosId && potentialPosId.length >= 32) {
                    try {
                        const posIdHex = potentialPosId.replace(/-/g, '');
                        const [posData] = await db.query(
                            `SELECT title, code FROM \`${tenantDb}\`.positions WHERE HEX(id) = ? LIMIT 1`,
                            [posIdHex]
                        );
                        if (posData) {
                            activity.metadata = {
                                ...activity.metadata,
                                positionName: posData.title,
                                positionCode: posData.code,
                                positionId: potentialPosId
                            };
                        }
                    } catch (enrichErr) {
                        console.warn(`[ActivityLogService] Position enrichment failed for ${activity.id}:`, enrichErr.message);
                    }
                }

                // 2. Enrich Candidate Info if employeeId/entityId is a CANDIDATE
                const potentialCanId = (activity.entityType === 'CANDIDATE' ? activity.entityId : activity.metadata?.candidateId);
                if (potentialCanId && potentialCanId.length >= 32 && !activity.metadata?.candidateName) {
                    try {
                        const [canData] = await db.query(
                            `SELECT candidate_name, candidate_code, resume_url FROM \`candidates_db\`.college_candidates WHERE candidate_id = ? AND organization_id = ? LIMIT 1`,
                            [potentialCanId, activity.organizationId]
                        );
                        if (canData) {
                            activity.metadata = {
                                ...activity.metadata,
                                candidateName: canData.candidate_name,
                                candidateCode: canData.candidate_code,
                                candidateId: potentialCanId,
                                resumeUrl: canData.resume_url
                            };
                        }
                    } catch (enrichErr) {
                        console.warn(`[ActivityLogService] Candidate enrichment failed for ${activity.id}:`, enrichErr.message);
                    }
                }

                // 3. Enrich Template Info
                const templateId = activity.metadata?.templateId;
                if (templateId && templateId.length >= 32 && !activity.metadata?.templateName) {
                    try {
                        const [tplData] = await db.query(
                            `SELECT name FROM \`${tenantDb}\`.email_templates WHERE id = ? LIMIT 1`,
                            [templateId]
                        );
                        if (tplData) {
                            activity.metadata = {
                                ...activity.metadata,
                                templateName: tplData.name,
                                templateId: templateId
                            };
                        }
                    } catch (enrichErr) {
                        console.warn(`[ActivityLogService] Template enrichment failed for ${activity.id}:`, enrichErr.message);
                    }
                }
            }
            
            return results;
        } catch (error) {
            console.error('[ActivityLogService] Error fetching activities:', error);
            return [];
        }
    }

    /**
     * Get counts for recent activities grouped by type.
     */
    static async getRecentActivityCounts(tenantDb, organizationId, hours = null, actorId = null) {
        if (!tenantDb || !organizationId) return {};

        try {
            await this.ensureTableExists(tenantDb);

            let sql = `
                SELECT activity_type as activityType, COUNT(*) as count
                FROM \`${tenantDb}\`.activity_logs
                WHERE organization_id = ?
            `;
            const params = [organizationId];

            if (hours) {
                sql += ` AND created_at >= DATE_SUB(NOW(), INTERVAL ? HOUR)`;
                params.push(hours);
            }

            if (actorId) {
                sql += ` AND actor_id = ?`;
                params.push(actorId);
            }

            sql += ` GROUP BY activity_type`;
            const rows = await db.query(sql, params);
            
            const counts = {
                ALL: 0,
                INTERVIEW_SCHEDULED: 0,
                CANDIDATE_ADDED: 0,
                STATUS_CHANGED: 0,
                JOB_POSTED: 0,
                SOURCING_ACTIVITY: 0,
                UPDATE: 0,
                MASS_EMAIL: 0,
                SINGLE_EMAIL: 0,
                EMAILS: 0
            };

            let total = 0;
            rows.forEach(row => {
                const type = row.activityType;
                const count = parseInt(row.count) || 0;
                if (counts.hasOwnProperty(type)) {
                    counts[type] = count;
                }
                total += count;
            });
            counts.ALL = total;
            counts.EMAILS = counts.MASS_EMAIL + counts.SINGLE_EMAIL;

            return counts;
        } catch (error) {
            console.error('[ActivityLogService] Error fetching activity counts:', error);
            return {};
        }
    }
    /**
     * Update activity metadata in the background.
     */
    static async updateActivityMetadata(tenantDb, logId, metadata) {
        if (!tenantDb || !logId) return;
        try {
            // Convert logId to buffer if it's a string
            const logIdBuffer = typeof logId === 'string' 
                ? Buffer.from(logId.replace(/-/g, ''), 'hex')
                : logId;

            // First get existing metadata to merge
            const [row] = await db.query(`SELECT metadata FROM \`${tenantDb}\`.activity_logs WHERE id = ?`, [logIdBuffer]);
            let currentMetadata = {};
            if (row && row.metadata) {
                currentMetadata = typeof row.metadata === 'string' ? JSON.parse(row.metadata) : row.metadata;
            }

            const mergedMetadata = { ...currentMetadata, ...metadata };
            const sql = `UPDATE \`${tenantDb}\`.activity_logs SET metadata = ? WHERE id = ?`;
            await db.query(sql, [JSON.stringify(mergedMetadata), logIdBuffer]);
            console.log(`[ActivityLogService] Metadata updated for ${logId}`);
        } catch (error) {
            console.error('[ActivityLogService] Error updating metadata:', error);
        }
    }
}

module.exports = ActivityLogService;
