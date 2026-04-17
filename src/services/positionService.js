const { v4: uuidv4 } = require('uuid');
const db = require('../config/db');
const { getDb, COLLECTIONS } = require('../config/mongo');
const ActivityLogService = require('./activityLogService');
const fileStorageUtil = require('../utils/fileStorageUtil');

/** Normalize position ID for DB: HEX(id) / UNHEX(?) expect 32-char hex (no dashes). */
function toPositionIdHex(id) {
    if (id == null) return id;
    return typeof id === 'string' ? id.replace(/-/g, '') : String(id).replace(/-/g, '');
}

/** Format 32-char hex as UUID (8-4-4-4-12) for consistent API responses. */
function formatPositionId(hex) {
    if (!hex || hex.length !== 32) return hex;
    const s = String(hex).replace(/-/g, '');
    if (s.length !== 32) return hex;
    return `${s.slice(0, 8)}-${s.slice(8, 12)}-${s.slice(12, 16)}-${s.slice(16, 20)}-${s.slice(20, 32)}`;
}

/** Normalize date for MySQL DATE column: ISO string -> 'YYYY-MM-DD' or null. */
function toNormalizedDate(value) {
    if (value == null || value === '') return null;
    const s = String(value).trim();
    if (!s) return null;
    const d = new Date(s);
    if (Number.isNaN(d.getTime())) return null;
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
}

/**
 * Get candidate count per position (candidates linked). Supports candidate_positions (VARCHAR position_id) and position_candidates (BINARY).
 * @param {string} tenantDb
 * @param {string[]} positionIdsHex - array of 32-char hex position ids
 * @returns {Promise<Record<string,number>>} map of positionIdHex -> count
 */
function normalizePositionIdHex(id) {
    return String(id || '').replace(/-/g, '').toUpperCase();
}

async function getCandidateCountByPositionIds(tenantDb, positionIdsHex) {
    const map = {};
    positionIdsHex.forEach(id => { map[normalizePositionIdHex(id)] = 0; });
    if (!positionIdsHex.length) return map;
    const tableCheck = await db.query(
        `SELECT TABLE_NAME FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_SCHEMA = ? AND TABLE_NAME IN ('candidate_positions', 'position_candidates')`,
        [tenantDb]
    );
    const tables = tableCheck.map(t => t.TABLE_NAME);
    if (tables.includes('candidate_positions')) {
        // Match position_id in any format (UUID with/without dashes, any case) by normalizing in SQL
        const hexList = positionIdsHex.map(h => normalizePositionIdHex(h));
        const placeholders = hexList.map(() => '?').join(',');
        const q = `SELECT LOWER(REPLACE(TRIM(position_id), '-', '')) as pid, COUNT(*) as cnt FROM \`${tenantDb}\`.candidate_positions WHERE LOWER(REPLACE(TRIM(position_id), '-', '')) IN (${placeholders}) GROUP BY LOWER(REPLACE(TRIM(position_id), '-', ''))`;
        const rows = await db.query(q, hexList.map(h => h.toLowerCase()));
        rows.forEach(r => {
            const hex = (r.pid || '').toUpperCase();
            if (hex && map[hex] !== undefined) map[hex] = Number(r.cnt) || 0;
        });
    } else if (tables.includes('position_candidates')) {
        const placeholders = positionIdsHex.map(() => 'UNHEX(?)').join(',');
        const q = `SELECT HEX(position_id) as pid, COUNT(*) as cnt FROM \`${tenantDb}\`.position_candidates WHERE position_id IN (${placeholders}) GROUP BY position_id`;
        const rows = await db.query(q, positionIdsHex);
        rows.forEach(r => {
            const hex = normalizePositionIdHex(r.pid);
            if (hex && map[hex] !== undefined) map[hex] = Number(r.cnt) || 0;
        });
    }
    return map;
}

/**
 * Get question set count per position.
 * @param {string} tenantDb
 * @param {string[]} positionIdsHex - array of 32-char hex position ids
 * @returns {Promise<Record<string,number>>} map of positionIdHex -> count
 */
async function getQuestionSetCountByPositionIds(tenantDb, positionIdsHex) {
    const map = {};
    positionIdsHex.forEach(id => { map[normalizePositionIdHex(id)] = 0; });
    if (!positionIdsHex.length) return map;
    const placeholders = positionIdsHex.map(() => 'UNHEX(?)').join(',');
    const q = `SELECT HEX(position_id) as pid, COUNT(*) as cnt FROM \`${tenantDb}\`.question_sets WHERE position_id IN (${placeholders}) GROUP BY position_id`;
    try {
        const rows = await db.query(q, positionIdsHex);
        rows.forEach(r => {
            const hex = normalizePositionIdHex(r.pid);
            if (hex && map[hex] !== undefined) map[hex] = Number(r.cnt) || 0;
        });
    } catch (e) {
        if (e.code !== 'ER_NO_SUCH_TABLE') throw e;
    }
    return map;
}

