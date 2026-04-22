const db = require('../config/db');
const { v4: uuidv4 } = require('uuid');
const fileStorageUtil = require('../utils/fileStorageUtil');

/**
 * Task Controller for managing academic tasks
 */
class TaskController {
    static _schemaCapabilities = null;

    static async getSchemaCapabilities() {
        if (TaskController._schemaCapabilities) {
            return TaskController._schemaCapabilities;
        }

        const tableRows = await db.query(
            `SELECT table_name
             FROM information_schema.tables
             WHERE table_schema = DATABASE()
               AND table_name IN ('tasks', 'student_tasks', 'task_attachments', 'college_departments', 'college_branches', 'college_subjects')`
        );

        const columnRows = await db.query(
            `SELECT table_name, column_name
             FROM information_schema.columns
             WHERE table_schema = DATABASE()
               AND table_name = 'tasks'
               AND column_name IN ('organization_id', 'created_by', 'subject_id')`
        );

        const tables = new Set((tableRows || []).map((r) => String(r.table_name || '').toLowerCase()));
        const columns = new Set((columnRows || []).map((r) => `${String(r.table_name || '').toLowerCase()}.${String(r.column_name || '').toLowerCase()}`));

        TaskController._schemaCapabilities = {
            hasTasks: tables.has('tasks'),
            hasStudentTasks: tables.has('student_tasks'),
            hasTaskAttachments: tables.has('task_attachments'),
            hasCollegeDepartments: tables.has('college_departments'),
            hasCollegeBranches: tables.has('college_branches'),
            hasCollegeSubjects: tables.has('college_subjects'),
            hasTaskOrganizationId: columns.has('tasks.organization_id'),
            hasTaskCreatedBy: columns.has('tasks.created_by'),
            hasTaskSubjectId: columns.has('tasks.subject_id')
        };

        return TaskController._schemaCapabilities;
    }

    /**
     * @desc Create a new task with attachments and assignments
     * @route POST /tasks
     */
    static async createTask(req, res) {
        let { 
            title, 
            short_description, 
            description, 
            notes, 
            links, 
            end_date, 
            priority,
            dept_id,
            branch_id,
            subject_id,
            student_ids,
            is_all_students
        } = req.body;

        if (typeof links === 'string') { try { links = JSON.parse(links); } catch(e) {} }
        if (typeof student_ids === 'string') { try { student_ids = JSON.parse(student_ids); } catch(e) {} }
        
        const organizationId = req.user?.organizationId || req.headers['x-user-orgid'];
        const userId = req.user?.id;

        if (!title) {
            return res.status(400).json({ success: false, message: 'Title is required' });
        }

        try {
            // 1. Verify Hierarchy Ownership
            if (dept_id) {
                const [dept] = await db.query("SELECT id FROM college_departments WHERE id = ? AND organization_id = ?", [dept_id, organizationId]);
                if (!dept) return res.status(403).json({ success: false, message: 'Unauthorized department access' });
            }
            if (branch_id) {
                const [branch] = await db.query(
                    "SELECT b.id FROM college_branches b JOIN college_departments d ON b.department_id = d.id WHERE b.id = ? AND d.organization_id = ?",
                    [branch_id, organizationId]
                );
                if (!branch) return res.status(403).json({ success: false, message: 'Unauthorized branch access' });
            }
            if (subject_id) {
                const [subject] = await db.query(
                    "SELECT s.id FROM college_subjects s JOIN college_branches b ON s.branch_id = b.id JOIN college_departments d ON b.department_id = d.id WHERE s.id = ? AND d.organization_id = ?",
                    [subject_id, organizationId]
                );
                if (!subject) return res.status(403).json({ success: false, message: 'Unauthorized subject access' });
            }

            // 2. Generate Task Code
            const taskCode = await TaskController.generateTaskCode(organizationId);
            const taskId = uuidv4();

            // 3. Insert Task
            await db.query(`
                INSERT INTO tasks (
                    id, task_code, title, short_description, description, notes, links, end_date, priority, dept_id, branch_id, subject_id, organization_id, created_by
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            `, [
                taskId, taskCode, title, short_description, description, notes, 
                links ? JSON.stringify(links) : null,
                end_date || null, priority || 'Medium', 
                dept_id || null, branch_id || null, subject_id || null,
                organizationId, userId
            ]);

            // 4. Handle Attachments
            if (req.files && req.files.length > 0) {
                for (const file of req.files) {
                    const result = await fileStorageUtil.storeFile('Tasks', file);
                    await db.query(`
                        INSERT INTO task_attachments (id, task_id, filename, file_url, file_type)
                        VALUES (?, ?, ?, ?, ?)
                    `, [uuidv4(), taskId, file.originalname, result.relativePath, file.mimetype]);
                }
            }

            // 5. Resolve Assignments
            let targetStudentIds = [];
            if (is_all_students === 'true' || is_all_students === true) {
                const students = await db.query('SELECT candidate_id FROM college_candidates WHERE organization_id = ?', [organizationId]);
                targetStudentIds = students.map(s => s.candidate_id);
            } else if (student_ids && Array.isArray(student_ids) && student_ids.length > 0) {
                // Verify provided students belong to organization
                const placeholders = student_ids.map(() => '?').join(',');
                const verifiedStudents = await db.query(
                    `SELECT candidate_id FROM college_candidates WHERE organization_id = ? AND candidate_id IN (${placeholders})`,
                    [organizationId, ...student_ids]
                );
                targetStudentIds = verifiedStudents.map(s => s.candidate_id);
            } else {
                // Resolve by hierarchy
                let query = 'SELECT candidate_id FROM college_candidates WHERE organization_id = ?';
                let params = [organizationId];
                
                if (dept_id) {
                    query += ' AND dept_id = ?';
                    params.push(dept_id);
                }
                if (branch_id) {
                    query += ' AND branch_id = ?';
                    params.push(branch_id);
                }
                
                const students = await db.query(query, params);
                targetStudentIds = students.map(s => s.candidate_id);
            }

            // 6. Bulk Insert into student_tasks
            if (targetStudentIds.length > 0) {
                const uniqueIds = [...new Set(targetStudentIds)];
                for (const studentId of uniqueIds) {
                    await db.query(`
                        INSERT INTO student_tasks (id, student_id, task_id, status)
                        VALUES (?, ?, ?, 'Pending')
                    `, [uuidv4(), studentId, taskId]);
                }
            }

            res.status(201).json({ 
                success: true, 
                message: 'Task created and assigned successfully', 
                taskId, 
                taskCode,
                assignedCount: targetStudentIds.length 
            });
        } catch (err) {
            console.error('[TaskController] Create failed:', err);
            res.status(500).json({ success: false, message: 'Internal server error' });
        }
    }

