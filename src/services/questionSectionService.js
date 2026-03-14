const { v4: uuidv4 } = require('uuid');
const db = require('../config/db');

/** Format seconds as HH:MM:SS for round given time (e.g. 260 -> "00:04:20"). */
function secondsToGivenTime(seconds) {
    const s = Math.max(0, Math.floor(Number(seconds) || 0));
    const h = Math.floor(s / 3600);
    const m = Math.floor((s % 3600) / 60);
    const sec = s % 60;
    return [h, m, sec].map((n) => String(n).padStart(2, '0')).join(':');
}

/**
 * From question section data, compute round given times (round1=General, round2=Position, round3=Coding, round4=Aptitude).
 * For CONVERSATIONAL rounds (round1 and round2) each main question also generates crossCountGeneral / crossCountPosition
 * follow-up questions that inherit the same (prepareTime + answerTime) — so we multiply per-question time by (1 + crossCount).
 * @param {object} data - section data
 * @param {number} crossCountGeneral  - cross-question count per general question (0 if non-conversational)
 * @param {number} crossCountPosition - cross-question count per position question (0 if non-conversational)
 * Returns { round1GivenTime, round2GivenTime, round3GivenTime, round4GivenTime } in "HH:MM:SS" format.
 */
function getRoundGivenTimesFromSection(data, crossCountGeneral = 0, crossCountPosition = 0) {
    const out = { round1GivenTime: null, round2GivenTime: null, round3GivenTime: null, round4GivenTime: null };
    const crossGen = Math.max(0, Math.floor(crossCountGeneral));
    const crossPos = Math.max(0, Math.floor(crossCountPosition));
    let sec = 0;
    const general = data.generalQuestions || {};
    (general.questions || []).forEach((q) => {
        const qSec = (Number(q.prepareTime) || 0) + (Number(q.answerTime) || 0);
        // Each main question + its cross-questions (same timing inherited per AI WS code)
        sec += qSec * (1 + crossGen);
    });
    if (sec > 0) out.round1GivenTime = secondsToGivenTime(sec);
    sec = 0;
    const position = data.positionSpecificQuestions || {};
    (position.questions || []).forEach((q) => {
        const qSec = (Number(q.prepareTime) || 0) + (Number(q.answerTime) || 0);
        sec += qSec * (1 + crossPos);
    });
    if (sec > 0) out.round2GivenTime = secondsToGivenTime(sec);
    sec = 0;
    (data.codingQuestions || []).forEach((q) => {
        sec += (Number(q.duration) || 0) * 60;
    });
    if (sec > 0) out.round3GivenTime = secondsToGivenTime(sec);
    sec = 0;
    (data.aptitudeQuestions || []).forEach((q) => {
        sec += (Number(q.duration) || 0) * 60;
    });
    if (sec > 0) out.round4GivenTime = secondsToGivenTime(sec);
    return out;
}

/**
 * Compute total duration in seconds from section data (general, position, coding, aptitude).
 * Returns human-readable string e.g. "22 mins" for question_sets.total_duration.
 */
function computeTotalDurationFromSection(data) {
    let totalSeconds = 0;
    const add = (sec) => { totalSeconds += sec; };

    const general = data.generalQuestions || {};
    const position = data.positionSpecificQuestions || {};
    (general.questions || []).forEach((q) => {
        add(Number(q.prepareTime) || 0);
        add(Number(q.answerTime) || 0);
    });
    (position.questions || []).forEach((q) => {
        add(Number(q.prepareTime) || 0);
        add(Number(q.answerTime) || 0);
    });
    (data.codingQuestions || []).forEach((q) => {
        add((Number(q.duration) || 0) * 60);
    });
    (data.aptitudeQuestions || []).forEach((q) => {
        const mins = Number(q.duration) || 0;
        add(mins * 60);
    });

    const totalMins = Math.ceil(totalSeconds / 60);
    return totalMins <= 0 ? '0 mins' : `${totalMins} mins`;
}

/**
 * Question Section Service
 */

