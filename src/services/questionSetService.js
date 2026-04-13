const { v4: uuidv4 } = require('uuid');
const db = require('../config/db');

const getNextQuestionSetCode = async (tenantDb) => {
    const rows = await db.query(
        `SELECT MAX(CAST(SUBSTRING(question_set_code, 4) AS UNSIGNED)) AS max_seq
         FROM \`${tenantDb}\`.question_sets
         WHERE question_set_code REGEXP '^QUS[0-9]+'`,
        []
    );

    const maxSeq = Number(rows[0]?.max_seq || 0);
    const nextSeq = maxSeq + 1;
    return `QUS${String(nextSeq).padStart(4, '0')}`;
};

/**
 * Question Set Service
 */

const createQuestionSet = async (tenantDb, data) => {
    const {
        positionId,
        totalQuestions,
        totalDuration,
        interviewPlatform,
        interviewMode,
        createdBy,
        complexityLevel,
        generalQuestionsCount = 0,
        positionSpecificQuestionsCount = 0,
        codingQuestionsCount = 0,
        aptitudeQuestionsCount = 0,
        status = 'PUBLISHED',
        userId
    } = data;

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
        throw new Error('Could not resolve tenant database for question set creation');
    }

    const id = uuidv4();
    const idClean = id.replace(/-/g, '');
    let questionSetCode = await getNextQuestionSetCode(resolvedTenantDb);

    // Dynamic Column Detection: job_id (ATS) or position_id (College)
    const columnCheck = await db.query(
        `SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS 
         WHERE TABLE_SCHEMA = ? AND TABLE_NAME = 'question_sets' AND COLUMN_NAME IN ('job_id', 'position_id')`,
        [resolvedTenantDb]
    );
    const existingColumns = columnCheck.map(c => c.COLUMN_NAME);
    const idColumn = existingColumns.includes('job_id') ? 'job_id' : 'position_id';

    const query = `
        INSERT INTO \`${resolvedTenantDb}\`.question_sets (
            id, question_set_code, ${idColumn}, 
            total_questions, total_duration, 
            interview_platform, interview_mode, created_by, 
            complexity_level, general_questions_count, 
            position_specific_questions_count, coding_questions_count, 
            aptitude_questions_count, status, is_active, created_at, updated_at
        ) VALUES (UNHEX(?), ?, UNHEX(?), ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, NOW(), NOW())
    `;

    let inserted = false;
    let attempts = 0;
    while (!inserted && attempts < 3) {
        try {
            await db.query(query, [
                idClean,
                questionSetCode,
                (data.jobId || positionId).replace(/-/g, ''),
                totalQuestions,
                totalDuration,
                interviewPlatform,
                interviewMode,
                createdBy,
                complexityLevel,
                generalQuestionsCount,
                positionSpecificQuestionsCount,
                codingQuestionsCount,
                aptitudeQuestionsCount,
                status
            ]);
            inserted = true;
        } catch (insertError) {
            if (insertError && insertError.code === 'ER_DUP_ENTRY') {
                attempts += 1;
                questionSetCode = await getNextQuestionSetCode(resolvedTenantDb);
                continue;
            }
            throw insertError;
        }
    }

    if (!inserted) {
        throw new Error('Failed to generate unique question set code');
    }

    return { id, questionSetCode, ...data };
};

