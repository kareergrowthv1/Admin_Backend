const { v4: uuidv4 } = require('uuid');
const db = require('../config/db');
const ActivityLogService = require('./activityLogService');
const fileStorageUtil = require('../utils/fileStorageUtil');

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

const getNextJobCode = async (tenantDb) => {
    const rows = await db.query(
        `SELECT MAX(CAST(SUBSTRING(code, 4) AS UNSIGNED)) AS max_seq
         FROM \`${tenantDb}\`.jobs
         WHERE code REGEXP '^JOB[0-9]+'`,
        []
    );

    const maxSeq = Number(rows[0]?.max_seq || 0);
    const nextSeq = maxSeq + 1;
    return `JOB${String(nextSeq).padStart(4, '0')}`;
};

/**
 * Ensures 'job_role' column exists and legacy columns are removed (Self-healing migration)
 */
const ensureJobSchemaIsUpToDate = async (tenantDb) => {
    try {
        if (!tenantDb || tenantDb === 'auth_db') return;
        
        // 1. Add missing job_role
        const columns = await db.query(
            `SHOW COLUMNS FROM \`${tenantDb}\`.jobs LIKE 'job_role'`,
            []
        );
        if (columns.length === 0) {
            console.log(`[JobService] Adding missing 'job_role' column to ${tenantDb}.jobs`);
            await db.query(
                `ALTER TABLE \`${tenantDb}\`.jobs ADD COLUMN job_role ENUM('IT', 'NON_IT') DEFAULT 'IT' AFTER job_title`,
                []
            );
        }

        // 1.2 Add spoc_id if missing
        const spocIdCol = await db.query(
            `SHOW COLUMNS FROM \`${tenantDb}\`.jobs LIKE 'spoc_id'`,
            []
        );
        if (spocIdCol.length === 0) {
            console.log(`[JobService] Adding missing 'spoc_id' column to ${tenantDb}.jobs`);
            await db.query(
                `ALTER TABLE \`${tenantDb}\`.jobs ADD COLUMN spoc_id BINARY(16) AFTER manager_details`,
                []
            );
        }

        // 1.5 Ensure show_to_vendor exists and setup default to 0 (Private)
        const vendorCol = await db.query(
            `SHOW COLUMNS FROM \`${tenantDb}\`.jobs LIKE 'show_to_vendor'`,
            []
        );
        if (vendorCol.length > 0) {
            // Update default to 0 (Private) as per user request
            await db.query(
                `ALTER TABLE \`${tenantDb}\`.jobs ALTER COLUMN show_to_vendor SET DEFAULT 0`,
                []
            );
        } else {
            console.log(`[JobService] Adding missing 'show_to_vendor' column to ${tenantDb}.jobs`);
            await db.query(
                `ALTER TABLE \`${tenantDb}\`.jobs ADD COLUMN show_to_vendor TINYINT(1) DEFAULT 0`,
                []
            );
        }

        // 2. Remove legacy/unwanted columns if they exist (preventing INSERT fails)
        const legacyColumns = [
            'requirement_name', 
            'position_role', 
            'position_status', 
            'position_code', 
            'position_description',
            'dept_id',
            'branch_id'
        ];

        for (const col of legacyColumns) {
            const check = await db.query(
                `SHOW COLUMNS FROM \`${tenantDb}\`.jobs LIKE ?`,
                [col]
            );
            if (check.length > 0) {
                console.log(`[JobService] Removing legacy '${col}' column from ${tenantDb}.jobs`);
                try {
                    await db.query(
                        `ALTER TABLE \`${tenantDb}\`.jobs DROP COLUMN \`${col}\``,
                        []
                    );
                } catch (dropErr) {
                    console.error(`[JobService] Failed to drop ${col}:`, dropErr.message);
                }
            }
        }
    } catch (err) {
        console.error(`[JobService] Failed to ensure job schema in ${tenantDb}:`, err.message);
    }
};

/**
 * Create a new job with credit deduction
 * @param {string} tenantDb - Tenant database name
 * @param {object} jobData - Job data including requirement details, job details, and skills.
 * @returns {object} Created job
 */
