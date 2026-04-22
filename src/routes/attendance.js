const express = require('express');
const router = express.Router();
const db = require('../config/db');
const authMiddleware = require('../middlewares/auth.middleware');
const tenantMiddleware = require('../middlewares/tenant.middleware');
const rbacMiddleware = require('../middlewares/rbac.middleware');
const { v4: uuidv4 } = require('uuid');

router.use(authMiddleware);
router.use(tenantMiddleware);

/**
 * Helper to generate sequential codes like DEPT001, BRAN001, etc.
 */
async function generateNextCode(tenantDb, table, prefix, organizationId) {
    try {
        let query = '';
        let params = [];
        
        if (table === 'college_departments') {
            query = `SELECT code FROM \`${tenantDb}\`.college_departments WHERE organization_id = ? AND code LIKE ? ORDER BY code DESC LIMIT 1`;
            params = [organizationId, `${prefix}%`];
        } else if (table === 'college_branches') {
            query = `
                SELECT b.code FROM \`${tenantDb}\`.college_branches b
                JOIN \`${tenantDb}\`.college_departments d ON b.department_id = d.id
                WHERE d.organization_id = ? AND b.code LIKE ? 
                ORDER BY b.code DESC LIMIT 1
            `;
            params = [organizationId, `${prefix}%`];
        } else if (table === 'college_subjects') {
            query = `
                SELECT s.code FROM \`${tenantDb}\`.college_subjects s
                JOIN \`${tenantDb}\`.college_branches b ON s.branch_id = b.id
                JOIN \`${tenantDb}\`.college_departments d ON b.department_id = d.id
                WHERE d.organization_id = ? AND s.code LIKE ? 
                ORDER BY s.code DESC LIMIT 1
            `;
            params = [organizationId, `${prefix}%`];
        }

        const rows = await db.query(query, params);
        let nextNum = 1;
        
        if (rows.length > 0 && rows[0].code) {
            const lastCode = rows[0].code;
            const match = lastCode.match(/\d+$/);
            if (match) {
                nextNum = parseInt(match[0], 10) + 1;
            }
        }
        
        return `${prefix}${String(nextNum).padStart(3, '0')}`;
    } catch (err) {
        console.error(`[Attendance] Code generation failed for ${table}:`, err);
        return `${prefix}${Date.now().toString().slice(-3)}`; // Fallback to avoid crash
    }
}

/**
 * @route GET /attendance/departments
 * @desc Get all departments with summary stats
 */
    router.get('/departments', rbacMiddleware('departments'), async (req, res) => {
        const { dataScope, id: userId, organizationId: userOrgId } = req.user;
        // Always use org ID from the authenticated token
        const organizationId = userOrgId;
        const { mentor_ids } = req.query;

        try {
            let query = `
                SELECT 
                    d.id, d.name, d.code, d.organization_id, d.mentor_id, d.created_by, d.created_at, d.updated_at,
                    u.first_name  AS mentor_first_name, u.last_name   AS mentor_last_name,
                    u.email       AS mentor_email, u.phone_number AS mentor_phone,
                    cu.first_name AS created_by_first_name, cu.last_name  AS created_by_last_name,
                    cu.email      AS created_by_email,
                    (SELECT COUNT(*) FROM \`${req.tenantDb}\`.college_branches b WHERE b.department_id = d.id) AS branch_count,
                    (SELECT COUNT(*) FROM \`${req.tenantDb}\`.college_candidates c 
                     WHERE c.branch_id IN (SELECT id FROM \`${req.tenantDb}\`.college_branches b WHERE b.department_id = d.id)) AS student_count
                FROM \`${req.tenantDb}\`.college_departments d 
                LEFT JOIN auth_db.users u  ON d.mentor_id  = u.id
                LEFT JOIN auth_db.users cu ON d.created_by = cu.id
                WHERE d.organization_id = ?
            `;
            const params = [organizationId];

            if (dataScope === 'OWN') {
                query += " AND (d.mentor_id = ? OR d.created_by = ?)";
                params.push(userId, userId);
            }

            if (mentor_ids) {
                const mentorIds = Array.isArray(mentor_ids) ? mentor_ids : mentor_ids.split(',').filter(Boolean);
                if (mentorIds.length > 0) {
                    query += ` AND d.mentor_id IN (${mentorIds.map(() => '?').join(',')})`;
                    params.push(...mentorIds);
                }
            }

            query += ` ORDER BY d.created_at DESC`;

            const rows = await db.query(query, params);
            res.json({ success: true, data: rows });
        } catch (err) {
            console.error('[Attendance] Get departments failed:', err);
            res.status(500).json({ success: false, message: 'Internal server error' });
        }
    });

/**
 * @route POST /attendance/departments
 * @desc Create new department
 */
router.post('/departments', rbacMiddleware('departments'), async (req, res) => {
    const { name, code, description, mentor_id } = req.body;
    const organizationId = req.user.organizationId;
    const creatorId = req.user.id;

    if (!name) return res.status(400).json({ success: false, message: 'Name is required' });

    try {
        const id = uuidv4();
        const autoCode = await generateNextCode(req.tenantDb, 'college_departments', 'DEPT', organizationId);
        
        await db.query(`
            INSERT INTO \`${req.tenantDb}\`.college_departments (id, organization_id, created_by, name, code, description, mentor_id, status)
            VALUES (?, ?, ?, ?, ?, ?, ?, 'Active')
        `, [id, organizationId, creatorId, name, autoCode, description || null, mentor_id || null]);

        res.status(201).json({ 
            success: true, 
            data: { 
                id, 
                organization_id: organizationId,
                created_by: creatorId,
                name, 
                code: autoCode,
                mentor_id: mentor_id || null,
                created_at: new Date().toISOString()
            } 
        });
    } catch (err) {
        console.error('[Attendance] Create department failed:', err);
        res.status(500).json({ success: false, message: 'Internal server error' });
    }
});

/**
 * @route PUT /attendance/departments/:id
 */
router.put('/departments/:id', rbacMiddleware('departments'), async (req, res) => {
    const { id } = req.params;
    const { name, code, description, mentor_id, status } = req.body;

    try {
        await db.query(`
            UPDATE \`${req.tenantDb}\`.college_departments 
            SET name = ?, code = ?, description = ?, mentor_id = ?, status = ?
            WHERE id = ?
        `, [name, code, description, mentor_id, status || 'Active', id]);
        res.json({ success: true, message: 'Department updated successfully' });
    } catch (err) {
        console.error('[Attendance] Update department failed:', err);
        res.status(500).json({ success: false, message: 'Internal server error' });
    }
});

/**
 * @route DELETE /attendance/departments/:id
 */
router.delete('/departments/:id', rbacMiddleware('departments'), async (req, res) => {
    const { id } = req.params;
    try {
        await db.query(`DELETE FROM \`${req.tenantDb}\`.college_departments WHERE id = ?`, [id]);
        res.json({ success: true, message: 'Department deleted successfully' });
    } catch (err) {
        console.error('[Attendance] Delete department failed:', err);
        res.status(500).json({ success: false, message: 'Internal server error' });
    }
});



/**
 * @route GET /attendance/branches
 * @desc Get all branches across departments (used by sidebar /branch route)
 */