const getNextPositionCode = async (tenantDb) => {
    const rows = await db.query(
        `SELECT MAX(CAST(SUBSTRING(code, 4) AS UNSIGNED)) AS max_seq
         FROM \`${tenantDb}\`.positions
         WHERE code REGEXP '^POS[0-9]+'`,
        []
    );

    const maxSeq = Number(rows[0]?.max_seq || 0);
    const nextSeq = maxSeq + 1;
    return `POS${String(nextSeq).padStart(4, '0')}`;
};

/**
 * Create a new position with credit deduction
 * @param {string} tenantDb - Tenant database name
 * @param {object} positionData - Position data including title, domain, skills, etc.
 * @returns {object} Created position
 */
const createPosition = async (tenantDb, positionData) => {
    const {
        title,
        domainType,
        minimumExperience,
        maximumExperience,
        noOfPositions,
        mandatorySkills = [],
        optionalSkills = [],
        jobDescriptionPath,
        jobDescriptionFileName,
        expectedStartDate,
        applicationDeadline,
        company_name,
        createdBy,
        userId
    } = positionData;

    let resolvedTenantDb = tenantDb;

    // MIRROR: Fallback lookup if tenant is missing or auth_db
    if (!resolvedTenantDb || resolvedTenantDb === 'auth_db' || resolvedTenantDb === 'superadmin_db') {
        if (userId) {
            const userRows = await db.query(
                'SELECT client FROM auth_db.users WHERE id = ? AND is_active = true LIMIT 1',
                [userId]
            );
            if (userRows.length > 0 && userRows[0].client) {
                resolvedTenantDb = userRows[0].client;
            }
        }
    }

    if (!resolvedTenantDb || resolvedTenantDb === 'auth_db') {
        throw new Error('Could not resolve tenant database for position creation');
    }

    // Validate required fields
    if (!title || !domainType || !createdBy || !noOfPositions) {
        const error = new Error('Title, domainType, noOfPositions, and createdBy are required');
        error.status = 400;
        throw error;
    }

    if (mandatorySkills.length < 2) {
        const error = new Error('At least 2 mandatory skills are required');
        error.status = 400;
        throw error;
    }

    // Get current credits from tenant database
    const creditsQuery = `SELECT 
        total_position_credits, 
        utilized_position_credits,
        valid_till,
        is_active
    FROM \`${resolvedTenantDb}\`.credits 
    WHERE is_active = 1 
    ORDER BY created_at DESC LIMIT 1`;

    const creditsRows = await db.query(creditsQuery, []);

    if (creditsRows.length === 0) {
        const error = new Error('Credits not found for this organization');
        error.status = 404;
        throw error;
    }

    const credits = creditsRows[0];

    // Check if credits are expired
    if (credits.valid_till) {
        const validTill = new Date(credits.valid_till);
        const today = new Date();
        if (validTill < today) {
            const error = new Error('Credits have expired');
            error.status = 400;
            throw error;
        }
    }

    // Check if enough position credits available
    const totalPositionCredits = Number(credits.total_position_credits) || 0;
    const utilizedPositionCredits = Number(credits.utilized_position_credits) || 0;
    const remainingCredits = totalPositionCredits - utilizedPositionCredits;

    if (remainingCredits <= 0) {
        const error = new Error('Insufficient position credits available');
        error.status = 402;
        error.creditError = true;
        throw error;
    }

    try {
        // Create position ID
        const positionId = uuidv4();
        let positionCode = await getNextPositionCode(resolvedTenantDb);

        // Insert position into tenant database
        const insertPositionQuery = `
            INSERT INTO \`${resolvedTenantDb}\`.positions (
                id, 
                code, 
                title, 
                domain_type, 
                minimum_experience,
                maximum_experience,
                no_of_positions,
                job_description_document_path, 
                job_description_document_file_name,
                position_status,
                expected_start_date,
                application_deadline,
                company_name,
                created_by,
                created_at,
                updated_at
            ) VALUES (UNHEX(?), ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW(), NOW())
        `;

        const positionIdClean = positionId.replace(/-/g, '');

        let inserted = false;
        let attempts = 0;
        while (!inserted && attempts < 3) {
            try {
                await db.query(insertPositionQuery, [
                    positionIdClean,
                    positionCode,
                    title,
                    domainType,
                    minimumExperience || 0,
                    maximumExperience || 0,
                    noOfPositions,
                    jobDescriptionPath || null,
                    jobDescriptionFileName || null,
                    'ACTIVE', // Default status to ACTIVE
                    toNormalizedDate(expectedStartDate),
                    toNormalizedDate(applicationDeadline),
                    company_name || null,
                    createdBy
                ]);

                // Log activity
                try {
                    await ActivityLogService.logActivity(resolvedTenantDb, {
                        organizationId: (positionData.organizationId || positionData.organization_id),
                        actorId: userId || createdBy,
                        actorName: positionData.actorName || 'Admin',
                        actorRole: positionData.actorRole || 'Admin',
                        activityType: 'JOB_POSTED',
                        activityTitle: title, // Use position title directly
                        activityDescription: jobDescriptionFileName 
                            ? `New position "${title}" created with ${noOfPositions} openings. JD: ${jobDescriptionFileName}`
                            : `New position "${title}" created with ${noOfPositions} openings.`,
                        entityId: positionId,
                        entityType: 'POSITION',
                        metadata: {
                            positionName: title,
                            positionId: positionCode,
                            domainType,
                            noOfPositions,
                            jdFile: jobDescriptionFileName
                        }
                    });
                } catch (logErr) {
                    console.warn('[PositionService] Activity logging failed:', logErr.message);
                }

                inserted = true;
            } catch (insertError) {
                if (insertError && insertError.code === 'ER_DUP_ENTRY') {
                    attempts += 1;
                    positionCode = await getNextPositionCode(resolvedTenantDb);
                    continue;
                }
                throw insertError;
            }
        }

        if (!inserted) {
            throw new Error('Failed to generate unique position code');
        }

        // Insert mandatory skills (Batch)
        if (mandatorySkills && mandatorySkills.length > 0) {
            const values = [];
            const placeholders = [];
            mandatorySkills.forEach(skill => {
                placeholders.push('(UNHEX(?), ?)');
                values.push(positionIdClean, skill);
            });
            const insertSkillQuery = `INSERT INTO \`${resolvedTenantDb}\`.position_mandatory_skills (position_id, skill) VALUES ${placeholders.join(', ')}`;
            await db.query(insertSkillQuery, values);
        }

        // Insert optional skills (Batch)
        if (optionalSkills && optionalSkills.length > 0) {
            const values = [];
            const placeholders = [];
            optionalSkills.forEach(skill => {
                placeholders.push('(UNHEX(?), ?)');
                values.push(positionIdClean, skill);
            });
            const insertSkillQuery = `INSERT INTO \`${resolvedTenantDb}\`.position_optional_skills (position_id, skill) VALUES ${placeholders.join(', ')}`;
            await db.query(insertSkillQuery, values);
        }

        // Update utilized position credits
        const updateCreditsQuery = `
            UPDATE \`${resolvedTenantDb}\`.credits 
            SET utilized_position_credits = utilized_position_credits + 1,
                updated_at = NOW()
            WHERE is_active = 1
        `;

        await db.query(updateCreditsQuery, []);

        // Credit Utilized Notification (Position Credit)
        // Since this is a global notification (new position), we already have that trigger in positionController.
        // But the user asked for "how much it is been utilized for that also".
        // If it's a specific candidate being added to the position, it's done elsewhere.
        // If it's just the ADMIN utilizing a credit, we might want to notify the admin, 
        // but the system is for CANDIDATE notifications.
        // The user said: "if the admin added the test for this candidate ... also look the credits also how much it is been utilized for that also".
        // This confirms it's related to candidates.
        
        console.log(`[PositionService] Position created successfully: ${positionId}, Code: ${positionCode}`);

        return {
            id: positionId,
            code: positionCode,
            title,
            domainType,
            minimumExperience,
            maximumExperience,
            jobDescriptionDocumentPath: jobDescriptionPath,
            jobDescriptionDocumentFileName: jobDescriptionFileName,
            status: 'ACTIVE',
            noOfPositions: noOfPositions,
            createdBy: createdBy,
            interviewInviteSent: 0,
            completedInterviews: 0,
            expectedStartDate: expectedStartDate || null,
            applicationDeadline: applicationDeadline || null,
            companyName: company_name || null,
            internalNotes: null,
            mandatorySkills,
            optionalSkills,
            questionSets: [],
            positionCandidates: null,
            createdAt: new Date(),
            updatedAt: new Date()
        };
    } catch (error) {
        console.error(`[PositionService] Error creating position:`, error);
        throw error;
    }
};