    /**
     * @desc Get all tasks for the organization
     */
    static async getTasks(req, res) {
        const organizationId = req.user?.organizationId || req.headers['x-user-orgid'];
        const { status, priority, search, dept_id, branch_id, semester, batch } = req.query;
        const { dataScope, id: userId } = req.user || {};

        try {
            const caps = await TaskController.getSchemaCapabilities();

            if (!caps.hasTasks || !caps.hasTaskOrganizationId) {
                return res.status(200).json({ success: true, data: [] });
            }

            const attachmentCountSql = caps.hasTaskAttachments
                ? `(SELECT COUNT(*) FROM task_attachments ta WHERE ta.task_id = t.id)`
                : '0';
            const totalAssignedSql = caps.hasStudentTasks
                ? `(SELECT COUNT(*) FROM student_tasks st WHERE st.task_id = t.id)`
                : '0';
            const completedCountSql = caps.hasStudentTasks
                ? `(SELECT COUNT(*) FROM student_tasks st WHERE st.task_id = t.id AND st.status IN ('Completed', 'Reviewed'))`
                : '0';

            let query = `
                SELECT t.*, 
                d.name as dept_name,
                b.name as branch_name,
                ${caps.hasTaskSubjectId && caps.hasCollegeSubjects ? 's.name' : 'NULL'} as subject_name,
                ${attachmentCountSql} as attachment_count,
                ${totalAssignedSql} as total_assigned,
                ${completedCountSql} as completed_count
                FROM tasks t
                ${caps.hasCollegeDepartments ? 'LEFT JOIN college_departments d ON t.dept_id = d.id' : 'LEFT JOIN (SELECT NULL AS id, NULL AS name) d ON 1=0'}
                ${caps.hasCollegeBranches ? 'LEFT JOIN college_branches b ON t.branch_id = b.id' : 'LEFT JOIN (SELECT NULL AS id, NULL AS name) b ON 1=0'}
                ${caps.hasTaskSubjectId && caps.hasCollegeSubjects ? 'LEFT JOIN college_subjects s ON t.subject_id = s.id' : ''}
                WHERE t.organization_id = ?
            `;
            let params = [organizationId];

            if (dataScope === 'OWN' && caps.hasTaskCreatedBy) {
                query += ' AND t.created_by = ?';
                params.push(userId);
            }

            if (search) {
                query += ' AND (t.title LIKE ? OR t.task_code LIKE ?)';
                params.push(`%${search}%`, `%${search}%`);
            }

            // Multi-select for Departments
            if (dept_id) {
                const deptIds = Array.isArray(dept_id) ? dept_id : dept_id.split(',').filter(Boolean);
                if (deptIds.length > 0) {
                    query += ` AND t.dept_id IN (${deptIds.map(() => '?').join(',')})`;
                    params.push(...deptIds);
                }
            }

            // Multi-select for Branches
            if (branch_id) {
                const branchIds = Array.isArray(branch_id) ? branch_id : branch_id.split(',').filter(Boolean);
                if (branchIds.length > 0) {
                    query += ` AND t.branch_id IN (${branchIds.map(() => '?').join(',')})`;
                    params.push(...branchIds);
                }
            }

            // Multi-select for Priority
            if (priority && priority !== 'All') {
                const priorities = Array.isArray(priority) ? priority : priority.split(',').filter(Boolean);
                if (priorities.length > 0) {
                    query += ` AND t.priority IN (${priorities.map(() => '?').join(',')})`;
                    params.push(...priorities);
                }
            }

            // Multi-select for Semesters
            if (semester && caps.hasTaskSubjectId && caps.hasCollegeSubjects) {
                const semesters = Array.isArray(semester) ? semester : semester.split(',').filter(Boolean);
                if (semesters.length > 0) {
                    query += ` AND s.semester IN (${semesters.map(() => '?').join(',')})`;
                    params.push(...semesters);
                }
            }

            // Status Filtering (Complex logic maintained)
            if (status && status !== 'All' && caps.hasStudentTasks) {
                const statuses = Array.isArray(status) ? status : status.split(',').filter(Boolean);
                if (statuses.length > 0) {
                    const statusConditions = [];
                    if (statuses.includes('Completed')) {
                        statusConditions.push(`((SELECT COUNT(*) FROM student_tasks st WHERE st.task_id = t.id AND st.status IN ('Completed', 'Reviewed')) = (SELECT COUNT(*) FROM student_tasks st WHERE st.task_id = t.id) AND (SELECT COUNT(*) FROM student_tasks st WHERE st.task_id = t.id) > 0)`);
                    }
                    if (statuses.includes('In Progress')) {
                        statusConditions.push(`(EXISTS (SELECT 1 FROM student_tasks st WHERE st.task_id = t.id AND st.status = 'In Progress'))`);
                    }
                    if (statuses.includes('Pending')) {
                        statusConditions.push(`(NOT EXISTS (SELECT 1 FROM student_tasks st WHERE st.task_id = t.id AND st.status != 'Pending'))`);
                    }
                    
                    if (statusConditions.length > 0) {
                        query += ` AND (${statusConditions.join(' OR ')})`;
                    }
                }
            }

            query += ' ORDER BY t.created_at DESC';

            const rows = await db.query(query, params);
            const tasks = rows.map(t => ({
                ...t,
                links: typeof t.links === 'string' ? JSON.parse(t.links) : t.links
            }));

            res.json({ success: true, data: tasks });
        } catch (err) {
            console.error('[TaskController] Get tasks failed:', err);
            res.status(500).json({ success: false, message: 'Internal server error' });
        }
    }