router.get('/branches', rbacMiddleware('branches'), async (req, res) => {
    const organizationId = req.user.organizationId || req.headers['x-user-orgid'] || req.query.organizationId;
    const { dataScope = 'ALL', id: userId } = req.user || {};
    const { mentor_ids, batches, dept_ids } = req.query;

    try {
        let query = `
            SELECT 
                b.id, b.name, b.code, b.department_id, b.branch_head_id, b.created_by, b.created_at, b.updated_at, b.start_year, b.end_year,
                d.name AS department_name, d.code AS department_code,
                u.first_name  AS mentor_first_name,
                u.last_name   AS mentor_last_name,
                u.email       AS mentor_email,
                u.phone_number AS mentor_phone,
                r.name        AS mentor_role,
                cu.first_name AS created_by_first_name,
                cu.last_name  AS created_by_last_name,
                cu.email      AS created_by_email,
                (SELECT COUNT(*) FROM \`${req.tenantDb}\`.college_subjects s WHERE s.branch_id = b.id) AS subject_count
            FROM \`${req.tenantDb}\`.college_branches b
            LEFT JOIN \`${req.tenantDb}\`.college_departments d ON b.department_id = d.id
            LEFT JOIN auth_db.users u  ON b.branch_head_id = u.id
            LEFT JOIN auth_db.users cu ON b.created_by = cu.id
            LEFT JOIN auth_db.roles r  ON u.role_id = r.id
            WHERE d.organization_id = ?
        `;
        const params = [organizationId];

        if (dataScope === 'OWN') {
            query += ' AND (b.branch_head_id = ? OR b.created_by = ?)';
            params.push(userId, userId);
        }

        if (dept_ids) {
            const deptIds = Array.isArray(dept_ids) ? dept_ids : dept_ids.split(',').filter(Boolean);
            if (deptIds.length > 0) {
                query += ` AND b.department_id IN (${deptIds.map(() => '?').join(',')})`;
                params.push(...deptIds);
            }
        }

        if (mentor_ids) {
            const mentorIds = Array.isArray(mentor_ids) ? mentor_ids : mentor_ids.split(',').filter(Boolean);
            if (mentorIds.length > 0) {
                query += ` AND b.branch_head_id IN (${mentorIds.map(() => '?').join(',')})`;
                params.push(...mentorIds);
            }
        }

        if (batches) {
            const batchArr = Array.isArray(batches) ? batches : batches.split(',').filter(Boolean);
            if (batchArr.length > 0) {
                query += ` AND b.start_year IN (${batchArr.map(() => '?').join(',')})`;
                params.push(...batchArr);
            }
        }

        query += ' ORDER BY b.created_at DESC';

        const rows = await db.query(query, params);
        res.json({ success: true, data: rows });
    } catch (err) {
        console.error('[Attendance] Get branches list failed:', err);
        res.status(500).json({ success: false, message: 'Internal server error' });
    }
});

/**
 * @route GET /attendance/branches/:deptId
 * @desc Get all branches for a given department (Complete Access)
 */
router.get('/branches/:deptId', rbacMiddleware('branches'), async (req, res) => {
    const { deptId } = req.params;
    const organizationId = req.user.organizationId || req.headers['x-user-orgid'];
    const { mentor_ids, batches } = req.query;

    try {
        let query = `
            SELECT 
                b.id, b.name, b.code, b.department_id, b.branch_head_id, b.created_by, b.created_at, b.updated_at, b.start_year, b.end_year,
                d.name AS department_name, d.code AS department_code,
                -- Incharge details
                u.first_name  AS mentor_first_name,
                u.last_name   AS mentor_last_name,
                u.email       AS mentor_email,
                u.phone_number AS mentor_phone,
                r.name        AS mentor_role,
                -- Creator details
                cu.first_name AS created_by_first_name,
                cu.last_name  AS created_by_last_name,
                cu.email      AS created_by_email,
                -- Subjects count safety check
                (SELECT COUNT(*) FROM \`${req.tenantDb}\`.college_subjects s WHERE s.branch_id = b.id) AS subject_count
            FROM \`${req.tenantDb}\`.college_branches b
            LEFT JOIN \`${req.tenantDb}\`.college_departments d ON b.department_id = d.id
            LEFT JOIN auth_db.users u  ON b.branch_head_id = u.id
            LEFT JOIN auth_db.users cu ON b.created_by     = cu.id
            LEFT JOIN auth_db.roles r  ON u.role_id        = r.id
            WHERE d.organization_id = ? AND b.department_id = ?
        `;
        const params = [organizationId, deptId];

        if (mentor_ids) {
            const mIds = Array.isArray(mentor_ids) ? mentor_ids : mentor_ids.split(',').filter(Boolean);
            if (mIds.length > 0) {
                query += ` AND b.branch_head_id IN (${mIds.map(() => '?').join(',')})`;
                params.push(...mIds);
            }
        }

        if (batches) {
            const batchArr = Array.isArray(batches) ? batches : batches.split(',').filter(Boolean);
            if (batchArr.length > 0) {
                query += ` AND b.start_year IN (${batchArr.map(() => '?').join(',')})`;
                params.push(...batchArr);
            }
        }

        query += ` ORDER BY b.created_at DESC`;

        const rows = await db.query(query, params);
        res.json({ success: true, data: rows });
    } catch (err) {
        console.error('[Attendance] Get all branches failed:', err);
        res.status(500).json({ success: false, message: 'Internal server error' });
    }
});

/**
 * @route GET /attendance/branches/:deptId/:userId
 * @desc Get branches scoped specifically to the provided user's ID within a department (Own Access)
 */
router.get('/branches/:deptId/:userId', rbacMiddleware('branches'), async (req, res) => {
    const { deptId, userId } = req.params;
    const organizationId = req.user.organizationId || req.headers['x-user-orgid'];
    const { batches } = req.query;

    try {
        let query = `
            SELECT 
                b.id, b.name, b.code, b.department_id, b.branch_head_id, b.created_by, b.created_at, b.updated_at, b.start_year, b.end_year,
                d.name AS department_name, d.code AS department_code,
                -- Incharge details
                u.first_name  AS mentor_first_name,
                u.last_name   AS mentor_last_name,
                u.email       AS mentor_email,
                u.phone_number AS mentor_phone,
                r.name        AS mentor_role,
                -- Creator details
                cu.first_name AS created_by_first_name,
                cu.last_name  AS created_by_last_name,
                cu.email      AS created_by_email,
                (SELECT COUNT(*) FROM \`${req.tenantDb}\`.college_subjects s WHERE s.branch_id = b.id) AS subject_count
            FROM \`${req.tenantDb}\`.college_branches b
            LEFT JOIN \`${req.tenantDb}\`.college_departments d ON b.department_id = d.id
            LEFT JOIN auth_db.users u  ON b.branch_head_id = u.id
            LEFT JOIN auth_db.users cu ON b.created_by     = cu.id
            LEFT JOIN auth_db.roles r  ON u.role_id        = r.id
            WHERE d.organization_id = ? AND b.department_id = ? AND (b.branch_head_id = ? OR b.created_by = ?)
        `;
        const params = [organizationId, deptId, userId, userId];

        if (batches) {
            const batchArr = Array.isArray(batches) ? batches : batches.split(',').filter(Boolean);
            if (batchArr.length > 0) {
                query += ` AND b.start_year IN (${batchArr.map(() => '?').join(',')})`;
                params.push(...batchArr);
            }
        }

        query += ` ORDER BY b.created_at DESC`;

        const rows = await db.query(query, params);
        res.json({ success: true, data: rows });
    } catch (err) {
        console.error('[Attendance] Get scoped branches failed:', err);
        res.status(500).json({ success: false, message: 'Internal server error' });
    }
});

