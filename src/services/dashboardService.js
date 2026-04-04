const db = require('../config/db');
const { v4: uuidv4 } = require('uuid');

class DashboardService {
    /**
     * Get summary stats for the dashboard
     * @param {string} tenantDb - The tenant database name
     * @param {string} organizationId - The organization ID
     * @param {object} filters - Filters like actorId for "OWN" scope
     */
    static async getStats(tenantDb, organizationId, filters = {}) {
        if (!tenantDb || !organizationId) return null;

        const { actorId } = filters;
        const orgIdBuffer = Buffer.from(organizationId.replace(/-/g, ''), 'hex');

        try {
            // 0. Table Check to detect schema type
            const tableCheck = await db.query(
                `SELECT TABLE_NAME FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_SCHEMA = ? AND TABLE_NAME IN ('candidate_positions', 'position_candidates', 'job_candidates', 'jobs')`,
                [tenantDb]
            );
            const tables = (tableCheck || []).map(t => t.TABLE_NAME);
            const isAts = tables.includes('job_candidates');

            // 1. Position Counts (Active)
            const posTable = tables.includes('jobs') ? 'jobs' : 'positions';
            const statusCol = tables.includes('jobs') ? 'status' : 'position_status';
            let posSql = `SELECT COUNT(*) as count FROM \`${tenantDb}\`.\`${posTable}\` WHERE \`${statusCol}\` = 'ACTIVE'`;
            const posParams = [];
            if (actorId) {
                posSql += ` AND created_by = ?`;
                posParams.push(actorId);
            }
            const [posRow] = await db.query(posSql, posParams);

            // 2. Candidate Counts (Total for this Org)
            const candTable = tables.includes('candidates') ? 'candidates' : 
                             (tables.includes('college_candidates') ? 'college_candidates' : null);
            
            const isLocalCandidates = candTable === 'candidates';
            let candSql = candTable ? `SELECT COUNT(*) as count FROM \`${tenantDb}\`.\`${candTable}\` WHERE organization_id = ?` : null;
            const candParams = candTable ? [isAts ? orgIdBuffer : organizationId] : [];
            
            if (candSql && actorId) {
                candSql += isLocalCandidates ? ` AND created_by = ?` : ` AND candidate_created_by = ?`;
                candParams.push(actorId);
            }
            
            const candResult = candSql ? await db.query(candSql, candParams) : [{ count: 0 }];
            const candRow = candResult[0];

            // 3. Interview/Assessment Counts
            let interviewCount = 0;
            if (tables.includes('job_candidates')) {
                let intSql = `SELECT COUNT(*) as count FROM \`${tenantDb}\`.job_candidates WHERE 1=1`;
                const intParams = [];
                if (actorId) {
                    intSql += ` AND interview_scheduled_by = UNHEX(?)`;
                    intParams.push(actorId.replace(/-/g, ''));
                }
                const [intRow] = await db.query(intSql, intParams);
                interviewCount = intRow?.count || 0;
            } else if (tables.includes('position_candidates')) {
                let intSql = `SELECT COUNT(*) as count FROM \`${tenantDb}\`.position_candidates WHERE 1=1`;
                const intParams = [];
                if (actorId) {
                    intSql += ` AND interview_scheduled_by = UNHEX(?)`;
                    intParams.push(actorId.replace(/-/g, ''));
                }
                const [intRow] = await db.query(intSql, intParams);
                interviewCount = intRow?.count || 0;
            } else if (tables.includes('candidate_positions')) {
                let intSql = `SELECT COUNT(*) as count FROM \`${tenantDb}\`.candidate_positions WHERE 1=1`;
                const intParams = [];
                if (actorId) {
                    intSql += ` AND interview_scheduled_by = ?`;
                    intParams.push(actorId);
                }
                const [intRow] = await db.query(intSql, intParams);
                interviewCount = intRow?.count || 0;
            }

            const [creditRow] = await db.query(
                `SELECT * FROM \`${tenantDb}\`.credits WHERE is_active = 1 LIMIT 1`
            );

            return {
                totalPositions: posRow?.count || 0,
                totalCandidates: candRow?.count || 0,
                totalInterviews: interviewCount,
                credits: creditRow ? {
                    interviews: {
                        total: creditRow.total_interview_credits,
                        used: creditRow.utilized_interview_credits,
                        remaining: (creditRow.total_interview_credits - creditRow.utilized_interview_credits)
                    },
                    positions: {
                        total: creditRow.total_position_credits,
                        used: creditRow.utilized_position_credits,
                        remaining: (creditRow.total_position_credits - creditRow.utilized_position_credits)
                    },
                    screening: isAts ? {
                        total: creditRow.total_screening_credits || 0,
                        used: creditRow.utilized_screening_credits || 0,
                        remaining: (creditRow.total_screening_credits || 0) - (creditRow.utilized_screening_credits || 0)
                    } : null
                } : null
            };
        } catch (error) {
            console.error('[DashboardService] Error fetching stats:', error);
            throw error;
        }
    }