const createJob = async (tenantDb, jobData) => {
    const {
        jobTitle,
        jobRole,
        jobDescription,
        clientId,
        priorityLevel,
        noOfPositions,
        offeredCtc,
        salaryRange,
        experienceRequired,
        location,
        jobType,
        managerDetails,
        spocId,
        spocName,
        spocEmail,
        spocPhone,
        jobDescriptionDocumentPath,
        jobDescriptionDocumentFileName,
        applicationDeadline,
        expectedStartDate,
        showToVendor = 1,
        internalNotes,
        mandatorySkills = [],
        optionalSkills = [],
        createdBy,
        userId,
        organizationId,
        actorName,
        actorRole
    } = jobData;

    let resolvedTenantDb = tenantDb;

    // Resolve tenant DB if missing
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
        throw new Error('Could not resolve tenant database for job creation');
    }

    // Ensure schema is up to date (Add missing columns, remove legacy ones)
    await ensureJobSchemaIsUpToDate(resolvedTenantDb);

    // Validate required fields
    if (!jobTitle || !noOfPositions || !createdBy) {
        const error = new Error('Job Title, No. of Positions, and CreatedBy are required');
        error.status = 400;
        throw error;
    }

    // Credit check
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
        const jobId = uuidv4();
        let jobCode = await getNextJobCode(resolvedTenantDb);
        const jobIdClean = jobId.replace(/-/g, '');

        const insertJobQuery = `
            INSERT INTO \`${resolvedTenantDb}\`.jobs (
                id, code, job_title, job_role, job_description,
                client_id, status, priority_level,
                no_of_positions, offered_ctc, salary_range, experience_required,
                location, job_type,
                manager_details, spoc_id, spoc_name, spoc_email, spoc_phone,
                job_description_document_path, job_description_document_file_name,
                application_deadline, expected_start_date, show_to_vendor, internal_notes,
                created_by, created_at, updated_at
            ) VALUES (UNHEX(?), ?, ?, ?, ?, UNHEX(?), ?, ?, ?, ?, ?, ?, ?, ?, ?, UNHEX(?), ?, ?, ?, ?, ?, ?, ?, ?, ?, UNHEX(?), NOW(), NOW())
        `;

        let inserted = false;
        let attempts = 0;
        while (!inserted && attempts < 3) {
            try {
                await db.query(insertJobQuery, [
                    jobIdClean,
                    jobCode,
                    jobTitle,
                    jobRole && jobRole.trim() !== '' ? jobRole.replace(' ', '_') : 'IT',
                    jobDescription || null,
                    clientId ? clientId.replace(/-/g, '') : null,
                    'ACTIVE',
                    priorityLevel || 'MEDIUM',
                    noOfPositions,
                    offeredCtc || null,
                    salaryRange || null,
                    experienceRequired || null,
                    location || null,
                    jobType || 'FULL_TIME',
                    managerDetails || null,
                    spocId ? spocId.replace(/-/g, '') : null,
                    spocName || null,
                    spocEmail || null,
                    spocPhone || null,
                    jobDescriptionDocumentPath || null,
                    jobDescriptionDocumentFileName || null,
                    toNormalizedDate(applicationDeadline),
                    toNormalizedDate(expectedStartDate),
                    showToVendor,
                    internalNotes || null,
                    createdBy.replace(/-/g, '')
                ]);
                inserted = true;
            } catch (insertError) {
                if (insertError && insertError.code === 'ER_DUP_ENTRY') {
                    attempts += 1;
                    jobCode = await getNextJobCode(resolvedTenantDb);
                    continue;
                }
                throw insertError;
            }
        }

        if (!inserted) throw new Error('Failed to generate unique job code');

        // Skills
        if (mandatorySkills.length > 0) {
            for (const skill of mandatorySkills) {
                await db.query(`INSERT INTO \`${resolvedTenantDb}\`.job_mandatory_skills (job_id, skill) VALUES (UNHEX(?), ?)`, [jobIdClean, skill]);
            }
        }
        if (optionalSkills.length > 0) {
            for (const skill of optionalSkills) {
                await db.query(`INSERT INTO \`${resolvedTenantDb}\`.job_optional_skills (job_id, skill) VALUES (UNHEX(?), ?)`, [jobIdClean, skill]);
            }
        }

        // Vendors
        const selectedVendors = jobData.selectedVendors || [];
        if (selectedVendors.length > 0) {
            for (const vendorId of selectedVendors) {
                const vendorIdClean = String(vendorId).replace(/-/g, '');
                // Check if vendor already has ID or if it's a numeric dummy ID from frontend
                // In production, these should be real UUIDs from the vendors table.
                // For now, only insert if it looks like a valid Hex or stays as is for testing.
                try {
                    await db.query(
                        `INSERT INTO \`${resolvedTenantDb}\`.job_vendors (id, job_id, vendor_id, assigned_by) 
                         VALUES (UNHEX(REPLACE(UUID(), '-', '')), UNHEX(?), UNHEX(?), UNHEX(?))`,
                        [jobIdClean, vendorIdClean, userId ? userId.replace(/-/g, '') : createdBy.replace(/-/g, '')]
                    );
                } catch (vErr) {
                    console.warn(`[JobService] Failed to assign vendor ${vendorId}:`, vErr.message);
                }
            }
        }


        // Deduct credit
        await db.query(`UPDATE \`${resolvedTenantDb}\`.credits SET utilized_position_credits = utilized_position_credits + 1, updated_at = NOW() WHERE is_active = 1`, []);

        // Log activity
        await ActivityLogService.logActivity(resolvedTenantDb, {
            organizationId,
            actorId: userId || createdBy,
            actorName: actorName || 'Admin',
            actorRole: actorRole || 'ATS',
            activityType: 'JOB_POSTED',
            activityTitle: jobTitle,
            activityDescription: `New job "${jobTitle}" posted.`,
            entityId: jobId,
            entityType: 'JOB'
        });

        return { id: jobId, code: jobCode, ...jobData };
    } catch (error) {
        console.error(`[JobService] createJob error:`, error);
        throw error;
    }
};