    /**
     * @desc Update an existing task
     */
    static async updateTask(req, res) {
        const { id } = req.params;
        const organizationId = req.user?.organizationId || req.headers['x-user-orgid'];
        const { dataScope, id: userId } = req.user || {};
        
        let { 
            title, 
            short_description, 
            description, 
            notes, 
            links, 
            end_date, 
            priority,
            dept_id,
            branch_id,
            subject_id
        } = req.body;

        if (typeof links === 'string') { try { links = JSON.parse(links); } catch(e) {} }
        
        try {
            // Isolation Check
            let taskQuery = 'SELECT * FROM tasks WHERE id = ? AND organization_id = ?';
            let taskParams = [id, organizationId];
            if (dataScope === 'OWN') {
                taskQuery += ' AND created_by = ?';
                taskParams.push(userId);
            }
            const taskRows = await db.query(taskQuery, taskParams);
            if (taskRows.length === 0) return res.status(404).json({ success: false, message: 'Task not found or access denied' });

            // Verify Hierarchy Ownership
            if (dept_id) {
                const [dept] = await db.query("SELECT id FROM college_departments WHERE id = ? AND organization_id = ?", [dept_id, organizationId]);
                if (!dept) return res.status(403).json({ success: false, message: 'Unauthorized department access' });
            }
            // ... same for branch/subject if provided ...

            await db.query(`
                UPDATE tasks SET 
                    title = ?, short_description = ?, description = ?, notes = ?, 
                    links = ?, end_date = ?, priority = ?, dept_id = ?, branch_id = ?, subject_id = ?
                WHERE id = ?
            `, [
                title, short_description, description, notes, 
                links ? (typeof links === 'string' ? links : JSON.stringify(links)) : null,
                end_date || null, priority || 'Medium', 
                dept_id || null, branch_id || null, subject_id || null,
                id
            ]);

            if (req.files && req.files.length > 0) {
                for (const file of req.files) {
                    const result = await fileStorageUtil.storeFile('Tasks', file);
                    await db.query(`
                        INSERT INTO task_attachments (id, task_id, filename, file_url, file_type)
                        VALUES (?, ?, ?, ?, ?)
                    `, [uuidv4(), id, file.originalname, result.relativePath, file.mimetype]);
                }
            }
            
            res.json({ success: true, message: 'Task updated successfully' });
        } catch (err) {
            console.error('[TaskController] Update failed:', err);
            res.status(500).json({ success: false, message: 'Internal server error' });
        }
    }