    /**
     * Get monthly trends for the last 6 months
     */
    static async getTrends(tenantDb, organizationId, filters = {}) {
        if (!tenantDb || !organizationId) return [];

        const { actorId } = filters;
        const orgIdBuffer = Buffer.from(organizationId.replace(/-/g, ''), 'hex');

        try {
            const tableCheck = await db.query(
                `SELECT TABLE_NAME FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_SCHEMA = ? AND TABLE_NAME IN ('candidate_positions', 'position_candidates', 'job_candidates', 'candidates', 'college_candidates')`,
                [tenantDb]
            );
            const tables = (tableCheck || []).map(t => t.TABLE_NAME);
            const isAts = tables.includes('job_candidates');

            // 1. Monthly Candidate Trends
            const candTable = tables.includes('candidates') ? 'candidates' : 
                             (tables.includes('college_candidates') ? 'college_candidates' : null);
            
            let candRows = [];
            if (candTable) {
                const isLocalCandidates = (candTable === 'candidates');
                const dateCol = isLocalCandidates ? 'created_date' : 'created_at';
                let candTrendSql = `
                    SELECT DATE_FORMAT(\`${dateCol}\`, '%Y-%m') as month, COUNT(*) as count
                    FROM \`${tenantDb}\`.\`${candTable}\`
                    WHERE organization_id = ?
                    AND \`${dateCol}\` >= DATE_SUB(NOW(), INTERVAL 6 MONTH)
                `;
                const candTrendParams = [isAts ? orgIdBuffer : organizationId];
                if (actorId) {
                    candTrendSql += isLocalCandidates ? ` AND created_by = ?` : ` AND candidate_created_by = ?`;
                    candTrendParams.push(actorId);
                }
                candTrendSql += ` GROUP BY month ORDER BY month ASC`;
                candRows = await db.query(candTrendSql, candTrendParams);
            }

            let intRows = [];
            let intSql = '';
            const intParams = [];

            if (tables.includes('job_candidates')) {
                intSql = `
                    SELECT DATE_FORMAT(created_at, '%Y-%m') as month, COUNT(*) as count
                    FROM \`${tenantDb}\`.job_candidates
                    WHERE created_at >= DATE_SUB(NOW(), INTERVAL 6 MONTH)
                `;
                if (actorId) {
                    intSql += ` AND interview_scheduled_by = UNHEX(?)`;
                    intParams.push(actorId.replace(/-/g, ''));
                }
            } else if (tables.includes('position_candidates')) {
                intSql = `
                    SELECT DATE_FORMAT(created_at, '%Y-%m') as month, COUNT(*) as count
                    FROM \`${tenantDb}\`.position_candidates
                    WHERE created_at >= DATE_SUB(NOW(), INTERVAL 6 MONTH)
                `;
                if (actorId) {
                    intSql += ` AND interview_scheduled_by = UNHEX(?)`;
                    intParams.push(actorId.replace(/-/g, ''));
                }
            } else if (tables.includes('candidate_positions')) {
                intSql = `
                    SELECT DATE_FORMAT(created_at, '%Y-%m') as month, COUNT(*) as count
                    FROM \`${tenantDb}\`.candidate_positions
                    WHERE created_at >= DATE_SUB(NOW(), INTERVAL 6 MONTH)
                `;
                if (actorId) {
                    intSql += ` AND interview_scheduled_by = ?`;
                    intParams.push(actorId);
                }
            }

            if (intSql) {
                intSql += ` GROUP BY month ORDER BY month ASC`;
                intRows = await db.query(intSql, intParams);
            }

            const months = {};
            for (let i = 5; i >= 0; i--) {
                const d = new Date();
                d.setMonth(d.getMonth() - i);
                const m = d.toISOString().slice(0, 7);
                months[m] = { month: m, candidates: 0, interviews: 0 };
            }

            candRows.forEach(r => { if (months[r.month]) months[r.month].candidates = r.count; });
            intRows.forEach(r => { if (months[r.month]) months[r.month].interviews = r.count; });

            // 4. Daily submitted trends
            let dailySubRows = [];
            if (candTable) {
                const isLocalCandidates = (candTable === 'candidates');
                const dateCol = isLocalCandidates ? 'created_date' : 'created_at';
                let dailySubmittedSql = `
                    SELECT DATE_FORMAT(\`${dateCol}\`, '%Y-%m-%d') as day, COUNT(*) as count
                    FROM \`${tenantDb}\`.\`${candTable}\`
                    WHERE organization_id = ?
                    AND \`${dateCol}\` >= DATE_SUB(NOW(), INTERVAL 15 DAY)
                `;
                const dailySubParams = [isAts ? orgIdBuffer : organizationId];
                if (actorId) {
                    dailySubmittedSql += isLocalCandidates ? ` AND created_by = ?` : ` AND candidate_created_by = ?`;
                    dailySubParams.push(actorId);
                }
                dailySubmittedSql += ` GROUP BY day ORDER BY day ASC`;
                dailySubRows = await db.query(dailySubmittedSql, dailySubParams);
            }

            let dailySelectedRows = [];
            if (tables.length > 0) {
                const tableName = tables.includes('job_candidates') ? 'job_candidates' : (tables.includes('position_candidates') ? 'position_candidates' : 'candidate_positions');
                const statusCol = tables.includes('job_candidates') ? 'recommendation' : (tables.includes('position_candidates') ? 'recommendation' : 'status');
                const actorCol = tables.includes('job_candidates') ? 'status_changed_by' : (tables.includes('position_candidates') ? 'status_changed_by' : 'created_by');

                let dailySelSql = `
                    SELECT DATE_FORMAT(updated_at, '%Y-%m-%d') as day, COUNT(*) as count
                    FROM \`${tenantDb}\`.\`${tableName}\`
                    WHERE \`${statusCol}\` IN ('SELECTED', 'TEST_COMPLETED', 'RECOMMENDED')
                    AND updated_at >= DATE_SUB(NOW(), INTERVAL 15 DAY)
                `;
                const dailySelParams = [];
                if (actorId) {
                    dailySelSql += ` AND \`${actorCol}\` = ?`;
                    dailySelParams.push(actorId);
                }
                dailySelSql += ` GROUP BY day ORDER BY day ASC`;
                dailySelectedRows = await db.query(dailySelSql, dailySelParams);
            }

            const dailyDays = {};
            for (let i = 14; i >= 0; i--) {
                const d = new Date();
                d.setDate(d.getDate() - i);
                const dayStr = d.toISOString().slice(0, 10);
                dailyDays[dayStr] = { day: dayStr.slice(5), submitted: 0, selected: 0 };
            }
            dailySubRows.forEach(r => { if (dailyDays[r.day]) dailyDays[r.day].submitted = r.count; });
            dailySelectedRows.forEach(r => { if (dailyDays[r.day]) dailyDays[r.day].selected = r.count; });
            
            return {
                monthly: Object.values(months),
                daily: Object.values(dailyDays)
            };
        } catch (error) {
            console.error('[DashboardService] Error fetching trends:', error);
            throw error;
        }
    }