/**
 * Get all positions for a tenant
 * @param {string} tenantDb - Tenant database name
 * @param {object} filters - Filter options (status, search, etc.)
 * @returns {array} List of positions
 */
const getPositions = async (tenantDb, filters = {}) => {
    try {
        const { status, search, limit = 10, offset = 0, page = 0, size = 10, userId, domain, experience, createdBy } = filters;
        const limitNum = parseInt(size) || 10;
        const offsetNum = (parseInt(page) * limitNum) || 0;

        let resolvedTenantDb = tenantDb;

        // MIRROR: Fallback lookup if tenant is missing or auth_db
        if (!resolvedTenantDb || resolvedTenantDb === 'auth_db' || resolvedTenantDb === 'superadmin_db') {
            if (userId) {
                const userRows = await db.query(
                    'SELECT client FROM auth_db.users WHERE id = ? AND is_active = true LIMIT 1',
                    [userId]
                );
                if (userRows.length > 0 && userRows[0].client) {
                    resolvedTenantDb = userRows[0].client;
                }
            }
        }

        if (!resolvedTenantDb || resolvedTenantDb === 'auth_db') {
            throw new Error('Could not resolve tenant database for positions retrieval');
        }

        const tableCheck = await db.query(
            `SELECT TABLE_NAME FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_SCHEMA = ? AND TABLE_NAME IN ('jobs', 'positions')`,
            [resolvedTenantDb]
        );
        const existingTables = (tableCheck || []).map(t => t.TABLE_NAME);
        const useJobs = existingTables.includes('jobs');
        const tableName = useJobs ? 'jobs' : 'positions';

        let query = `
            SELECT 
                HEX(p.id) as id,
                p.code,
                ${useJobs ? 'p.job_title' : 'p.title'} as title,
                ${useJobs ? 'p.job_type' : 'p.domain_type'} as domainType,
                ${useJobs ? 'p.experience_min' : 'p.minimum_experience'} as minimumExperience,
                ${useJobs ? 'p.experience_max' : 'p.maximum_experience'} as maximumExperience,
                ${useJobs ? 'p.job_description_document_path' : 'p.job_description_document_path'} as jobDescriptionDocumentPath,
                ${useJobs ? 'p.job_description_document_file_name' : 'p.job_description_document_file_name'} as jobDescriptionDocumentFileName,
                p.no_of_positions as noOfPositions,
                ${useJobs ? 'p.status' : 'p.position_status'} as status,
                p.internal_notes as internalNotes,
                ${useJobs ? 'NULL' : 'p.company_name'} as companyName,
                p.created_by as createdBy,
                p.id as raw_id,
                p.created_at as createdAt,
                p.updated_at as updatedAt
            FROM \`${resolvedTenantDb}\`.\`${tableName}\` p
            WHERE 1=1
        `;


        const params = [];
        let whereClause = '';

        if (status) {
            whereClause += ` AND ${useJobs ? 'p.status' : 'p.position_status'} = ?`;
            params.push(status);
        }


        if (search) {
            whereClause += ` AND (p.title LIKE ? OR p.code LIKE ?)`;
            params.push(`%${search}%`, `%${search}%`);
        }

        if (domain) {
            whereClause += ` AND p.domain_type = ?`;
            params.push(domain);
        }

        if (createdBy) {
            whereClause += ` AND p.created_by = ?`;
            params.push(createdBy);
        }

        if (experience) {
            if (experience === 'Freshers') {
                whereClause += ` AND p.minimum_experience = 0 AND p.maximum_experience <= 1`;
            } else {
                // Parse "X-Y Years"
                const match = experience.match(/(\d+)-(\d+)/);
                if (match) {
                    const minExp = parseInt(match[1]);
                    const maxExp = parseInt(match[2]);
                    // Overlap logic: position range overlaps with selected range
                    whereClause += ` AND ${useJobs ? 'p.experience_min' : 'p.minimum_experience'} <= ? AND ${useJobs ? 'p.experience_max' : 'p.maximum_experience'} >= ?`;
                    params.push(maxExp, minExp);

                }
            }
        }

        // 1. Get total count for pagination
        const countQuery = `SELECT COUNT(*) as total FROM \`${resolvedTenantDb}\`.\`${tableName}\` p WHERE 1=1 ${whereClause}`;

        const countResult = await db.query(countQuery, params);
        const totalElements = countResult[0]?.total || 0;

        // 2. Get positions data
        let selectQuery = query + whereClause + ` ORDER BY p.created_at DESC LIMIT ? OFFSET ?`;
        const selectParams = [...params, limitNum, offsetNum];

        const rows = await db.query(selectQuery, selectParams);

        // Batch-fetch candidate counts and question set counts per position
        const positionIdsHex = rows.map(r => r.id);
        const candidateCountMap = await getCandidateCountByPositionIds(resolvedTenantDb, positionIdsHex);
        const questionSetCountMap = await getQuestionSetCountByPositionIds(resolvedTenantDb, positionIdsHex);

        // For each position, fetch skills and attach counts
        const positions = await Promise.all(
            rows.map(async (position) => {
                const mandatorySkillsQuery = `
                    SELECT skill FROM \`${resolvedTenantDb}\`.position_mandatory_skills 
                    WHERE position_id = UNHEX(?)
                `;
                const optionalSkillsQuery = `
                    SELECT skill FROM \`${resolvedTenantDb}\`.position_optional_skills 
                    WHERE position_id = UNHEX(?)
                `;

                const mandatorySkills = await db.query(mandatorySkillsQuery, [position.id]);
                const optionalSkills = await db.query(optionalSkillsQuery, [position.id]);

                return {
                    id: formatPositionId(position.id),
                    code: position.code,
                    title: position.title,
                    domainType: position.domainType,
                    minimumExperience: position.minimumExperience || 0,
                    maximumExperience: position.maximumExperience || 0,
                    jobDescriptionDocumentPath: position.jobDescriptionDocumentPath,
                    jobDescriptionDocumentFileName: position.jobDescriptionDocumentFileName,
                    status: position.status,
                    noOfPositions: position.noOfPositions,
                    createdBy: position.createdBy,
                    interviewInviteSent: candidateCountMap[normalizePositionIdHex(position.id)] ?? position.interviewInviteSent ?? 0,
                    completedInterviews: position.completedInterviews || 0,
                    candidatesLinked: candidateCountMap[normalizePositionIdHex(position.id)] ?? 0,
                    questionSetCount: questionSetCountMap[normalizePositionIdHex(position.id)] ?? 0,
                    expectedStartDate: position.expectedStartDate,
                    applicationDeadline: position.applicationDeadline,
                    companyName: position.companyName,
                    internalNotes: position.internalNotes,
                    mandatorySkills: mandatorySkills.map((s) => s.skill),
                    optionalSkills: optionalSkills.map((s) => s.skill),
                    questionSetIds: [], // Placeholder
                    createdAt: position.createdAt,
                    updatedAt: position.updatedAt
                };
            })
        );

        console.log(`[PositionService] Retrieved ${positions.length} positions`);
        return {
            positions,
            totalElements
        };
    } catch (error) {
        console.error(`[PositionService] Error retrieving positions:`, error);
        throw error;
    }
};