/**
 * @route POST /attendance/branches
 * @desc Create new branch
 */
router.post('/branches', rbacMiddleware('branches'), async (req, res) => {
    const { name, code, description, department_id, branch_head_id, start_year, end_year } = req.body;
    const creatorId = req.user.id;

    if (!name || !department_id) {
        return res.status(400).json({ success: false, message: 'Name and Department are required' });
    }

    try {
        const id = uuidv4();
        const organizationId = req.user.organizationId;
        const autoCode = await generateNextCode(req.tenantDb, 'college_branches', 'BRAN', organizationId);

        await db.query(`
            INSERT INTO \`${req.tenantDb}\`.college_branches (id, department_id, created_by, name, code, description, branch_head_id, start_year, end_year, status)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'Active')
        `, [id, department_id, creatorId, name, autoCode, description || null, branch_head_id || null, start_year || null, end_year || null]);

        res.status(201).json({ 
            success: true, 
            data: { 
                id, 
                department_id,
                created_by: creatorId,
                name, 
                code: autoCode,
                branch_head_id: branch_head_id || null,
                created_at: new Date().toISOString()
            } 
        });
    } catch (err) {
        console.error('[Attendance] Create branch failed:', err);
        res.status(500).json({ success: false, message: 'Internal server error' });
    }
});

/**
 * @route PUT /attendance/branches/:id
 */
router.put('/branches/:id', rbacMiddleware('branches'), async (req, res) => {
    const { id } = req.params;
    const { name, code, description, department_id, branch_head_id, start_year, end_year, status } = req.body;

    try {
        await db.query(`
            UPDATE \`${req.tenantDb}\`.college_branches 
            SET name = ?, code = ?, description = ?, department_id = ?, branch_head_id = ?, start_year = ?, end_year = ?, status = ?
            WHERE id = ?
        `, [name, code, description, department_id, branch_head_id, start_year, end_year, status || 'Active', id]);
        res.json({ success: true, message: 'Branch updated successfully' });
    } catch (err) {
        console.error('[Attendance] Update branch failed:', err);
        res.status(500).json({ success: false, message: 'Internal server error' });
    }
});

/**
 * @route DELETE /attendance/branches/:id
 */
router.delete('/branches/:id', rbacMiddleware('branches'), async (req, res) => {
    const { id } = req.params;
    try {
        await db.query(`DELETE FROM \`${req.tenantDb}\`.college_branches WHERE id = ?`, [id]);
        res.json({ success: true, message: 'Branch deleted successfully' });
    } catch (err) {
        console.error('[Attendance] Delete branch failed:', err);
        res.status(500).json({ success: false, message: 'Internal server error' });
    }
});

/**
 * @route GET /attendance/subjects
 * @desc Get all subjects across branches (used by sidebar /subjects route)
 */
router.get('/subjects', rbacMiddleware('subjects'), async (req, res) => {
    const organizationId = req.user.organizationId || req.headers['x-user-orgid'] || req.query.organizationId;
    const { dataScope = 'ALL', id: userId } = req.user || {};
    const { semester, teacher_ids, branch_ids } = req.query;

    try {
        let query = `
            SELECT 
                s.id, s.name, s.code, s.branch_id, s.teacher_id, s.created_by, s.created_at, s.updated_at, s.semester,
                b.name AS branch_name, b.code AS branch_code, b.start_year, b.end_year,
                d.name AS department_name, d.code AS department_code,
                u.first_name  AS teacher_first_name,
                u.last_name   AS teacher_last_name,
                u.email       AS teacher_email,
                u.phone_number AS teacher_phone,
                r.name        AS teacher_role,
                cu.first_name AS created_by_first_name,
                cu.last_name  AS created_by_last_name,
                cu.email      AS created_by_email,
                 (SELECT COUNT(*)
                  FROM \`${req.tenantDb}\`.college_candidates c
                  WHERE c.organization_id = d.organization_id
                    AND c.branch_id = s.branch_id
                    AND c.subjects IS NOT NULL
                    AND TRIM(c.subjects) != ''
                    AND (
                        (JSON_VALID(c.subjects) = 1 AND JSON_CONTAINS(c.subjects, JSON_QUOTE(s.id), '$'))
                        OR FIND_IN_SET(s.id, REPLACE(c.subjects, ' ', '')) > 0
                    )) AS student_count
            FROM \`${req.tenantDb}\`.college_subjects s
            LEFT JOIN \`${req.tenantDb}\`.college_branches b ON s.branch_id = b.id
            LEFT JOIN \`${req.tenantDb}\`.college_departments d ON b.department_id = d.id
            LEFT JOIN auth_db.users u  ON s.teacher_id = u.id
            LEFT JOIN auth_db.users cu ON s.created_by = cu.id
            LEFT JOIN auth_db.roles r  ON u.role_id = r.id
            WHERE d.organization_id = ?
        `;
        const params = [organizationId];

        if (dataScope === 'OWN') {
            query += ' AND (s.teacher_id = ? OR s.created_by = ?)';
            params.push(userId, userId);
        }

        if (branch_ids) {
            const branchIds = Array.isArray(branch_ids) ? branch_ids : branch_ids.split(',').filter(Boolean);
            if (branchIds.length > 0) {
                query += ` AND s.branch_id IN (${branchIds.map(() => '?').join(',')})`;
                params.push(...branchIds);
            }
        }

        if (semester) {
            const semesters = Array.isArray(semester) ? semester : semester.split(',').filter(Boolean);
            if (semesters.length > 0) {
                query += ` AND s.semester IN (${semesters.map(() => '?').join(',')})`;
                params.push(...semesters);
            }
        }

        if (teacher_ids) {
            const teacherIds = Array.isArray(teacher_ids) ? teacher_ids : teacher_ids.split(',').filter(Boolean);
            if (teacherIds.length > 0) {
                query += ` AND s.teacher_id IN (${teacherIds.map(() => '?').join(',')})`;
                params.push(...teacherIds);
            }
        }

        query += ' ORDER BY s.created_at DESC';

        const rows = await db.query(query, params);
        res.json({ success: true, data: rows });
    } catch (err) {
        console.error('[Attendance] Get subjects list failed:', err);
        res.status(500).json({ success: false, message: 'Internal server error' });
    }
});

/**
 * @route GET /attendance/subjects/:branchId
 * @desc Get all subjects for a branch (Complete Access)
 */