const getQuestionSets = async (tenantDb, filters = {}, userId) => {
    const { page = 0, size = 10, status, positionId, jobId } = filters;
    const offset = page * size;

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
        throw new Error('Could not resolve tenant database for question set retrieval');
    }

    // Check which column exists: job_id or position_id
    const columnCheck = await db.query(
        `SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS 
         WHERE TABLE_SCHEMA = ? AND TABLE_NAME = 'question_sets' AND COLUMN_NAME IN ('job_id', 'position_id')`,
        [resolvedTenantDb]
    );
    const existingColumns = columnCheck.map(c => c.COLUMN_NAME);
    const idColumn = existingColumns.includes('job_id') ? 'job_id' : 'position_id';

    let whereClause = 'WHERE is_active = 1';
    const params = [];

    if (status) {
        whereClause += ' AND status = ?';
        params.push(status);
    }

    if (positionId || jobId) {
        whereClause += ` AND ${idColumn} = UNHEX(?)`;
        params.push((positionId || jobId).replace(/-/g, ''));
    }

    const query = `
        SELECT 
            HEX(id) as id, question_set_code, 
            HEX(${idColumn}) as positionId,
            total_questions, total_duration,
            interview_platform, interview_mode, created_by,
            complexity_level, general_questions_count,
            position_specific_questions_count, coding_questions_count,
            aptitude_questions_count, status, is_active, created_at, updated_at
        FROM \`${resolvedTenantDb}\`.question_sets
        ${whereClause}
        ORDER BY created_at DESC
        LIMIT ? OFFSET ?
    `;

    const countQuery = `SELECT COUNT(*) as total FROM \`${resolvedTenantDb}\`.question_sets ${whereClause}`;

    const [rows, countRows] = await Promise.all([
        db.query(query, [...params, parseInt(size), parseInt(offset)]),
        db.query(countQuery, params)
    ]);

    return {
        content: rows,
        totalElements: countRows[0].total,
        page,
        size
    };
};

const getQuestionSetById = async (tenantDb, id, userId) => {
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
        throw new Error('Could not resolve tenant database for question set retrieval');
    }

    // Check which column exists: job_id or position_id
    const columnCheck = await db.query(
        `SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS 
         WHERE TABLE_SCHEMA = ? AND TABLE_NAME = 'question_sets' AND COLUMN_NAME IN ('job_id', 'position_id')`,
        [resolvedTenantDb]
    );
    const existingColumns = columnCheck.map(c => c.COLUMN_NAME);
    const idColumn = existingColumns.includes('job_id') ? 'job_id' : 'position_id';

    const query = `
        SELECT 
            HEX(id) as id, question_set_code, 
            HEX(${idColumn}) as positionId,
            total_questions, total_duration,
            interview_platform, interview_mode, created_by,
            complexity_level, general_questions_count,
            position_specific_questions_count, coding_questions_count,
            aptitude_questions_count, status, is_active, created_at, updated_at
        FROM \`${resolvedTenantDb}\`.question_sets
        WHERE id = UNHEX(?) AND is_active = 1
    `;

    const rows = await db.query(query, [id.replace(/-/g, '')]);
    return rows[0] || null;
};

const updateQuestionSet = async (tenantDb, id, data, userId) => {
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
        throw new Error('Could not resolve tenant database for question set update');
    }

    const fields = [];
    const params = [];

    const updatableFields = [
        'totalQuestions', 'totalDuration',
        'interviewPlatform', 'interviewMode', 'complexityLevel',
        'generalQuestionsCount', 'positionSpecificQuestionsCount',
        'codingQuestionsCount', 'aptitudeQuestionsCount', 'status'
    ];

    updatableFields.forEach(field => {
        if (data[field] !== undefined) {
            // Map camelCase to snake_case if necessary, or just use direct mapping
            const dbField = field.replace(/[A-Z]/g, letter => `_${letter.toLowerCase()}`);
            fields.push(`${dbField} = ?`);
            params.push(data[field]);
        }
    });

    if (fields.length === 0) return null;

    params.push(id.replace(/-/g, ''));

    const query = `
        UPDATE \`${resolvedTenantDb}\`.question_sets
        SET ${fields.join(', ')}, updated_at = NOW()
        WHERE id = UNHEX(?)
    `;

    await db.query(query, params);
    return getQuestionSetById(resolvedTenantDb, id, userId);
};

module.exports = {
    createQuestionSet,
    getQuestionSets,
    getQuestionSetById,
    updateQuestionSet
};