/**
 * Get position by ID
 * @param {string} tenantDb - Tenant database name
 * @param {string} positionId - Position ID
 * @returns {object} Position details
 */
const getPositionById = async (tenantDb, positionId, userId) => {
    try {
        let resolvedTenantDb = tenantDb;

        // MIRROR: Fallback lookup
        if (!resolvedTenantDb || resolvedTenantDb === 'auth_db' || resolvedTenantDb === 'superadmin_db') {
            if (userId) {
                const userRows = await db.query(
                    'SELECT client FROM auth_db.users WHERE id = ? AND is_active = true LIMIT 1',
                    [userId]
                );
                if (userRows.length > 0 && userRows[0].client) {
                    resolvedTenantDb = userRows[0].client;
                }
            }
        }

        if (!resolvedTenantDb || resolvedTenantDb === 'auth_db') {
            throw new Error('Could not resolve tenant database for position retrieval');
        }

        const tableCheck = await db.query(
            `SELECT TABLE_NAME FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_SCHEMA = ? AND TABLE_NAME IN ('jobs', 'positions')`,
            [resolvedTenantDb]
        );
        const existingTables = (tableCheck || []).map(t => t.TABLE_NAME);
        const useJobs = existingTables.includes('jobs');
        const tableName = useJobs ? 'jobs' : 'positions';

        const positionIdHex = toPositionIdHex(positionId);
        const query = `
            SELECT 
                HEX(p.id) as id,
                p.code,
                ${useJobs ? 'p.job_title' : 'p.title'} as title,
                ${useJobs ? 'p.job_type' : 'p.domain_type'} as domainType,
                ${useJobs ? 'p.experience_min' : 'p.minimum_experience'} as minimumExperience,
                ${useJobs ? 'p.experience_max' : 'p.maximum_experience'} as maximumExperience,
                p.no_of_positions as noOfPositions,
                ${useJobs ? 'p.status' : 'p.position_status'} as status,
                ${useJobs ? 'p.interview_invite_sent' : 'p.interview_invite_sent'} as interviewInviteSent,
                ${useJobs ? 'p.completed_interviews' : 'p.completed_interviews'} as completedInterviews,
                p.expected_start_date as expectedStartDate,
                p.application_deadline as applicationDeadline,
                ${useJobs ? 'NULL' : 'p.company_name'} as companyName,
                p.job_description_document_path as jobDescriptionDocumentPath,
                p.job_description_document_file_name as jobDescriptionDocumentFileName,
                p.internal_notes as internalNotes,
                p.created_by as createdBy,
                p.created_at as createdAt,
                p.updated_at as updatedAt
            FROM \`${resolvedTenantDb}\`.\`${tableName}\` p
            WHERE HEX(p.id) = ?
            LIMIT 1
        `;


        const rows = await db.query(query, [positionIdHex]);

        if (rows.length === 0) {
            const error = new Error('Position not found');
            error.status = 404;
            throw error;
        }

        const position = rows[0];

        // Fetch skills
        const mandatorySkillsQuery = `
            SELECT skill FROM \`${resolvedTenantDb}\`.position_mandatory_skills 
            WHERE position_id = UNHEX(?)
        `;
        const optionalSkillsQuery = `
            SELECT skill FROM \`${resolvedTenantDb}\`.position_optional_skills 
            WHERE position_id = UNHEX(?)
        `;

        const mandatorySkills = await db.query(mandatorySkillsQuery, [positionIdHex]);
        const optionalSkills = await db.query(optionalSkillsQuery, [positionIdHex]);

        const posIdHex = position.id || positionIdHex;
        const [candidateCountMap, questionSetCountMap] = await Promise.all([
            getCandidateCountByPositionIds(resolvedTenantDb, [posIdHex]),
            getQuestionSetCountByPositionIds(resolvedTenantDb, [posIdHex])
        ]);

        console.log(`[PositionService] Retrieved position: ${positionId}`);

        return {
            id: formatPositionId(position.id),
            code: position.code,
            title: position.title,
            domainType: position.domainType,
            minimumExperience: position.minimumExperience || 0,
            maximumExperience: position.maximumExperience || 0,
            jobDescriptionDocumentPath: position.jobDescriptionDocumentPath,
            jobDescriptionDocumentFileName: position.jobDescriptionDocumentFileName,
            status: position.status,
            noOfPositions: position.noOfPositions,
            createdBy: position.createdBy,
            interviewInviteSent: candidateCountMap[normalizePositionIdHex(position.id)] ?? position.interviewInviteSent ?? 0,
            completedInterviews: position.completedInterviews || 0,
            candidatesLinked: candidateCountMap[normalizePositionIdHex(position.id)] ?? 0,
            questionSetCount: questionSetCountMap[normalizePositionIdHex(position.id)] ?? 0,
            expectedStartDate: position.expectedStartDate,
            applicationDeadline: position.applicationDeadline,
            internalNotes: position.internalNotes,
            mandatorySkills: mandatorySkills.map((s) => s.skill),
            optionalSkills: optionalSkills.map((s) => s.skill),
            questionSetIds: [], // Placeholder
            createdAt: position.createdAt,
            updatedAt: position.updatedAt
        };
    } catch (error) {
        console.error(`[PositionService] Error retrieving position:`, error);
        throw error;
    }
};