/**
 * Get all jobs for a tenant
 * @param {string} tenantDb 
 * @param {object} filters 
 */
const getJobs = async (tenantDb, filters = {}) => {
    // Ensure schema is up to date (Add missing columns, remove legacy ones)
    await ensureJobSchemaIsUpToDate(tenantDb);
    const { status, clientId, limit = 50, offset = 0 } = filters;
    let whereClause = "WHERE 1=1";
    const params = [];

    if (status && status !== 'ALL') {
        whereClause += " AND j.status = ?";
        params.push(status);
    }
    if (clientId) {
        whereClause += " AND j.client_id = UNHEX(?)";
        params.push(clientId.replace(/-/g, ''));
    }

    const countQuery = `SELECT COUNT(*) as total FROM \`${tenantDb}\`.jobs j ${whereClause}`;
    const countResult = await db.query(countQuery, params);
    const totalElements = countResult[0]?.total || 0;

    let query = `
        SELECT 
            HEX(j.id) as id, j.code, j.job_title as jobTitle, j.job_role as jobRole,
            j.status, j.priority_level as priorityLevel, j.no_of_positions as noOfPositions,
            j.offered_ctc as offeredCtc, j.salary_range as salaryRange,
            j.experience_required as experienceRequired, j.location,
            j.job_type as jobType, 
            COALESCE(CONCAT(u.first_name, ' ', u.last_name), j.spoc_name) as spocName,
            j.show_to_vendor as showToVendor,
            j.application_deadline as applicationDeadline,
            j.created_at as createdAt,
            HEX(j.client_id) as clientId,
            c.client_name as clientName
        FROM \`${tenantDb}\`.jobs j
        LEFT JOIN \`${tenantDb}\`.clients c ON j.client_id = c.id
        LEFT JOIN auth_db.users u ON j.spoc_id = u.id
        ${whereClause}
        ORDER BY j.created_at DESC LIMIT ? OFFSET ?
    `;
    const queryParams = [...params, Number(limit), Number(offset)];

    const rows = await db.query(query, queryParams);
    return { jobs: rows, totalElements };
};

/**
 * Get job by ID including skills
 * @param {string} tenantDb 
 * @param {string} jobId 
 */