router.get('/subjects/:branchId', rbacMiddleware('subjects'), async (req, res) => {
    const { branchId } = req.params;
    const organizationId = req.user.organizationId || req.headers['x-user-orgid'];
    const { semester, teacher_ids } = req.query;

    try {
        let query = `
            SELECT 
                s.id, s.name, s.code, s.branch_id, s.teacher_id, s.created_by, s.created_at, s.updated_at, s.semester,
                b.name AS branch_name, b.code AS branch_code, b.start_year, b.end_year,
                d.name AS department_name, d.code AS department_code,
                -- Teacher details
                u.first_name  AS teacher_first_name,
                u.last_name   AS teacher_last_name,
                u.email       AS teacher_email,
                u.phone_number AS teacher_phone,
                r.name        AS teacher_role,
                -- Creator details
                cu.first_name AS created_by_first_name,
                cu.last_name  AS created_by_last_name,
                cu.email      AS created_by_email,
                 (SELECT COUNT(*)
                  FROM \`${req.tenantDb}\`.college_candidates c
                  WHERE c.organization_id = d.organization_id
                    AND c.branch_id = s.branch_id
                    AND c.subjects IS NOT NULL
                    AND TRIM(c.subjects) != ''
                    AND (
                        (JSON_VALID(c.subjects) = 1 AND JSON_CONTAINS(c.subjects, JSON_QUOTE(s.id), '$'))
                        OR FIND_IN_SET(s.id, REPLACE(c.subjects, ' ', '')) > 0
                    )) AS student_count
            FROM \`${req.tenantDb}\`.college_subjects s
            LEFT JOIN \`${req.tenantDb}\`.college_branches b ON s.branch_id = b.id
            LEFT JOIN \`${req.tenantDb}\`.college_departments d ON b.department_id = d.id
            LEFT JOIN auth_db.users u  ON s.teacher_id = u.id
            LEFT JOIN auth_db.users cu ON s.created_by = cu.id
            LEFT JOIN auth_db.roles r  ON u.role_id = r.id
            WHERE d.organization_id = ? AND s.branch_id = ?
        `;
        const params = [organizationId, branchId];

        if (semester) {
            const semesters = Array.isArray(semester) ? semester : semester.split(',').filter(Boolean);
            if (semesters.length > 0) {
                query += ` AND s.semester IN (${semesters.map(() => '?').join(',')})`;
                params.push(...semesters);
            }
        }

        if (teacher_ids) {
            const teacherIds = Array.isArray(teacher_ids) ? teacher_ids : teacher_ids.split(',').filter(Boolean);
            if (teacherIds.length > 0) {
                query += ` AND s.teacher_id IN (${teacherIds.map(() => '?').join(',')})`;
                params.push(...teacherIds);
            }
        }

        query += ` ORDER BY s.created_at DESC`;

        const rows = await db.query(query, params);
        res.json({ success: true, data: rows });
    } catch (err) {
        console.error('[Attendance] Get all subjects failed:', err);
        res.status(500).json({ success: false, message: 'Internal server error' });
    }
});

/**
 * @route GET /attendance/subjects/:branchId/:userId
 * @desc Get all subjects for a specific user within a branch (Own Access)
 */
router.get('/subjects/:branchId/:userId', rbacMiddleware('subjects'), async (req, res) => {
    const { branchId, userId } = req.params;
    const organizationId = req.user.organizationId || req.headers['x-user-orgid'];
    const { semester } = req.query;

    try {
        let query = `
            SELECT 
                s.id, s.name, s.code, s.branch_id, s.teacher_id, s.created_by, s.created_at, s.updated_at, s.semester,
                b.name AS branch_name, b.code AS branch_code, b.start_year, b.end_year,
                d.name AS department_name, d.code AS department_code,
                -- Teacher details
                u.first_name  AS teacher_first_name,
                u.last_name   AS teacher_last_name,
                u.email       AS teacher_email,
                u.phone_number AS teacher_phone,
                r.name        AS teacher_role,
                -- Creator details
                cu.first_name AS created_by_first_name,
                cu.last_name  AS created_by_last_name,
                cu.email      AS created_by_email,
                 (SELECT COUNT(*)
                  FROM \`${req.tenantDb}\`.college_candidates c
                  WHERE c.organization_id = d.organization_id
                    AND c.branch_id = s.branch_id
                    AND c.subjects IS NOT NULL
                    AND TRIM(c.subjects) != ''
                    AND (
                        (JSON_VALID(c.subjects) = 1 AND JSON_CONTAINS(c.subjects, JSON_QUOTE(s.id), '$'))
                        OR FIND_IN_SET(s.id, REPLACE(c.subjects, ' ', '')) > 0
                    )) AS student_count
            FROM \`${req.tenantDb}\`.college_subjects s
            LEFT JOIN \`${req.tenantDb}\`.college_branches b ON s.branch_id = b.id
            LEFT JOIN \`${req.tenantDb}\`.college_departments d ON b.department_id = d.id
            LEFT JOIN auth_db.users u  ON s.teacher_id = u.id
            LEFT JOIN auth_db.users cu ON s.created_by = cu.id
            LEFT JOIN auth_db.roles r  ON u.role_id = r.id
            WHERE d.organization_id = ? AND s.branch_id = ? AND (s.teacher_id = ? OR s.created_by = ?)
        `;
        const params = [organizationId, branchId, userId, userId];

        if (semester) {
            const semesters = Array.isArray(semester) ? semester : semester.split(',').filter(Boolean);
            if (semesters.length > 0) {
                query += ` AND s.semester IN (${semesters.map(() => '?').join(',')})`;
                params.push(...semesters);
            }
        }

        query += ` ORDER BY s.created_at DESC`;

        const rows = await db.query(query, params);
        res.json({ success: true, data: rows });
    } catch (err) {
        console.error('[Attendance] Get scoped subjects failed:', err);
        res.status(500).json({ success: false, message: 'Internal server error' });
    }
});

/**
 * @route POST /attendance/subjects
 * @desc Create new subject
 */
router.post('/subjects', rbacMiddleware('subjects'), async (req, res) => {
    const { name, code, description, branch_id, teacher_id, semester } = req.body;
    const creatorId = req.user.id;

    if (!name || !branch_id) {
        return res.status(400).json({ success: false, message: 'Name and Branch are required' });
    }

    try {
        const id = uuidv4();
        const organizationId = req.user.organizationId;
        const autoCode = await generateNextCode(req.tenantDb, 'college_subjects', 'SUB', organizationId);

        await db.query(`
            INSERT INTO \`${req.tenantDb}\`.college_subjects (id, branch_id, created_by, name, code, description, teacher_id, semester, status)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'Active')
        `, [id, branch_id, creatorId, name, autoCode, description || null, teacher_id || null, semester || null]);

        res.status(201).json({ 
            success: true, 
            data: { 
                id, 
                branch_id,
                created_by: creatorId,
                name, 
                code: autoCode,
                teacher_id: teacher_id || null,
                semester: semester || null,
                created_at: new Date().toISOString()
            } 
        });
    } catch (err) {
        console.error('[Attendance] Create subject failed:', err);
        res.status(500).json({ success: false, message: 'Internal server error' });
    }
});

/**
 * @route PUT /attendance/subjects/:id
 */
router.put('/subjects/:id', rbacMiddleware('subjects'), async (req, res) => {
    const { id } = req.params;
    const { name, code, description, branch_id, teacher_id, semester, status } = req.body;

    try {
        await db.query(`
            UPDATE \`${req.tenantDb}\`.college_subjects 
            SET name = ?, code = ?, description = ?, branch_id = ?, teacher_id = ?, semester = ?, status = ?
            WHERE id = ?
        `, [name, code, description, branch_id, teacher_id, semester, status || 'Active', id]);
        res.json({ success: true, message: 'Subject updated successfully' });
    } catch (err) {
        console.error('[Attendance] Update subject failed:', err);
        res.status(500).json({ success: false, message: 'Internal server error' });
    }
});

/**
 * @route DELETE /attendance/subjects/:id
 */