/**
 * Update position status (ACTIVE, CLOSED, ON_HOLD, DRAFT)
 * @param {string} tenantDb - Tenant database name
 * @param {string} positionId - Position ID
 * @param {string} newStatus - New status
 * @returns {object} Updated position
 */
const updatePositionStatus = async (tenantDb, positionId, newStatus, userId) => {
    try {
        let resolvedTenantDb = tenantDb;

        // MIRROR: Fallback lookup
        if (!resolvedTenantDb || resolvedTenantDb === 'auth_db' || resolvedTenantDb === 'superadmin_db') {
            if (userId) {
                const userRows = await db.query(
                    'SELECT client FROM auth_db.users WHERE id = ? AND is_active = true LIMIT 1',
                    [userId]
                );
                if (userRows.length > 0 && userRows[0].client) {
                    resolvedTenantDb = userRows[0].client;
                }
            }
        }

        if (!resolvedTenantDb || resolvedTenantDb === 'auth_db') {
            throw new Error('Could not resolve tenant database for position status update');
        }

        // Validate status
        const validStatuses = ['ACTIVE', 'CLOSED', 'ON_HOLD', 'DRAFT', 'EXPIRED', 'INACTIVE'];
        if (!validStatuses.includes(newStatus)) {
            const error = new Error(`Invalid status. Allowed values: ${validStatuses.join(', ')}`);
            error.status = 400;
            throw error;
        }

        const positionIdHex = toPositionIdHex(positionId);
        // Check if position exists
        const positionCheckQuery = `
            SELECT id FROM \`${resolvedTenantDb}\`.positions 
            WHERE HEX(id) = ?
        `;
        const positionRows = await db.query(positionCheckQuery, [positionIdHex]);

        if (positionRows.length === 0) {
            const error = new Error('Position not found');
            error.status = 404;
            throw error;
        }

        // Update position status
        const updateQuery = `
            UPDATE \`${resolvedTenantDb}\`.positions 
            SET position_status = ?,
                updated_at = NOW()
            WHERE HEX(id) = ?
        `;

        await db.query(updateQuery, [newStatus, positionIdHex]);

        console.log(`[PositionService] Position status updated: ${positionId} -> ${newStatus}`);

        // Return updated position
        return getPositionById(resolvedTenantDb, positionId, userId);
    } catch (error) {
        console.error(`[PositionService] Error updating position status:`, error);
        throw error;
    }
};