const getJobById = async (tenantDb, jobId) => {
    const jobIdClean = jobId.replace(/-/g, '');
    const query = `
        SELECT 
            HEX(j.id) as id, j.code, j.job_title as jobTitle, j.job_role as jobRole,
            j.job_description as jobDescription, j.status, j.priority_level as priorityLevel,
            j.no_of_positions as noOfPositions, j.offered_ctc as offeredCtc,
            j.salary_range as salaryRange, j.experience_required as experienceRequired,
            j.location, j.job_type as jobType, j.manager_details as managerDetails,
            j.spoc_name as spocName, j.spoc_email as spocEmail, j.spoc_phone as spocPhone,
            j.job_description_document_path as jobDescriptionDocumentPath,
            j.job_description_document_file_name as jobDescriptionDocumentFileName,
            j.application_deadline as applicationDeadline,
            j.expected_start_date as expectedStartDate,
            j.show_to_vendor as showToVendor, j.internal_notes as internalNotes,
            j.created_at as createdAt,
            HEX(j.client_id) as clientId,
            c.client_name as clientName
        FROM \`${tenantDb}\`.jobs j
        LEFT JOIN \`${tenantDb}\`.clients c ON j.client_id = c.id
        WHERE j.id = UNHEX(?)
    `;
    const rows = await db.query(query, [jobIdClean]);
    if (rows.length === 0) return null;

    const job = rows[0];

    // Load skills
    const mandSkills = await db.query(`SELECT skill FROM \`${tenantDb}\`.job_mandatory_skills WHERE job_id = UNHEX(?)`, [jobIdClean]);
    const optSkills = await db.query(`SELECT skill FROM \`${tenantDb}\`.job_optional_skills WHERE job_id = UNHEX(?)`, [jobIdClean]);
    
    job.mandatorySkills = mandSkills.map(s => s.skill);
    job.optionalSkills = optSkills.map(s => s.skill);

    return job;
};

/**
 * Get simple list of clients for the tenant
 * @param {string} tenantDb 
 */
const getClients = async (tenantDb) => {
    const query = `SELECT HEX(id) as id, client_name as name FROM \`${tenantDb}\`.clients ORDER BY client_name ASC`;
    return await db.query(query, []);
};

/**
 * Update job JD path only
 */
const updateJobPathOnly = async (tenantDb, jobId, path, fileName) => {
    const jobIdClean = jobId.replace(/-/g, '');
    const query = `UPDATE \`${tenantDb}\`.jobs SET job_description_document_path = ?, job_description_document_file_name = ?, updated_at = NOW() WHERE id = UNHEX(?)`;
    return await db.query(query, [path, fileName, jobIdClean]);
};

/**
 * Get job description document details
 */
const getJobDescriptionDocument = async (tenantDb, jobId) => {
    const jobIdClean = jobId.replace(/-/g, '');
    const query = `SELECT job_description_document_path, job_description_document_file_name FROM \`${tenantDb}\`.jobs WHERE id = UNHEX(?)`;
    const rows = await db.query(query, [jobIdClean]);
    if (rows.length === 0 || !rows[0].job_description_document_path) {
        const error = new Error('Job description document not found');
        error.status = 404;
        throw error;
    }
    const { job_description_document_path: path, job_description_document_file_name: filename } = rows[0];
    const buffer = await fileStorageUtil.getFile(path);
    return { buffer, filename };
};

/**
 * Update job status
 */
const updateJobStatus = async (tenantDb, jobId, status) => {
    try {
        const query = `UPDATE \`${tenantDb}\`.jobs SET status = ? WHERE id = UNHEX(?)`;
        await db.query(query, [status.toUpperCase(), jobId.replace(/-/g, '')]);
        return true;
    } catch (error) {
        console.error(`[JobService] updateJobStatus error:`, error);
        throw error;
    }
};

/**
 * Update job visibility
 */
const updateJobVisibility = async (tenantDb, jobId, showToVendor) => {
    try {
        const query = `UPDATE \`${tenantDb}\`.jobs SET show_to_vendor = ? WHERE id = UNHEX(?)`;
        await db.query(query, [showToVendor ? 1 : 0, jobId.replace(/-/g, '')]);
        return true;
    } catch (error) {
        console.error(`[JobService] updateJobVisibility error:`, error);
        throw error;
    }
};

module.exports = {
    ensureJobSchemaIsUpToDate,
    createJob,
    getJobs,
    getJobById,
    getClients,
    updateJobPathOnly,
    getJobDescriptionDocument,
    updateJobStatus,
    updateJobVisibility
};