    /**
     * Get Recruiter Performance metrics
     */
    static async getTeamPerformance(tenantDb, organizationId, filters = {}) {
        if (!tenantDb || !organizationId) return [];

        try {
            const tableCheck = await db.query(
                `SELECT TABLE_NAME FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_SCHEMA = ? AND TABLE_NAME IN ('candidate_positions', 'position_candidates', 'job_candidates')`,
                [tenantDb]
            );
            const tables = (tableCheck || []).map(t => t.TABLE_NAME);
            let tableName = null;
            let statusCol = 'status';

            if (tables.includes('job_candidates')) {
                tableName = 'job_candidates';
                statusCol = 'recommendation';
            } else if (tables.includes('position_candidates')) {
                tableName = 'position_candidates';
                statusCol = 'recommendation';
            } else if (tables.includes('candidate_positions')) {
                tableName = 'candidate_positions';
                statusCol = 'status';
            }
            
            if (!tableName) return [];

            let sql = `
                SELECT 
                    pc.created_by as recruiterId,
                    COUNT(*) as submitted,
                    SUM(CASE WHEN pc.\`${statusCol}\` IN ('Invited', 'invited', 'INVITED', 'PENDING') THEN 1 ELSE 0 END) as invited,
                    SUM(CASE WHEN pc.\`${statusCol}\` IN ('Recommended', 'RECOMMENDED', 'recommended', 'SELECTED') THEN 1 ELSE 0 END) as recommended,
                    SUM(CASE WHEN pc.\`${statusCol}\` IN ('Not-Recommended', 'NOT_RECOMMENDED', 'not-recommended', 'Not Recommended', 'RESUME_REJECTED') THEN 1 ELSE 0 END) as notRecommended,
                    SUM(CASE WHEN pc.\`${statusCol}\` IN ('Cautiously Recommended', 'CAUTIOUSLY_RECOMMENDED', 'cautiously-recommended') THEN 1 ELSE 0 END) as cautiouslyRecommended,
                    SUM(CASE WHEN pc.\`${statusCol}\` IN ('Resume Rejected', 'RESUME_REJECTED', 'resume-rejected', 'Resume-Rejected') THEN 1 ELSE 0 END) as resumeRejected
                FROM \`${tenantDb}\`.\`${tableName}\` pc
                WHERE pc.organization_id = ?
            `;
            const params = [organizationId];
            if (filters.actorId) {
                sql += ` AND pc.created_by = ?`;
                params.push(filters.actorId);
            }
            sql += ` GROUP BY pc.created_by`;
            
            const rows = await db.query(sql, params);

            const nameSql = `SELECT DISTINCT actor_id, actor_name FROM \`${tenantDb}\`.activity_logs WHERE organization_id = ?`;
            const nameRows = await db.query(nameSql, [organizationId]);
            const nameMap = {};
            nameRows.forEach(r => { if (r.actor_id) nameMap[r.actor_id] = r.actor_name; });

            return rows.map(r => ({
                recruiter: nameMap[r.recruiterId] || 'Unknown',
                totalActivity: r.submitted || 0,
                invited: Number(r.invited) || 0,
                recommended: Number(r.recommended) || 0,
                notRecommended: Number(r.notRecommended) || 0,
                cautiouslyRecommended: Number(r.cautiouslyRecommended) || 0,
                resumeRejected: Number(r.resumeRejected) || 0
            })).sort((a, b) => b.totalActivity - a.totalActivity);

        } catch (error) {
            console.error('[DashboardService] Error fetching recruiter performance:', error);
            return [];
        }
    }