/**
 * Update position (partial update)
 * @param {string} tenantDb - Tenant database name
 * @param {string} positionId - Position ID
 * @param {object} updateData - Data to update
 * @returns {object} Updated position
 */
const updatePosition = async (tenantDb, positionId, updateData, userId) => {
    try {
        let resolvedTenantDb = tenantDb;

        // MIRROR: Fallback lookup
        if (!resolvedTenantDb || resolvedTenantDb === 'auth_db' || resolvedTenantDb === 'superadmin_db') {
            if (userId) {
                const userRows = await db.query(
                    'SELECT client FROM auth_db.users WHERE id = ? AND is_active = true LIMIT 1',
                    [userId]
                );
                if (userRows.length > 0) {
                    resolvedTenantDb = userRows[0].client;
                }
            }
        }

        if (!resolvedTenantDb || resolvedTenantDb === 'auth_db') {
            const error = new Error('Tenant context missing for position update');
            error.status = 400;
            throw error;
        }

        const {
            title,
            domainType,
            minimumExperience,
            maximumExperience,
            noOfPositions,
            mandatorySkills,
            optionalSkills,
            expectedStartDate,
            applicationDeadline,
            internalNotes,
            jobDescriptionDocumentPath,
            jobDescriptionDocumentFileName
        } = updateData;

        // Build dynamic update query
        const updateFields = [];
        const params = [];

        if (title !== undefined) {
            updateFields.push('title = ?');
            params.push(title);
        }
        if (domainType !== undefined) {
            updateFields.push('domain_type = ?');
            params.push(domainType);
        }
        if (minimumExperience !== undefined) {
            updateFields.push('minimum_experience = ?');
            params.push(minimumExperience);
        }
        if (maximumExperience !== undefined) {
            updateFields.push('maximum_experience = ?');
            params.push(maximumExperience);
        }
        if (noOfPositions !== undefined) {
            updateFields.push('no_of_positions = ?');
            params.push(noOfPositions);
        }
        if (expectedStartDate !== undefined) {
            updateFields.push('expected_start_date = ?');
            params.push(toNormalizedDate(expectedStartDate));
        }
        if (applicationDeadline !== undefined) {
            updateFields.push('application_deadline = ?');
            params.push(toNormalizedDate(applicationDeadline));
        }
        if (internalNotes !== undefined) {
            updateFields.push('internal_notes = ?');
            params.push(internalNotes);
        }
        if (jobDescriptionDocumentPath !== undefined) {
            updateFields.push('job_description_document_path = ?');
            params.push(jobDescriptionDocumentPath);
        }
        if (jobDescriptionDocumentFileName !== undefined) {
            updateFields.push('job_description_document_file_name = ?');
            params.push(jobDescriptionDocumentFileName);
        }
        // job_description is not used in DB

        const positionIdHex = toPositionIdHex(positionId);
        if (updateFields.length > 0) {
            updateFields.push('updated_at = NOW()');

            const updateQuery = `
                UPDATE \`${resolvedTenantDb}\`.positions 
                SET ${updateFields.join(', ')}
                WHERE HEX(id) = ?
            `;
            params.push(positionIdHex);

            await db.query(updateQuery, params);
        }

        // Update skills if provided
        if (mandatorySkills && Array.isArray(mandatorySkills)) {
            // Delete existing mandatory skills
            const deleteQuery = `
                DELETE FROM \`${resolvedTenantDb}\`.position_mandatory_skills 
                WHERE position_id = UNHEX(?)
            `;
            await db.query(deleteQuery, [positionIdHex]);

            // Insert new mandatory skills
            for (const skill of mandatorySkills) {
                const insertQuery = `
                    INSERT INTO \`${resolvedTenantDb}\`.position_mandatory_skills (position_id, skill)
                    VALUES (UNHEX(?), ?)
                `;
                await db.query(insertQuery, [positionIdHex, skill]);
            }
        }

        if (optionalSkills && Array.isArray(optionalSkills)) {
            // Delete existing optional skills
            const deleteQuery = `
                DELETE FROM \`${resolvedTenantDb}\`.position_optional_skills 
                WHERE position_id = UNHEX(?)
            `;
            await db.query(deleteQuery, [positionIdHex]);

            // Insert new optional skills
            for (const skill of optionalSkills) {
                const insertQuery = `
                    INSERT INTO \`${resolvedTenantDb}\`.position_optional_skills (position_id, skill)
                    VALUES (UNHEX(?), ?)
                `;
                await db.query(insertQuery, [positionIdHex, skill]);
            }
        }

        console.log(`[PositionService] Position updated: ${positionId}`);

        // Log activity
        try {
            await ActivityLogService.logActivity(resolvedTenantDb, {
                organizationId: (positionData.organizationId || positionData.organization_id),
                actorId: userId || positionData.userId,
                actorName: positionData.actorName || 'Admin',
                actorRole: positionData.actorRole || 'Admin',
                activityType: 'UPDATE',
                activityTitle: 'Position Updated',
                activityDescription: `Position "${title || 'N/A'}" was updated`,
                entityId: positionId,
                entityType: 'POSITION',
                metadata: {
                    positionName: title,
                    domainType,
                    noOfPositions
                }
            });
        } catch (logErr) {
            console.warn('[PositionService] Activity logging failed (update):', logErr.message);
        }

        // Return updated position
        return getPositionById(resolvedTenantDb, positionId, userId);
    } catch (error) {
        console.error(`[PositionService] Error updating position:`, error);
        throw error;
    }
};

