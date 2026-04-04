const express = require('express');
const router = express.Router();
const multer = require('multer');
const TaskController = require('../controllers/taskController');
const authMiddleware = require('../middlewares/auth.middleware');
const tenantMiddleware = require('../middlewares/tenant.middleware');
const rbacMiddleware = require('../middlewares/rbac.middleware');

// Multer configuration for memory storage
const storage = multer.memoryStorage();
const upload = multer({ 
    storage: storage,
    limits: { fileSize: 10 * 1024 * 1024 } // 10MB limit per file
});

// Apply auth, tenant and RBAC middleware to all task routes
router.use(authMiddleware);
router.use(tenantMiddleware);
router.use(rbacMiddleware('TASKS'));

/**
 * @route POST /tasks
 * @desc Create a new task with attachments and assignments
 */
router.post('/', upload.array('attachments', 5), TaskController.createTask);

/**
 * @route GET /tasks
 * @desc Get all tasks for the organization
 */
router.get('/', TaskController.getTasks);

/**
 * @route GET /tasks/counts
 * @desc Get task counts for tabs
 */
router.get('/counts', TaskController.getTaskCounts);

/**
 * @route GET /tasks/:id
 * @desc Get task details including attachments and student progress
 */
router.get('/:id', TaskController.getTaskDetails);

/**
 * @route PUT /tasks/:id
 * @desc Update an existing task
 */
router.put('/:id', upload.array('attachments', 5), TaskController.updateTask);

/**
 * Legacy support
 */
router.post('/assign-bulk', upload.none(), TaskController.createTask);

module.exports = router;