const createQuestionSection = async (tenantDb, questionSetId, data, userId) => {
    const {
        questionSetCode,
        generalQuestions = {},
        positionSpecificQuestions = {},
        codingQuestions = [],
        aptitudeQuestions = []
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
        throw new Error('Could not resolve tenant database for question section creation');
    }

    const id = uuidv4();
    const idClean = id.replace(/-/g, '');
    const set_id_clean = questionSetId.replace(/-/g, '');

    const query = `
        INSERT INTO \`${resolvedTenantDb}\`.question_sections (
            id, question_set_id, question_set_code,
            general_questions, position_specific_questions,
            coding_questions, aptitude_questions,
            created_at, updated_at
        ) VALUES (UNHEX(?), UNHEX(?), ?, ?, ?, ?, ?, NOW(), NOW())
    `;

    await db.query(query, [
        idClean,
        set_id_clean,
        questionSetCode,
        JSON.stringify(generalQuestions),
        JSON.stringify(positionSpecificQuestions),
        JSON.stringify(codingQuestions),
        JSON.stringify(aptitudeQuestions)
    ]);

    const totalDuration = computeTotalDurationFromSection(data);
    await db.query(
        `UPDATE \`${resolvedTenantDb}\`.question_sets SET total_duration = ?, updated_at = NOW() WHERE id = UNHEX(?)`,
        [totalDuration, set_id_clean]
    );

    return { id, questionSetId, ...data };
};

const getQuestionSectionsByQuestionSetId = async (tenantDb, questionSetId, userId) => {
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
        throw new Error('Could not resolve tenant database for question section retrieval');
    }

    const query = `
        SELECT 
            HEX(id) as id, HEX(question_set_id) as questionSetId,
            question_set_code as questionSetCode,
            general_questions as generalQuestions,
            position_specific_questions as positionSpecificQuestions,
            coding_questions as codingQuestions,
            aptitude_questions as aptitudeQuestions,
            created_at as createdAt, updated_at as updatedAt
        FROM \`${resolvedTenantDb}\`.question_sections
        WHERE question_set_id = UNHEX(?)
    `;

    const rows = await db.query(query, [questionSetId.replace(/-/g, '')]);

    // Parse JSON columns
    return rows.map(row => ({
        ...row,
        generalQuestions: typeof row.generalQuestions === 'string' ? JSON.parse(row.generalQuestions) : row.generalQuestions,
        positionSpecificQuestions: typeof row.positionSpecificQuestions === 'string' ? JSON.parse(row.positionSpecificQuestions) : row.positionSpecificQuestions,
        codingQuestions: typeof row.codingQuestions === 'string' ? JSON.parse(row.codingQuestions) : row.codingQuestions,
        aptitudeQuestions: typeof row.aptitudeQuestions === 'string' ? JSON.parse(row.aptitudeQuestions) : row.aptitudeQuestions
    }));
};

const getQuestionSectionById = async (tenantDb, id, userId) => {
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
        throw new Error('Could not resolve tenant database for question section retrieval');
    }

    const query = `
        SELECT 
            HEX(id) as id, HEX(question_set_id) as questionSetId,
            question_set_code as questionSetCode,
            general_questions as generalQuestions,
            position_specific_questions as positionSpecificQuestions,
            coding_questions as codingQuestions,
            aptitude_questions as aptitudeQuestions,
            created_at as createdAt, updated_at as updatedAt
        FROM \`${resolvedTenantDb}\`.question_sections
        WHERE id = UNHEX(?)
    `;

    const rows = await db.query(query, [id.replace(/-/g, '')]);
    if (rows.length === 0) return null;

    const row = rows[0];
    return {
        ...row,
        generalQuestions: typeof row.generalQuestions === 'string' ? JSON.parse(row.generalQuestions) : row.generalQuestions,
        positionSpecificQuestions: typeof row.positionSpecificQuestions === 'string' ? JSON.parse(row.positionSpecificQuestions) : row.positionSpecificQuestions,
        codingQuestions: typeof row.codingQuestions === 'string' ? JSON.parse(row.codingQuestions) : row.codingQuestions,
        aptitudeQuestions: typeof row.aptitudeQuestions === 'string' ? JSON.parse(row.aptitudeQuestions) : row.aptitudeQuestions
    };
};

const updateQuestionSection = async (tenantDb, id, data, userId) => {
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
        throw new Error('Could not resolve tenant database for question section update');
    }

    const fields = [];
    const params = [];

    const updatableFields = [
        'generalQuestions', 'positionSpecificQuestions',
        'codingQuestions', 'aptitudeQuestions'
    ];

    updatableFields.forEach(field => {
        if (data[field] !== undefined) {
            const dbField = field.replace(/[A-Z]/g, letter => `_${letter.toLowerCase()}`);
            fields.push(`${dbField} = ?`);
            params.push(JSON.stringify(data[field]));
        }
    });

    if (fields.length === 0) return null;

    params.push(id.replace(/-/g, ''));

    const query = `
        UPDATE \`${resolvedTenantDb}\`.question_sections
        SET ${fields.join(', ')}, updated_at = NOW()
        WHERE id = UNHEX(?)
    `;

    await db.query(query, params);
    const updated = await getQuestionSectionById(resolvedTenantDb, id, userId);
    if (updated && updated.questionSetId) {
        const sectionData = {
            generalQuestions: updated.generalQuestions || {},
            positionSpecificQuestions: updated.positionSpecificQuestions || {},
            codingQuestions: updated.codingQuestions || [],
            aptitudeQuestions: updated.aptitudeQuestions || []
        };
        const totalDuration = computeTotalDurationFromSection(sectionData);
        const setIdClean = (updated.questionSetId || '').replace(/-/g, '');
        if (setIdClean) {
            await db.query(
                `UPDATE \`${resolvedTenantDb}\`.question_sets SET total_duration = ?, updated_at = NOW() WHERE id = UNHEX(?)`,
                [totalDuration, setIdClean]
            );
        }
    }
    return updated;
};