/**
 * Get position counts by status
 * @param {string} tenantDb - Tenant database name
 * @param {string} userId - User ID for fallback context
 * @returns {object} Counts grouped by status
 */
const getPositionCounts = async (tenantDb, userId, dataFilter = {}) => {
    try {
        let resolvedTenantDb = tenantDb;

        // Fallback lookup
        if (!resolvedTenantDb || resolvedTenantDb === 'auth_db' || resolvedTenantDb === 'superadmin_db') {
            if (userId) {
                const userRows = await db.query(
                    'SELECT client FROM auth_db.users WHERE id = ? AND is_active = true LIMIT 1',
                    [userId]
                );
                if (userRows.length > 0 && userRows[0].client) {
                    resolvedTenantDb = userRows[0].client;
                }
            }
        }

        if (!resolvedTenantDb || resolvedTenantDb === 'auth_db') {
            throw new Error('Could not resolve tenant database for position counts');
        }

        let whereClause = 'WHERE 1=1';
        const params = [];
        if (dataFilter.createdBy) {
            whereClause += ' AND created_by = ?';
            params.push(dataFilter.createdBy);
        }

        const query = `
            SELECT 
                position_status as status,
                COUNT(*) as count
            FROM \`${resolvedTenantDb}\`.positions
            ${whereClause}
            GROUP BY position_status
        `;

        const rows = await db.query(query, params);

        // Map rows to a more usable object format
        const counts = {
            ALL: 0,
            ACTIVE: 0,
            CLOSED: 0,
            ON_HOLD: 0,
            DRAFT: 0,
            EXPIRED: 0,
            INACTIVE: 0
        };

        let total = 0;
        rows.forEach(row => {
            if (counts.hasOwnProperty(row.status)) {
                counts[row.status] = parseInt(row.count) || 0;
                total += parseInt(row.count) || 0;
            }
        });
        counts.ALL = total;

        return counts;
    } catch (error) {
        console.error(`[PositionService] Error getting position counts:`, error);
        throw error;
    }
};