    /**
     * Get Recent Items for the 2x2 Grid
     */
    static async getRecentItemsGrid(tenantDb, organizationId, isCollege) {
        if (!tenantDb || !organizationId) return { positions: [], candidates: [], interviews: [], tasks: [] };

        let result = { positions: [], candidates: [], interviews: [], tasks: [] };

        try {
            const tableCheck = await db.query(
                `SELECT TABLE_NAME FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_SCHEMA = ? AND TABLE_NAME IN ('positions', 'jobs')`,
                [tenantDb]
            );
            const tables = (tableCheck || []).map(t => t.TABLE_NAME);
            const posTable = tables.includes('jobs') ? 'jobs' : 'positions';
            const statusCol = tables.includes('jobs') ? 'status' : 'position_status';
            const titleCol = tables.includes('jobs') ? 'requirement_name' : 'title';
            const codeCol = tables.includes('jobs') ? 'code' : 'code';
            const countTable = tables.includes('jobs') ? 'job_candidates' : 'candidate_positions';
            const fkCol = tables.includes('jobs') ? 'job_id' : 'position_id';

            const posSql = `
                SELECT 
                    p.id, p.\`${codeCol}\` as position_code, p.\`${titleCol}\` as job_title, p.created_at, 
                    p.\`${statusCol}\` as status, p.created_by, p.no_of_positions,
                    u.first_name, u.last_name, u.email as admin_email,
                    (SELECT COUNT(*) FROM \`${tenantDb}\`.\`${countTable}\` pc WHERE pc.\`${fkCol}\` = p.id) as candidates_count
                FROM \`${tenantDb}\`.\`${posTable}\` p
                LEFT JOIN auth_db.users u ON u.id = p.created_by
                ORDER BY p.created_at DESC LIMIT 3
            `;
            result.positions = await db.query(posSql);
        } catch (e) {
            console.error('[RecentGrid] positions ERROR:', e.message);
        }

        try {
            const candTableCheck = await db.query(
                `SELECT TABLE_NAME FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_SCHEMA = ? AND TABLE_NAME IN ('candidates', 'college_candidates')`,
                [tenantDb]
            );
            const candTables = (candTableCheck || []).map(t => t.TABLE_NAME);
            const candTable = candTables.includes('candidates') ? 'candidates' : 
                             (candTables.includes('college_candidates') ? 'college_candidates' : null);

            if (candTable) {
                const isLocalCandidates = (candTable === 'candidates');
                const dateCol = isLocalCandidates ? 'created_date' : 'created_at';
                const actorCol = isLocalCandidates ? 'created_by' : 'candidate_created_by';
                const nameExpr = isLocalCandidates ? "CONCAT(c.first_name, ' ', c.last_name)" : "c.candidate_name";
                const regCol = isLocalCandidates ? 'reg_number' : 'register_no';

                const candSql = `
                    SELECT 
                        c.candidate_code, ${nameExpr} as candidate_name, c.email, c.\`${dateCol}\` as created_at,
                        c.\`${actorCol}\` as added_by, c.\`${regCol}\` as reg_number,
                        u.first_name, u.last_name, u.email as admin_email
                    FROM \`${tenantDb}\`.\`${candTable}\` c
                    LEFT JOIN auth_db.users u ON u.id = c.\`${actorCol}\`
                    WHERE c.organization_id = ?
                    ORDER BY c.\`${dateCol}\` DESC LIMIT 3
                `;
                result.candidates = await db.query(candSql, [organizationId]);
            } else if (isCollege) {
                // Fallback to central candidates_db for legacy college setup
                const candSql = `
                    SELECT 
                        c.candidate_code, c.candidate_name, c.email, c.created_at,
                        c.candidate_created_by as added_by, c.register_no as reg_number,
                        u.first_name, u.last_name, u.email as admin_email
                    FROM candidates_db.college_candidates c
                    LEFT JOIN auth_db.users u ON u.id = c.candidate_created_by
                    WHERE c.organization_id = ?
                    ORDER BY c.created_at DESC LIMIT 3
                `;
                result.candidates = await db.query(candSql, [organizationId]);
            }
        } catch (e) {
            console.error('[RecentGrid] candidates ERROR:', e.message);
        }

        try {
            const tableCheck = await db.query(`SELECT TABLE_NAME FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_SCHEMA = ? AND TABLE_NAME IN ('candidate_positions', 'position_candidates', 'job_candidates')`, [tenantDb]);
            const tables = (tableCheck || []).map(t => t.TABLE_NAME);
            
            let tableName = null;
            let statusCol = 'status';
            let jobTitleJoin = 'pc.job_title';

            if (tables.includes('job_candidates')) {
                tableName = 'job_candidates';
                statusCol = 'recommendation';
                jobTitleJoin = 'j.requirement_name';
            } else if (tables.includes('position_candidates')) {
                tableName = 'position_candidates';
                statusCol = 'recommendation';
                jobTitleJoin = 'p.title';
            } else if (tables.includes('candidate_positions')) {
                tableName = 'candidate_positions';
                statusCol = 'status';
                jobTitleJoin = 'pc.job_title';
            }

            if (tableName) {
                const candTableCheck = await db.query(
                    `SELECT TABLE_NAME FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_SCHEMA = ? AND TABLE_NAME IN ('candidates', 'college_candidates')`,
                    [tenantDb]
                );
                const candTables = (candTableCheck || []).map(t => t.TABLE_NAME);
                const candTable = candTables.includes('candidates') ? 'candidates' : 
                                 (candTables.includes('college_candidates') ? 'college_candidates' : null);

                let candMetaJoin = '';
                let selectFields = 'pc.candidate_code, pc.candidate_name';
                
                if (tableName === 'job_candidates' && candTable) {
                    const isLocal = (candTable === 'candidates');
                    const pkCol = isLocal ? 'id' : 'candidate_id';
                    const codeCol = isLocal ? 'code' : 'candidate_code';
                    const nameExpr = isLocal ? "CONCAT(c.first_name, ' ', c.last_name)" : "c.candidate_name";
                    candMetaJoin = `LEFT JOIN \`${tenantDb}\`.\`${candTable}\` c ON c.\`${pkCol}\` = pc.candidate_id`;
                    selectFields = `c.\`${codeCol}\` as candidate_code, ${nameExpr} as candidate_name`;
                }

                const actorCol = (tableName === 'job_candidates') ? 'interview_scheduled_by' : 'created_by';

                const intSql = `
                    SELECT 
                        ${selectFields}, ${jobTitleJoin} as job_title, pc.updated_at, pc.\`${statusCol}\` as status,
                        pc.\`${actorCol}\` as added_by,
                        u.first_name, u.last_name, u.email as admin_email
                    FROM \`${tenantDb}\`.\`${tableName}\` pc
                    LEFT JOIN auth_db.users u ON u.id = pc.\`${actorCol}\`
                    ${candMetaJoin}
                    ${tables.includes('job_candidates') ? `LEFT JOIN \`${tenantDb}\`.jobs j ON j.id = pc.job_id` : ''}
                    ${tables.includes('position_candidates') ? `LEFT JOIN \`${tenantDb}\`.positions p ON p.id = pc.position_id` : ''}
                    WHERE 1=1
                    ${tableName === 'candidate_positions' ? 'AND pc.organization_id = ?' : ''}
                    ORDER BY pc.updated_at DESC LIMIT 3
                `;
                const intParams = (tableName === 'candidate_positions') ? [organizationId] : [];
                result.interviews = await db.query(intSql, intParams);
            }
        } catch (e) {
            console.error('[RecentGrid] interviews ERROR:', e.message);
        }

        try {
            const taskTableCheck = await db.query(`DESCRIBE \`${tenantDb}\`.tasks`);
            const taskCols = (taskTableCheck || []).map(c => c.Field);
            const hasSub = taskCols.includes('subject_id');
            const hasOrg = taskCols.includes('organization_id');

            const taskSql = `
                SELECT 
                    t.id as task_id, t.task_code, t.title, t.priority, t.end_date as due_date, t.created_at,
                    t.created_by as assigned_to,
                    COALESCE(d.name, t.dept_id) as department, 
                    COALESCE(b.name, t.branch_id) as branch, 
                    ${hasSub ? "COALESCE(s.name, t.subject_id) as subject, COALESCE(s.semester, 'N/A') as semester," : "NULL as subject, NULL as semester,"}
                    u.first_name, u.last_name, u.email as admin_email
                FROM \`${tenantDb}\`.tasks t
                LEFT JOIN \`${tenantDb}\`.college_departments d ON d.id = t.dept_id
                LEFT JOIN \`${tenantDb}\`.college_branches b ON b.id = t.branch_id
                ${hasSub ? `LEFT JOIN \`${tenantDb}\`.college_subjects s ON s.id = t.subject_id` : ''}
                LEFT JOIN auth_db.users u ON u.id = t.created_by
                WHERE 1=1
                ${hasOrg ? 'AND t.organization_id = ?' : ''}
                ORDER BY t.created_at DESC LIMIT 3
            `;
            const taskParams = hasOrg ? [organizationId] : [];
            result.tasks = await db.query(taskSql, taskParams);
        }
 catch (e) {
            console.error('[RecentGrid] tasks ERROR:', e.message);
        }

        return result;
    }

    static async getCandidateStatusCounts(tenantDb, organizationId) {
        if (!tenantDb || !organizationId) return [];

        try {
            const tableCheck = await db.query(`SELECT TABLE_NAME FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_SCHEMA = ? AND TABLE_NAME IN ('candidate_positions', 'position_candidates', 'job_candidates')`, [tenantDb]);
            const tables = (tableCheck || []).map(t => t.TABLE_NAME);
            let tableName = null;
            let statusCol = 'status';

            if (tables.includes('job_candidates')) {
                tableName = 'job_candidates';
                statusCol = 'recommendation';
            } else if (tables.includes('position_candidates')) {
                tableName = 'position_candidates';
                statusCol = 'recommendation';
            } else if (tables.includes('candidate_positions')) {
                tableName = 'candidate_positions';
                statusCol = 'status';
            }

            if (!tableName) return [];

            const colCheck = await db.query(`DESCRIBE \`${tenantDb}\`.\`${tableName}\``);
            const cols = (colCheck || []).map(c => c.Field);
            const hasOrg = cols.includes('organization_id');

            const sql = `
                SELECT
                    SUM(CASE WHEN \`${statusCol}\` IN ('Invited', 'invited', 'INVITED', 'PENDING') THEN 1 ELSE 0 END) as invited,
                    SUM(CASE WHEN \`${statusCol}\` IN ('Recommended', 'RECOMMENDED', 'recommended', 'SELECTED') THEN 1 ELSE 0 END) as recommended,
                    SUM(CASE WHEN \`${statusCol}\` IN ('Not-Recommended', 'NOT_RECOMMENDED', 'not-recommended', 'Not Recommended', 'RESUME_REJECTED') THEN 1 ELSE 0 END) as not_recommended,
                    SUM(CASE WHEN \`${statusCol}\` IN ('Cautiously Recommended', 'CAUTIOUSLY_RECOMMENDED', 'cautiously-recommended') THEN 1 ELSE 0 END) as cautiously_recommended,
                    SUM(CASE WHEN \`${statusCol}\` IN ('Resume Rejected', 'RESUME_REJECTED', 'resume-rejected', 'Resume-Rejected') THEN 1 ELSE 0 END) as resume_rejected
                FROM \`${tenantDb}\`.\`${tableName}\`
                WHERE 1=1
                ${hasOrg ? 'AND organization_id = ?' : ''}
            `;
            const params = hasOrg ? [organizationId] : [];
            const [row] = await db.query(sql, params);
            return [
                { metric: 'Invited', value: Number(row?.invited) || 0 },
                { metric: 'Recommended', value: Number(row?.recommended) || 0 },
                { metric: 'Rejected', value: Number(row?.not_recommended) || Number(row?.resume_rejected) || 0 },
                { metric: 'Cautious', value: Number(row?.cautiously_recommended) || 0 }
            ];
        } catch (e) {
            console.error('[DashboardService] getCandidateStatusCounts ERROR:', e.message);
            return [];
        }
    }
}

module.exports = DashboardService;