router.delete('/subjects/:id', rbacMiddleware('subjects'), async (req, res) => {
    const { id } = req.params;
    try {
        await db.query(`DELETE FROM \`${req.tenantDb}\`.college_subjects WHERE id = ?`, [id]);
        res.json({ success: true, message: 'Subject deleted successfully' });
    } catch (err) {
        console.error('[Attendance] Delete subject failed:', err);
        res.status(500).json({ success: false, message: 'Internal server error' });
    }
});

/**
 * @route GET /attendance/students
 * @desc Get students for attendance (filtered by branch/semester)
 */
router.get('/students', rbacMiddleware('students'), async (req, res) => {
    const organizationId = req.user.organizationId || req.headers['x-user-orgid'];
        const { branchId, semester, batch, statuses } = req.query;

        try {
            let query = `
                SELECT c.candidate_id as id, c.candidate_name as first_name, '' as last_name, c.email, c.mobile_number as mobile_no, c.register_no as usn,
                       b.name as branch_name, d.name as department_name, c.status
                FROM \`${req.tenantDb}\`.college_candidates c
                LEFT JOIN \`${req.tenantDb}\`.college_branches b ON c.branch_id = b.id
                LEFT JOIN \`${req.tenantDb}\`.college_departments d ON b.department_id = d.id
                WHERE c.organization_id = ?
            `;
            const params = [organizationId];

            if (branchId) {
                const branchIds = Array.isArray(branchId) ? branchId : branchId.split(',').filter(Boolean);
                if (branchIds.length > 0) {
                    query += ` AND c.branch_id IN (${branchIds.map(() => '?').join(',')})`;
                    params.push(...branchIds);
                }
            }

            if (semester) {
                const semesters = Array.isArray(semester) ? semester : semester.split(',').filter(Boolean);
                if (semesters.length > 0) {
                    query += ` AND c.current_semester IN (${semesters.map(() => '?').join(',')})`;
                    params.push(...semesters);
                }
            }

            if (batch) {
                const batches = Array.isArray(batch) ? batch : batch.split(',').filter(Boolean);
                if (batches.length > 0) {
                    query += ` AND c.academic_year IN (${batches.map(() => '?').join(',')})`;
                    params.push(...batches);
                }
            }

            if (statuses) {
                const statusArr = Array.isArray(statuses) ? statuses : statuses.split(',').filter(Boolean);
                if (statusArr.length > 0) {
                    query += ` AND c.status IN (${statusArr.map(() => '?').join(',')})`;
                    params.push(...statusArr);
                }
            } else {
                query += " AND c.status = 'Active'";
            }

        const rows = await db.query(query, params);
        res.json({ success: true, data: rows });
    } catch (err) {
        console.error('[Attendance] Get students failed:', err);
        res.status(500).json({ success: false, message: 'Internal server error' });
    }
});

/**
 * @route POST /attendance/mark
 * @desc Mark attendance for multiple students
 */
router.post('/mark', rbacMiddleware('ATTENDANCE'), async (req, res) => {
    const organizationId = req.user.organizationId || req.headers['x-user-orgid'];
    const { subjectId, date, students, type = 'Lecture' } = req.body;
    const createdBy = req.user.id;

    if (!subjectId || !date || !students || !Array.isArray(students)) {
        return res.status(400).json({ success: false, message: 'Missing required fields' });
    }

    try {
        // We use a transaction for multiple inserts
        const connection = await db.getConnection();
        await connection.beginTransaction();

        try {
            for (const student of students) {
                const id = uuidv4();
                await connection.query(`
                    INSERT INTO \`${req.tenantDb}\`.college_attendance 
                    (id, organization_id, student_id, subject_id, date, status, type, remarks, created_by)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
                `, [id, organizationId, student.id, subjectId, date, student.status, type, student.remarks || '', createdBy]);
            }
            await connection.commit();
            res.json({ success: true, message: 'Attendance marked successfully' });
        } catch (error) {
            await connection.rollback();
            throw error;
        } finally {
            connection.release();
        }
    } catch (err) {
        console.error('[Attendance] Mark attendance failed:', err);
        res.status(500).json({ success: false, message: 'Internal server error' });
    }
});

/**
 * @route GET /attendance/report
 * @desc Get attendance report for a subject/branch
 */
router.get('/report', rbacMiddleware('ATTENDANCE'), async (req, res) => {
    const organizationId = req.user.organizationId || req.headers['x-user-orgid'];
    const { subjectId, startDate, endDate, studentId } = req.query;

    try {
        let query = `
            SELECT a.*, c.first_name, c.last_name, c.usn, s.name as subject_name
            FROM \`${req.tenantDb}\`.college_attendance a
            JOIN \`${req.tenantDb}\`.college_candidates c ON a.student_id = c.id
            JOIN \`${req.tenantDb}\`.college_subjects s ON a.subject_id = s.id
            WHERE a.organization_id = ?
        `;
        const params = [organizationId];

        if (subjectId) {
            query += " AND a.subject_id = ?";
            params.push(subjectId);
        }
        if (studentId) {
            query += " AND a.student_id = ?";
            params.push(studentId);
        }
        if (startDate && endDate) {
            query += " AND a.date BETWEEN ? AND ?";
            params.push(startDate, endDate);
        }

        query += " ORDER BY a.date DESC, c.last_name ASC";

        const rows = await db.query(query, params);
        res.json({ success: true, data: rows });
    } catch (err) {
        console.error('[Attendance] Get report failed:', err);
        res.status(500).json({ success: false, message: 'Internal server error' });
    }
});

/**
 * @route GET /attendance/available-incharges
 * @desc Get users who can be assigned as branch/program heads
 */
router.get('/available-incharges', rbacMiddleware('departments'), async (req, res) => {
    const organizationId = req.user.organizationId || req.headers['x-user-orgid'];
    try {
        const rows = await db.authQuery(`
            SELECT id, first_name, last_name, email 
            FROM users 
            WHERE organization_id = ? AND is_active = 1
        `, [organizationId]);
        res.json({ success: true, data: rows });
    } catch (err) {
        console.error('[Attendance] Get incharges failed:', err);
        res.status(500).json({ success: false, message: 'Internal server error' });
    }
});

/**
 * @route GET /attendance/sheet/:branchId
 * @desc Get attendance sheet for a branch and month (Legacy Alias)
 */
router.get('/sheet/:branchId', rbacMiddleware('ATTENDANCE'), async (req, res) => {
    req.params.deptId = 'legacy';
    req.params.subjectId = req.query.subjectId;
    // We intentionally proxy this locally onto the new robust path structure to prevent caching errors natively
    const organizationId = req.user.organizationId || req.headers['x-user-orgid'];
    const { branchId } = req.params;
    const { month, year, subjectId } = req.query;

    if (!branchId || !month || !year) {
        return res.status(400).json({ success: false, message: 'Branch, Month, and Year are required' });
    }

    try {
        const allStudents = await db.query(`
            SELECT c.candidate_id, c.candidate_name, c.register_no, c.subjects
            FROM \`${req.tenantDb}\`.college_candidates c
            WHERE c.branch_id = ? AND c.organization_id = ? AND c.status = 'Active'
        `, [branchId, organizationId]);

        const students = allStudents.filter(r => {
            if (!subjectId) return true;
            if (!r.subjects) return false;
            try {
                const arr = JSON.parse(r.subjects);
                if (Array.isArray(arr)) return arr.includes(subjectId);
            } catch (e) {}
            const arr = r.subjects.split(',').map(s => s.trim());
            return arr.includes(subjectId);
        });

        if (students.length === 0) {
            return res.json({ success: true, data: [] });
        }

        const studentIds = students.map(s => s.candidate_id);
        const startDate = `${year}-${String(month).padStart(2, '0')}-01`;
        const endDate = `${year}-${String(month).padStart(2, '0')}-31`;

        let attQuery = `
            SELECT student_id, date, status
            FROM \`${req.tenantDb}\`.college_attendance
            WHERE student_id IN (?) AND date BETWEEN ? AND ?
        `;
        const attParams = [studentIds, startDate, endDate];

        if (subjectId) {
            attQuery += " AND subject_id = ?";
            attParams.push(subjectId);
        }

        const attRows = await db.query(attQuery, attParams);

        const result = students.map(student => {
            const studentAtt = attRows.filter(a => String(a.student_id) === String(student.candidate_id));
            const attObj = {};
            studentAtt.forEach(a => {
                const day = new Date(a.date).getDate();
                attObj[day] = a.status;
            });
            return { ...student, attendance: attObj };
        });

        res.json({ success: true, data: result });
    } catch (err) {
        console.error('[Attendance] Get sheet failed:', err);
        res.status(500).json({ success: false, message: err.message, stack: err.stack });
    }
});