/**
 * Get dynamic filter metadata (Domains, Experience Ranges)
 * @param {string} tenantDb - Tenant database name
 * @param {string} userId - User ID for fallback
 * @returns {object} Filter options
 */
const getFilterMetadata = async (tenantDb, userId, dataFilter = {}) => {
    try {
        let resolvedTenantDb = tenantDb;

        // Fallback lookup
        if (!resolvedTenantDb || resolvedTenantDb === 'auth_db' || resolvedTenantDb === 'superadmin_db') {
            if (userId) {
                const userRows = await db.query(
                    'SELECT client FROM auth_db.users WHERE id = ? AND is_active = true LIMIT 1',
                    [userId]
                );
                if (userRows.length > 0 && userRows[0].client) {
                    resolvedTenantDb = userRows[0].client;
                }
            }
        }

        if (!resolvedTenantDb || resolvedTenantDb === 'auth_db') {
            throw new Error('Could not resolve tenant database for filter metadata');
        }

        let whereClause = 'WHERE 1=1';
        const params = [];
        if (dataFilter.createdBy) {
            whereClause += ' AND created_by = ?';
            params.push(dataFilter.createdBy);
        }

        // Get distinct domains
        const domainQuery = `SELECT DISTINCT domain_type as domain FROM \`${resolvedTenantDb}\`.positions ${whereClause} AND domain_type IS NOT NULL AND domain_type != ''`;
        const domainRows = await db.query(domainQuery, params);

        // Get distinct experience ranges
        const expQuery = `SELECT DISTINCT minimum_experience, maximum_experience FROM \`${resolvedTenantDb}\`.positions ${whereClause} ORDER BY minimum_experience ASC, maximum_experience ASC`;
        const expRows = await db.query(expQuery, params);

        const domains = domainRows.map(r => r.domain);
        const experiences = expRows.map(r => `${r.minimum_experience}-${r.maximum_experience} Years`);

        return {
            domains: domains.length > 0 ? domains : ['IT', 'NON-IT'], // Default fallback if empty
            experiences: experiences.length > 0 ? experiences : ['Freshers', '0-1 Years', '1-2 Years', '2-3 Years', '4-5 Years'] // Default fallback if empty
        };
    } catch (error) {
        console.error(`[PositionService] Error getting filter metadata:`, error);
        throw error;
    }
};

/**
 * Update only job description path and filename on a position (no file storage).
 * Used after client uploads JD and calls PUT with the path.
 */
const updatePositionPathOnly = async (tenantDb, positionId, relativePath, fileName, jdText) => {
    const positionIdHex = toPositionIdHex(positionId);
    const updateQuery = `
        UPDATE \`${tenantDb}\`.positions
        SET job_description_document_path = ?,
            job_description_document_file_name = ?,
            updated_at = NOW()
        WHERE HEX(id) = ?
    `;
    await db.query(updateQuery, [relativePath, fileName || 'document.pdf', positionIdHex]);
};

/**
 * Store job description file for a position. Saves under qwikhire-prod-storage/6464-0160-2190-198-79266/JD and updates position.
 * @param {string} tenantDb - Tenant database name
 * @param {string} positionId - Position ID (UUID string)
 * @param {object} file - Multer file { buffer, originalname }
 * @returns {object} Updated position
 */
const storeJobDescriptionFile = async (tenantDb, positionId, file) => {
    if (!file || (!file.buffer && !file.path)) {
        const error = new Error('Job description file is required');
        error.status = 400;
        throw error;
    }
    let resolvedTenantDb = tenantDb;
    if (!resolvedTenantDb || resolvedTenantDb === 'auth_db' || resolvedTenantDb === 'superadmin_db') {
        throw new Error('Could not resolve tenant database for job description upload');
    }
    const { relativePath } = await fileStorageUtil.storeFile('JD', file);
    await updatePositionPathOnly(resolvedTenantDb, positionId, relativePath, file.originalname || 'document.pdf');
    return getPositionById(resolvedTenantDb, positionId, null);
};

/**
 * Get job description file buffer for a position (from qwikhire-prod-storage/.../JD)
 * @param {string} tenantDb - Tenant database name
 * @param {string} positionId - Position ID
 * @returns {{ buffer: Buffer, filename: string }}
 */
const getJobDescriptionDocument = async (tenantDb, positionId) => {
    const position = await getPositionById(tenantDb, positionId, null);
    const pathOrName = position.jobDescriptionDocumentPath;
    const filename = position.jobDescriptionDocumentFileName || 'job-description.pdf';
    if (!pathOrName) {
        const error = new Error('No job description document found for this position');
        error.status = 404;
        throw error;
    }
    // New storage: relative path 6464-0160-2190-198-79266/JD/filename
    const buffer = await fileStorageUtil.retrieveFileByRelativePath(pathOrName);
    return { buffer, filename };
};

module.exports = {
    createPosition,
    getPositions,
    getPositionById,
    updatePositionStatus,
    updatePosition,
    updatePositionPathOnly,
    getPositionCounts,
    getFilterMetadata,
    storeJobDescriptionFile,
    getJobDescriptionDocument
};
