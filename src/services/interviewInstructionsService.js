const { v4: uuidv4 } = require('uuid');
const db = require('../config/db');

/**
 * Interview Instructions Service
 */

const saveInstructions = async (tenantDb, data, userId) => {
    const {
        questionSetId,
        positionId,
        contentType,
        content,
        isActive = 1
    } = data;

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
        throw new Error('Could not resolve tenant database for instructions saving');
    }

    const set_id_clean = questionSetId.replace(/-/g, '');
    const pos_id_clean = positionId.replace(/-/g, '');

    // Check if instructions already exist for this set and position (active)
    const existingRows = await db.query(
        `SELECT HEX(id) as id FROM \`${resolvedTenantDb}\`.interview_instructions 
         WHERE question_set_id = UNHEX(?) AND position_id = UNHEX(?) AND is_active = 1`,
        [set_id_clean, pos_id_clean]
    );

    if (existingRows.length > 0) {
        // Update existing instead of creating new if we want to maintain one active
        return updateInstructions(resolvedTenantDb, existingRows[0].id, { content, contentType, isActive }, userId);
    }

    const id = uuidv4();
    const idClean = id.replace(/-/g, '');

    const query = `
        INSERT INTO \`${resolvedTenantDb}\`.interview_instructions (
            id, question_set_id, position_id, content_type, content, is_active,
            created_at, updated_at
        ) VALUES (UNHEX(?), UNHEX(?), UNHEX(?), ?, ?, ?, NOW(), NOW())
    `;

    await db.query(query, [
        idClean,
        set_id_clean,
        pos_id_clean,
        contentType,
        content,
        isActive
    ]);

    return { id, questionSetId, positionId, ...data };
};

const getInstructionsById = async (tenantDb, id, userId) => {
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
        throw new Error('Could not resolve tenant database for instructions retrieval');
    }

    const query = `
        SELECT 
            HEX(id) as id, HEX(question_set_id) as questionSetId,
            HEX(position_id) as positionId,
            content_type as contentType, content,
            is_active as isActive,
            created_at as createdAt, updated_at as updatedAt
        FROM \`${resolvedTenantDb}\`.interview_instructions
        WHERE id = UNHEX(?)
    `;

    const rows = await db.query(query, [id.replace(/-/g, '')]);
    return rows[0] || null;
};

const getInstructionsByQuestionSetId = async (tenantDb, questionSetId, userId) => {
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
        throw new Error('Could not resolve tenant database for instructions retrieval');
    }

    const query = `
        SELECT 
            HEX(id) as id, HEX(question_set_id) as questionSetId,
            HEX(position_id) as positionId,
            content_type as contentType, content,
            is_active as isActive,
            created_at as createdAt, updated_at as updatedAt
        FROM \`${resolvedTenantDb}\`.interview_instructions
        WHERE question_set_id = UNHEX(?) AND is_active = 1
        ORDER BY created_at DESC
    `;

    const rows = await db.query(query, [questionSetId.replace(/-/g, '')]);
    return rows;
};

const updateInstructions = async (tenantDb, id, data, userId) => {
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
        throw new Error('Could not resolve tenant database for instructions update');
    }

    const fields = [];
    const params = [];

    const updatableFields = ['contentType', 'content', 'isActive'];

    updatableFields.forEach(field => {
        if (data[field] !== undefined) {
            const dbField = field.replace(/[A-Z]/g, letter => `_${letter.toLowerCase()}`);
            fields.push(`${dbField} = ?`);
            params.push(data[field]);
        }
    });

    if (fields.length === 0) return null;

    params.push(id.replace(/-/g, ''));

    const query = `
        UPDATE \`${resolvedTenantDb}\`.interview_instructions
        SET ${fields.join(', ')}, updated_at = NOW()
        WHERE id = UNHEX(?)
    `;

    await db.query(query, params);
    return getInstructionsById(resolvedTenantDb, id, userId);
};

module.exports = {
    saveInstructions,
    getInstructionsById,
    getInstructionsByQuestionSetId,
    updateInstructions
};