/**
 * @route GET /attendance/:deptId/:branchId/:subjectId/sheet
 * @desc Get attendance sheet for a subject within a branch and month
 */
router.get('/:deptId/:branchId/:subjectId/sheet', rbacMiddleware('ATTENDANCE'), async (req, res) => {
    const organizationId = req.user.organizationId || req.headers['x-user-orgid'];
    const { deptId, branchId, subjectId } = req.params;
    
    // Default natively to the current timestamp metrics if parameters are entirely absent
    const now = new Date();
    const month = req.query.month || (now.getMonth() + 1);
    const year = req.query.year || now.getFullYear();

    const isInvalidParam = (v) => !v || String(v).trim() === '' || v === 'undefined' || v === 'null';

    try {
        let effectiveBranchId = branchId;

        // Support routes where branchId is missing/undefined by resolving it from subject.
        if (isInvalidParam(effectiveBranchId) && !isInvalidParam(subjectId)) {
            const subjectCtx = await db.query(
                `SELECT s.branch_id
                 FROM \`${req.tenantDb}\`.college_subjects s
                 LEFT JOIN \`${req.tenantDb}\`.college_branches b ON b.id = s.branch_id
                 LEFT JOIN \`${req.tenantDb}\`.college_departments d ON d.id = b.department_id
                 WHERE s.id = ? AND d.organization_id = ?
                 LIMIT 1`,
                [subjectId, organizationId]
            );
            if (subjectCtx && subjectCtx.length > 0) {
                effectiveBranchId = subjectCtx[0].branch_id;
            }
        }

        if (isInvalidParam(effectiveBranchId)) {
            return res.status(400).json({ success: false, message: 'Valid branch ID is required for attendance sheet' });
        }

        // 1. Get all students in this branch
        const allStudents = await db.query(`
            SELECT c.candidate_id, c.candidate_name, c.register_no, c.subjects, c.created_at
            FROM \`${req.tenantDb}\`.college_candidates c
            WHERE c.branch_id = ? AND c.organization_id = ? AND c.status = 'Active'
            ORDER BY c.created_at DESC
        `, [effectiveBranchId, organizationId]);

        // Filter explicitly to keep ONLY participants mapped perfectly to this subject
        const students = allStudents.filter(r => {
            if (!subjectId) return true; // fallback to showing all if no subject filter explicitly supplied (but sheet expects subject)
            if (!r.subjects) return false;
            try {
                const arr = JSON.parse(r.subjects);
                if (Array.isArray(arr)) return arr.includes(subjectId);
            } catch (e) {}
            const arr = r.subjects.split(',').map(s => s.trim());
            return arr.includes(subjectId);
        });

        if (students.length === 0) {
            return res.json({ success: true, data: [] });
        }

        const studentIds = students.map(s => s.candidate_id);

        // 2. Get attendance for these students in the given month/year
        // Format: 'YYYY-MM-DD'
        const startDate = `${year}-${String(month).padStart(2, '0')}-01`;
        const endDate = `${year}-${String(month).padStart(2, '0')}-31`;

        let attQuery = `
            SELECT student_id, date, status
            FROM \`${req.tenantDb}\`.college_attendance
            WHERE student_id IN (?) AND date BETWEEN ? AND ?
        `;
        const attParams = [studentIds, startDate, endDate];

        if (subjectId) {
            attQuery += " AND subject_id = ?";
            attParams.push(subjectId);
        }

        const attRows = await db.query(attQuery, attParams);

        // 3. Process into required structure
        const result = students.map(s => {
            const studentAtt = {};
            attRows.filter(a => a.student_id === s.candidate_id).forEach(a => {
                const day = new Date(a.date).getDate();
                studentAtt[day] = a.status;
            });

            return {
                ...s,
                attendance: studentAtt
            };
        });

        res.json({ success: true, data: result });
    } catch (err) {
        console.error('[Attendance] Get sheet failed:', err);
        res.status(500).json({ success: false, message: err.message, stack: err.stack });
    }
});/**
 * @route POST /attendance/batch-update
 * @desc Bulk upsert attendance statuses executing purely via database transactions spanning an array natively 
 */
router.post('/batch-update', rbacMiddleware('ATTENDANCE'), async (req, res) => {
    const organizationId = req.user.organizationId || req.headers['x-user-orgid'];
    const { subjectId, updates } = req.body;
    const createdBy = req.user.id;

    if (!subjectId || !Array.isArray(updates)) {
        return res.status(400).json({ success: false, message: 'Subject UUID and Array payload completely required' });
    }

    try {
        const connection = await db.getPool().getConnection();
        await connection.beginTransaction();

        try {
            for (const item of updates) {
                const { candidateId, date, status } = item;
                
                const [existing] = await connection.query(
                    `SELECT id FROM \`${req.tenantDb}\`.college_attendance WHERE student_id = ? AND subject_id = ? AND date = ? AND organization_id = ?`,
                    [candidateId, subjectId, date, organizationId]
                );

                if (existing && existing.length > 0) {
                    await connection.query(
                        `UPDATE \`${req.tenantDb}\`.college_attendance SET status = ?, updated_at = NOW() WHERE id = ?`,
                        [status, existing[0].id]
                    );
                } else {
                    const id = uuidv4();
                    await connection.query(
                        `INSERT INTO \`${req.tenantDb}\`.college_attendance (id, organization_id, student_id, subject_id, date, status, type, created_by) VALUES (?, ?, ?, ?, ?, ?, 'Lecture', ?)`,
                        [id, organizationId, candidateId, subjectId, date, status || 'P', createdBy]
                    );
                }
            }
            await connection.commit();
            res.json({ success: true, message: 'All matrix payload records successfully committed natively' });
        } catch (error) {
            await connection.rollback();
            throw error;
        } finally {
            connection.release();
        }
    } catch (err) {
        console.error('[Attendance] Batch DB Failure:', err);
        res.status(500).json({ success: false, message: err.message, stack: err.stack });
    }
});

/**
 * @route GET /attendance/unmapped-students/:branchId
 * @desc Get candidates natively inside the branch that strictly do NOT have the mapped subject yet
 */