    /**
     * @desc Get task details
     */
    static async getTaskDetails(req, res) {
        const { id } = req.params;
        const organizationId = req.user?.organizationId || req.headers['x-user-orgid'];
        const { dataScope, id: userId } = req.user || {};

        try {
            let taskQuery = 'SELECT * FROM tasks WHERE id = ? AND organization_id = ?';
            let taskParams = [id, organizationId];
            if (dataScope === 'OWN') {
                taskQuery += ' AND created_by = ?';
                taskParams.push(userId);
            }

            const taskRows = await db.query(taskQuery, taskParams);
            if (taskRows.length === 0) return res.status(404).json({ success: false, message: 'Task not found' });

            const attachments = await db.query('SELECT id, filename, file_url, file_type FROM task_attachments WHERE task_id = ?', [id]);
            const students = await db.query(`
                SELECT st.status, st.completed_at, st.candidate_message, c.candidate_name, c.email, c.register_no
                FROM student_tasks st
                JOIN college_candidates c ON st.student_id = c.candidate_id
                WHERE st.task_id = ?
            `, [id]);

            const task = taskRows[0];
            task.links = typeof task.links === 'string' ? JSON.parse(task.links) : task.links;

            res.json({ 
                success: true, 
                data: {
                    ...task,
                    attachments,
                    assignments: students
                } 
            });
        } catch (err) {
            console.error('[TaskController] Get task details failed:', err);
            res.status(500).json({ success: false, message: 'Internal server error' });
        }
    }

    /**
     * @desc Get task counts for the organization
     */
    static async getTaskCounts(req, res) {
        const organizationId = req.user?.organizationId || req.headers['x-user-orgid'];
        const { dataScope, id: userId } = req.user || {};

        try {
            const caps = await TaskController.getSchemaCapabilities();

            if (!caps.hasTasks || !caps.hasTaskOrganizationId) {
                return res.json({ success: true, data: { ALL: 0, PENDING: 0, IN_PROGRESS: 0, COMPLETED: 0 } });
            }

            let query = `
                SELECT 
                    id,
                    ${caps.hasStudentTasks ? "(SELECT COUNT(*) FROM student_tasks st WHERE st.task_id = t.id)" : '0'} as total,
                    ${caps.hasStudentTasks ? "(SELECT COUNT(*) FROM student_tasks st WHERE st.task_id = t.id AND st.status IN ('Completed', 'Reviewed'))" : '0'} as done,
                    ${caps.hasStudentTasks ? "(SELECT COUNT(*) FROM student_tasks st WHERE st.task_id = t.id AND st.status = 'In Progress')" : '0'} as in_progress
                FROM tasks t
                WHERE t.organization_id = ?
            `;
            let params = [organizationId];

            if (dataScope === 'OWN' && caps.hasTaskCreatedBy) {
                query += ' AND t.created_by = ?';
                params.push(userId);
            }
            
            const rows = await db.query(query, params);
            const counts = { ALL: rows.length, PENDING: 0, IN_PROGRESS: 0, COMPLETED: 0 };
            
            rows.forEach(r => {
                if (r.total === 0) counts.PENDING++;
                else if (r.done === r.total) counts.COMPLETED++;
                else if (r.done > 0 || r.in_progress > 0) counts.IN_PROGRESS++;
                else counts.PENDING++;
            });
            
            res.json({ success: true, data: counts });
        } catch (err) {
            console.error('[TaskController] Get counts failed:', err);
            res.status(500).json({ success: false, message: 'Internal server error' });
        }
    }

    static async generateTaskCode(organizationId) {
        const rows = await db.query(
            'SELECT task_code FROM tasks WHERE organization_id = ? ORDER BY created_at DESC LIMIT 1',
            [organizationId]
        );

        let nextNum = 1;
        if (rows.length > 0 && rows[0].task_code) {
            const lastCode = rows[0].task_code;
            const match = lastCode.match(/TASK(\d+)/);
            if (match) {
                nextNum = parseInt(match[1], 10) + 1;
            }
        }
        return `TASK${String(nextNum).padStart(4, '0')}`;
    }
}

module.exports = TaskController;