const deleteQuestionSection = async (tenantDb, id, userId) => {
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
        throw new Error('Could not resolve tenant database for question section deletion');
    }

    const query = `DELETE FROM \`${resolvedTenantDb}\`.question_sections WHERE id = UNHEX(?)`;
    await db.query(query, [id.replace(/-/g, '')]);
    return true;
};

/**
 * Fetch question section by question set id and return round given times.
 * For CONVERSATIONAL question sets, cross-question time is automatically included for round1 (General)
 * and round2 (Position Specific). Cross-question counts are read from cross_question_settings in the
 * tenant DB (defaults to 2 if table/row not found). Coding and Aptitude rounds are not conversational.
 * Returns { round1GivenTime, round2GivenTime, round3GivenTime, round4GivenTime } in "HH:MM:SS" or nulls.
 */
const getRoundGivenTimesForQuestionSet = async (tenantDb, questionSetId, userId = null) => {
    if (!tenantDb || !questionSetId) return { round1GivenTime: null, round2GivenTime: null, round3GivenTime: null, round4GivenTime: null };
    try {
        const sections = await getQuestionSectionsByQuestionSetId(tenantDb, questionSetId, userId);
        const section = Array.isArray(sections) && sections[0] ? sections[0] : null;
        if (!section) return { round1GivenTime: null, round2GivenTime: null, round3GivenTime: null, round4GivenTime: null };

        // ── Check if question set is CONVERSATIONAL ────────────────────────────
        let crossCountGeneral = 0;
        let crossCountPosition = 0;
        try {
            const qsHex = String(questionSetId).replace(/-/g, '');
            if (qsHex.length === 32) {
                const qsRows = await db.query(
                    `SELECT interview_mode FROM \`${tenantDb}\`.question_sets WHERE id = UNHEX(?) LIMIT 1`,
                    [qsHex]
                );
                const isConversational = qsRows && qsRows[0] &&
                    String(qsRows[0].interview_mode || '').toUpperCase() === 'CONVERSATIONAL';

                if (isConversational) {
                    // Read cross-question counts from tenant DB (scoped to this org already)
                    try {
                        const cqRows = await db.query(
                            `SELECT cross_question_count_general  AS crossCountGeneral,
                                    cross_question_count_position AS crossCountPosition
                               FROM \`${tenantDb}\`.cross_question_settings LIMIT 1`
                        );
                        if (cqRows && cqRows[0]) {
                            crossCountGeneral  = Math.min(4, Math.max(0, Number(cqRows[0].crossCountGeneral)  || 2));
                            crossCountPosition = Math.min(4, Math.max(0, Number(cqRows[0].crossCountPosition) || 2));
                        } else {
                            // Table exists but no row yet — use default
                            crossCountGeneral  = 2;
                            crossCountPosition = 2;
                        }
                        console.log(
                            '[getRoundGivenTimesForQuestionSet] conversational: crossGen=%d crossPos=%d (qset=%s)',
                            crossCountGeneral, crossCountPosition, questionSetId
                        );
                    } catch (_) {
                        // cross_question_settings table may not exist in this schema — use defaults
                        crossCountGeneral  = 2;
                        crossCountPosition = 2;
                    }
                }
            }
        } catch (_) {}

        return getRoundGivenTimesFromSection(section, crossCountGeneral, crossCountPosition);
    } catch (err) {
        console.warn('getRoundGivenTimesForQuestionSet:', err.message);
        return { round1GivenTime: null, round2GivenTime: null, round3GivenTime: null, round4GivenTime: null };
    }
};

module.exports = {
    createQuestionSection,
    getQuestionSectionsByQuestionSetId,
    getQuestionSectionById,
    updateQuestionSection,
    deleteQuestionSection,
    getRoundGivenTimesFromSection,
    getRoundGivenTimesForQuestionSet
};