router.get('/unmapped-students/:branchId', rbacMiddleware('ATTENDANCE'), async (req, res) => {
    const organizationId = req.user.organizationId || req.headers['x-user-orgid'];
    const { branchId } = req.params;
    const { subjectId, page = 0 } = req.query;

    if (!subjectId) return res.status(400).json({ success: false, message: 'Subject ID strictly required for query scoping' });
    
    try {
        let query = `
            SELECT c.candidate_id as id, c.candidate_name as first_name, '' as last_name, c.register_no as usn, c.subjects
            FROM \`${req.tenantDb}\`.college_candidates c
            WHERE c.branch_id = ? AND c.organization_id = ? AND c.status = 'Active'
        `;
        const params = [branchId, organizationId];

        const rows = await db.query(query, params);
        
        const unmappedData = rows.filter(r => {
            if (!r.subjects) return true; // empty maps unequivocally equal unmapped
            try {
                const arr = JSON.parse(r.subjects);
                if (Array.isArray(arr)) return !arr.includes(subjectId);
            } catch (e) {}
            const arr = r.subjects.split(',').map(s => s.trim());
            return !arr.includes(subjectId);
        });

        // Hard splice to 20 paginated chunks automatically based on index
        const limit = 20;
        const offset = parseInt(page) * limit;
        const slice = unmappedData.slice(offset, offset + limit);

        res.json({ success: true, total: unmappedData.length, data: slice });
    } catch (err) {
        console.error('[Attendance] Lookup completely failed natively:', err);
        res.status(500).json({ success: false, message: 'Internal server error' });
    }
});

/**
 * @route POST /attendance/import-students/preview
 * @desc Validate CSV/XLSX rows against the current sheet context and return row-wise preview status
 */
router.post('/import-students/preview', rbacMiddleware('ATTENDANCE'), async (req, res) => {
    const organizationId = req.user.organizationId || req.headers['x-user-orgid'];
    const { deptId, branchId, subjectId, rows } = req.body || {};

    if (!branchId || !subjectId || !Array.isArray(rows)) {
        return res.status(400).json({ success: false, message: 'branchId, subjectId and rows[] are required' });
    }

    try {
        const subjectRows = await db.query(
            `SELECT s.id, s.name AS subject_name, s.branch_id, s.semester, b.department_id, b.name AS branch_name, d.name AS department_name
             FROM \`${req.tenantDb}\`.college_subjects s
             LEFT JOIN \`${req.tenantDb}\`.college_branches b ON b.id = s.branch_id
             LEFT JOIN \`${req.tenantDb}\`.college_departments d ON d.id = b.department_id
             WHERE s.id = ? AND d.organization_id = ?
             LIMIT 1`,
            [subjectId, organizationId]
        );

        if (!subjectRows || subjectRows.length === 0) {
            return res.status(404).json({ success: false, message: 'Subject not found for this organization' });
        }

        const subjectCtx = subjectRows[0];
        const effectiveDeptId = deptId && deptId !== 'undefined' ? String(deptId) : String(subjectCtx.department_id || '');
        const effectiveBranchId = String(branchId);
        const effectiveSubjectId = String(subjectId);
        const effectiveDepartmentName = String(subjectCtx.department_name || '').trim().toLowerCase();
        const effectiveBranchName = String(subjectCtx.branch_name || '').trim().toLowerCase();
        const effectiveSubjectName = String(subjectCtx.subject_name || '').trim().toLowerCase();
        const effectiveSemester = subjectCtx.semester != null ? String(subjectCtx.semester) : '';

        const registerNos = rows
            .map((r) => String(r.register_no || r.registerNo || r.usn || '').trim())
            .filter(Boolean);

        const emails = rows
            .map((r) => String(r.email || r.candidate_email || '').trim().toLowerCase())
            .filter(Boolean);

        let candidatesByRegNo = new Map();
        let candidatesByEmail = new Map();
        if (registerNos.length > 0) {
            const candidateRows = await db.query(
                `SELECT c.candidate_id, c.candidate_name, c.register_no, c.email, c.dept_id, c.branch_id, c.semester, c.subjects, c.status
                 FROM \`${req.tenantDb}\`.college_candidates c
                 WHERE c.organization_id = ? AND c.register_no IN (?)`,
                [organizationId, registerNos]
            );
            candidatesByRegNo = new Map((candidateRows || []).map((c) => [String(c.register_no || '').trim(), c]));
        }

        if (emails.length > 0) {
            const emailRows = await db.query(
                `SELECT c.candidate_id, c.email
                 FROM \`${req.tenantDb}\`.college_candidates c
                 WHERE c.organization_id = ? AND LOWER(TRIM(c.email)) IN (?)`,
                [organizationId, emails]
            );
            candidatesByEmail = new Map((emailRows || []).map((c) => [String(c.email || '').trim().toLowerCase(), c]));
        }

        const parseSubjects = (raw) => {
            if (!raw) return [];
            try {
                const parsed = JSON.parse(raw);
                if (Array.isArray(parsed)) return parsed.map((x) => String(x));
            } catch (e) {
                // fall through to CSV parser
            }
            return String(raw)
                .split(',')
                .map((s) => s.trim())
                .filter(Boolean)
                .map((x) => String(x));
        };

        const previewRows = rows.map((row, idx) => {
            const rowNo = idx + 1;
            const registerNo = String(row.register_no || row.registerNo || row.usn || '').trim();
            const rowEmailRaw = String(row.email || row.candidate_email || '').trim();
            const rowEmail = rowEmailRaw.toLowerCase();
            const rowDepartmentName = String(row.department_name || row.department || '').trim().toLowerCase();
            const rowBranchName = String(row.branch_name || row.branch || row.batch || '').trim().toLowerCase();
            const rowSemester = String(row.semester || '').trim();
            const rowSubjectName = String(row.subject_name || row.subject || '').trim().toLowerCase();
            const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

            const missing = [];
            if (!registerNo) missing.push('register_no');
            if (!rowDepartmentName) missing.push('department_name');
            if (!rowBranchName) missing.push('branch_name');
            if (!rowSemester) missing.push('semester');
            if (!rowSubjectName) missing.push('subject_name');

            if (missing.length > 0) {
                return {
                    rowNo,
                    register_no: registerNo || '-',
                    candidate_name: String(row.candidate_name || row.name || ''),
                    valid: false,
                    reason: `Missing: ${missing.join(', ')}`,
                };
            }

            if (rowDepartmentName !== effectiveDepartmentName || rowBranchName !== effectiveBranchName || rowSubjectName !== effectiveSubjectName) {
                return {
                    rowNo,
                    register_no: registerNo,
                    candidate_name: String(row.candidate_name || row.name || ''),
                    valid: false,
                    reason: 'Row context does not match this sheet (department/branch/subject)',
                };
            }

            if (effectiveSemester && String(rowSemester) !== effectiveSemester) {
                return {
                    rowNo,
                    register_no: registerNo,
                    candidate_name: String(row.candidate_name || row.name || ''),
                    valid: false,
                    reason: `Semester mismatch (sheet: ${effectiveSemester}, row: ${rowSemester})`,
                };
            }

            const candidate = candidatesByRegNo.get(registerNo);
            if (!candidate) {
                return {
                    rowNo,
                    register_no: registerNo,
                    candidate_name: String(row.candidate_name || row.name || ''),
                    valid: false,
                    reason: 'Student not found by register number',
                };
            }

            if (rowEmail) {
                if (!emailRegex.test(rowEmail)) {
                    return {
                        rowNo,
                        register_no: registerNo,
                        candidate_name: candidate.candidate_name,
                        candidate_id: candidate.candidate_id,
                        valid: false,
                        reason: 'Invalid email format in file',
                    };
                }

                const emailCandidate = candidatesByEmail.get(rowEmail);
                if (!emailCandidate) {
                    return {
                        rowNo,
                        register_no: registerNo,
                        candidate_name: candidate.candidate_name,
                        candidate_id: candidate.candidate_id,
                        valid: false,
                        reason: 'Email not found in college candidates',
                    };
                }

                if (String(emailCandidate.candidate_id || '') !== String(candidate.candidate_id || '')) {
                    return {
                        rowNo,
                        register_no: registerNo,
                        candidate_name: candidate.candidate_name,
                        candidate_id: candidate.candidate_id,
                        valid: false,
                        reason: 'Email does not match register number candidate',
                    };
                }
            }

            if (String(candidate.status || '').toLowerCase() !== 'active') {
                return {
                    rowNo,
                    register_no: registerNo,
                    candidate_name: candidate.candidate_name,
                    candidate_id: candidate.candidate_id,
                    valid: false,
                    reason: 'Student is not active',
                };
            }

            if (String(candidate.branch_id || '') !== effectiveBranchId || (effectiveDeptId && String(candidate.dept_id || '') !== effectiveDeptId)) {
                return {
                    rowNo,
                    register_no: registerNo,
                    candidate_name: candidate.candidate_name,
                    candidate_id: candidate.candidate_id,
                    valid: false,
                    reason: 'Student department/branch does not match this sheet',
                };
            }

            if (effectiveSemester && String(candidate.semester || '') && String(candidate.semester) !== effectiveSemester) {
                return {
                    rowNo,
                    register_no: registerNo,
                    candidate_name: candidate.candidate_name,
                    candidate_id: candidate.candidate_id,
                    valid: false,
                    reason: 'Student semester does not match this sheet',
                };
            }

            const existingSubjects = parseSubjects(candidate.subjects);
            if (existingSubjects.includes(effectiveSubjectId)) {
                return {
                    rowNo,
                    register_no: registerNo,
                    candidate_name: candidate.candidate_name,
                    candidate_id: candidate.candidate_id,
                    valid: false,
                    reason: 'Already mapped to this subject',
                };
            }

            return {
                rowNo,
                register_no: registerNo,
                candidate_name: candidate.candidate_name,
                candidate_id: candidate.candidate_id,
                valid: true,
                reason: 'Matched to current sheet context',
            };
        });

        const validCount = previewRows.filter((r) => r.valid).length;

        return res.json({
            success: true,
            data: previewRows,
            summary: {
                total: previewRows.length,
                valid: validCount,
                invalid: previewRows.length - validCount,
                context: {
                    deptId: effectiveDeptId,
                    branchId: effectiveBranchId,
                    subjectId: effectiveSubjectId,
                    semester: effectiveSemester || null,
                },
            },
        });
    } catch (err) {
        console.error('[Attendance] Preview validation failed:', err);
        return res.status(500).json({ success: false, message: 'Internal server error' });
    }
});

/**
 * @route GET /attendance/sheet-context/:subjectId
 * @desc Resolve readable department/branch/batch/subject context for attendance sheet import popup
 */
router.get('/sheet-context/:subjectId', rbacMiddleware('ATTENDANCE'), async (req, res) => {
    const organizationId = req.user.organizationId || req.headers['x-user-orgid'];
    const { subjectId } = req.params;

    if (!subjectId) {
        return res.status(400).json({ success: false, message: 'subjectId is required' });
    }

    try {
        const rows = await db.query(
            `SELECT
                s.id AS subject_id,
                s.name AS subject_name,
                s.code AS subject_code,
                s.semester AS subject_semester,
                b.id AS branch_id,
                b.name AS branch_name,
                b.code AS branch_code,
                b.start_year,
                b.end_year,
                d.id AS department_id,
                d.name AS department_name,
                d.code AS department_code
             FROM \`${req.tenantDb}\`.college_subjects s
             LEFT JOIN \`${req.tenantDb}\`.college_branches b ON b.id = s.branch_id
             LEFT JOIN \`${req.tenantDb}\`.college_departments d ON d.id = b.department_id
             WHERE s.id = ? AND d.organization_id = ?
             LIMIT 1`,
            [subjectId, organizationId]
        );

        if (!rows || rows.length === 0) {
            return res.status(404).json({ success: false, message: 'Sheet context not found' });
        }

        const row = rows[0];
        return res.json({
            success: true,
            data: {
                departmentId: row.department_id || null,
                departmentName: row.department_name || null,
                branchId: row.branch_id || null,
                branchName: row.branch_name || null,
                subjectId: row.subject_id || null,
                subjectName: row.subject_name || null,
                semester: row.subject_semester != null ? String(row.subject_semester) : null,
                batch: row.start_year && row.end_year ? `${row.start_year} - ${row.end_year}` : null,
                startYear: row.start_year || null,
                endYear: row.end_year || null,
            },
        });
    } catch (err) {
        console.error('[Attendance] Get sheet context failed:', err);
        return res.status(500).json({ success: false, message: 'Internal server error' });
    }
});

/**
 * @route POST /attendance/import-students
 * @desc Imports chosen candidate array strictly by appending natively to comma/JSON column value safely via tx
 */
router.post('/import-students', rbacMiddleware('ATTENDANCE'), async (req, res) => {
    const organizationId = req.user.organizationId || req.headers['x-user-orgid'];
    const { subjectId, studentIds } = req.body;

    if (!subjectId || !studentIds || !Array.isArray(studentIds)) {
        return res.status(400).json({ success: false, message: 'Array of student IDs required accurately' });
    }

    try {
        const rows = await db.query(`
            SELECT candidate_id, subjects FROM \`${req.tenantDb}\`.college_candidates 
            WHERE candidate_id IN (?) AND organization_id = ?
        `, [studentIds, organizationId]);

        const connection = await db.getPool().getConnection();
        await connection.beginTransaction();

        try {
            for (const r of rows) {
                let newSubjects = r.subjects ? r.subjects : '';
                try {
                    const parsed = JSON.parse(r.subjects);
                    if (Array.isArray(parsed)) {
                        if (!parsed.includes(subjectId)) parsed.push(subjectId);
                        newSubjects = JSON.stringify(parsed);
                    } else {
                        const arr = r.subjects.split(',').map(s=>s.trim()).filter(Boolean);
                        if (!arr.includes(subjectId)) arr.push(subjectId);
                        newSubjects = arr.join(',');
                    }
                } catch(e) {
                    const arr = newSubjects.split(',').map(s=>s.trim()).filter(Boolean);
                    if (!arr.includes(subjectId)) arr.push(subjectId);
                    newSubjects = arr.join(',');
                }

                await connection.query(
                    `UPDATE \`${req.tenantDb}\`.college_candidates SET subjects = ? WHERE candidate_id = ?`,
                    [newSubjects, r.candidate_id]
                );
            }
            await connection.commit();
            res.json({ success: true, message: 'New candidates successfully loaded into your class registry' });
        } catch(error) {
            await connection.rollback();
            throw error;
        } finally {
            connection.release();
        }
    } catch(err) {
        console.error('[Attendance] Batch payload update completely bypassed constraints/failed natively:', err);
        res.status(500).json({ success: false, message: 'Internal server error' });
    }
});

module.exports = router;
