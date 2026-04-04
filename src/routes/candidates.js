const express = require('express');
const router = express.Router();
const CandidateService = require('../services/candidateService');
const candidateController = require('../controllers/candidateController');
const authMiddleware = require('../middlewares/auth.middleware');
const tenantMiddleware = require('../middlewares/tenant.middleware');
const rbacMiddleware = require('../middlewares/rbac.middleware');
const emailTemplateController = require('../controllers/emailTemplateController');

router.use(authMiddleware);
router.use(tenantMiddleware);

// Relocated to /admins prefix in admins.js


/**
 * @swagger
 * /candidates/academic-metadata:
 *   get:
 *     summary: Get academic metadata (Depts, Branches, Subjects)
 *     tags: [Candidates]
 */
router.get('/academic-metadata', authMiddleware, candidateController.getAcademicMetadata);

/**
 * @swagger
 * /candidates/bulk-email/recipients:
 *   get:
 *     summary: Get candidates filtered for bulk email
 *     tags: [Candidates]
 */
router.get('/bulk-email/recipients', authMiddleware, candidateController.getCandidatesForBulkEmail);

/**
 * @swagger
 * /candidates/bulk-email/send:
 *   post:
 *     summary: Send mass emails to selected recipients
 *     tags: [Candidates]
 */
router.post('/bulk-email/send', authMiddleware, candidateController.sendBulkEmail);
router.get('/bulk-email/failures/:mongoId', authMiddleware, candidateController.getBulkEmailFailures);


/**
 * @swagger
 * tags:
 *   name: Candidates
 *   description: Candidate management APIs for college recruitment
 */

/**
 * @swagger
 * /candidates:
 *   post:
 *     summary: Create a new candidate
 *     tags: [Candidates]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - candidate_name
 *               - email
 *               - organization_id
 *             properties:
 *               candidate_name:
 *                 type: string
 *               email:
 *                 type: string
 *               mobile_number:
 *                 type: string
 *               organization_id:
 *                 type: string
 *               register_no:
 *                 type: string
 *               department:
 *                 type: string
 *               semester:
 *                 type: integer
 *               candidate_code:
 *                 type: string
 *               register_no:
 *                 type: string
 *               location:
 *                 type: string
 *               internal_notes:
 *                 type: string
 *               candidate_created_by:
 *                 type: string
 *     responses:
 *       201:
 *         description: Candidate created successfully
 *       400:
 *         description: Invalid input
 */
router.post('/', authMiddleware, rbacMiddleware('candidates'), async (req, res) => {
  try {
    const organizationId = req.user?.organizationId || req.user?.organization_id || req.body.organization_id;
    if (!organizationId) {
      return res.status(400).json({
        success: false,
        message: 'organization_id is required'
      });
    }
    const userId = req.user?.id || req.headers['x-user-id'] || req.headers['X-User-Id'] || req.headers['X-User-ID'];
    const candidateData = {
      ...req.body,
      candidate_created_by: userId || req.body.candidate_created_by
    };

    const result = await CandidateService.createCandidate(candidateData, req.tenantDb);
    res.status(201).json(result);
  } catch (error) {
    res.status(400).json({
      success: false,
      message: error.message
    });
  }
});

/**
 * @swagger
 * /candidates/check-global:
 *   get:
 *     summary: Check if a candidate exists globally (outside current org)
 *     tags: [Candidates]
 */
router.get('/check-global', authMiddleware, async (req, res) => {
  try {
    const { email } = req.query;
    const organizationId = req.user?.organizationId || req.user?.organization_id;
    if (!email || !organizationId) {
      return res.status(400).json({ success: false, message: 'Email and organizationId are required' });
    }
    const result = await CandidateService.checkGlobalCandidate(email, organizationId);
    res.json(result);
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

/**
 * @swagger
 * /candidates/verify-global-mobile:
 *   post:
 *     summary: Verify global profile by matching mobile number
 *     tags: [Candidates]
 */
router.post('/verify-global-mobile', authMiddleware, async (req, res) => {
  try {
    const { email, mobile_number } = req.body;
    const organizationId = req.user?.organizationId || req.user?.organization_id;
    if (!email || !mobile_number || !organizationId) {
      return res.status(400).json({ success: false, message: 'Email, mobile_number, and organizationId are required' });
    }
    const result = await CandidateService.verifyGlobalByMobile(email, mobile_number, organizationId);
    res.json(result);
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

/**
 * @swagger
 * /candidates/send-global-otp:
 *   post:
 *     summary: Send verification OTP to global candidate email
 *     tags: [Candidates]
 */
router.post('/send-global-otp', authMiddleware, async (req, res) => {
  try {
    const { email } = req.body;
    if (!email) return res.status(400).json({ success: false, message: 'Email is required' });
    const result = await CandidateService.sendGlobalVerificationOTP(email);
    res.json(result);
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

/**
 * @swagger
 * /candidates/verify-global-otp:
 *   post:
 *     summary: Verify OTP and retrieve global candidate details
 *     tags: [Candidates]
 */
router.post('/verify-global-otp', authMiddleware, async (req, res) => {
  try {
    const { email, code } = req.body;
    const organizationId = req.user?.organizationId || req.user?.organization_id;
    if (!email || !code || !organizationId) {
      return res.status(400).json({ success: false, message: 'Email, code, and organizationId are required' });
    }
    const result = await CandidateService.verifyGlobalByOTP(email, code, organizationId);
    res.json(result);
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

/**
 * @swagger
 * /candidates/counts:
 *   get:
 *     summary: Get candidate counts by status
 *     tags: [Candidates]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: organization_id
 *         required: true
 *         schema:
 *           type: string
 *       - in: query
 *         name: searchTerm
 *         schema:
 *           type: string
 *       - in: query
 *         name: createdBy
 *         schema:
 *           type: string
 *       - in: query
 *         name: dateFrom
 *         schema:
 *           type: string
 *       - in: query
 *         name: dateTo
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Counts by status
 */
router.get('/counts', authMiddleware, tenantMiddleware, rbacMiddleware('candidates'), async (req, res) => {
  try {
    const filters = {
      organizationId: req.query.organization_id,
      searchTerm: req.query.searchTerm,
      createdBy: req.user?.dataFilter?.createdBy || req.query.createdBy,
      dateFrom: req.query.dateFrom,
      dateTo: req.query.dateTo
    };

    if (!filters.organizationId) {
      return res.status(400).json({
        success: false,
        message: 'organization_id is required'
      });
    }

    if (!req.tenantDb) {
      return res.status(400).json({
        success: false,
        message: 'Tenant database not resolved. Ensure X-Tenant-Id or auth context is set.'
      });
    }

    const result = await CandidateService.getCandidateStatusCounts(filters, req.tenantDb);
    res.status(200).json(result);
  } catch (error) {
    res.status(400).json({
      success: false,
      message: error.message
    });
  }
});

/**
 * @swagger
 * /candidates/students/counts:
 *   get:
 *     summary: Get student counts by status (All, Pending, Active, Inactive) for college admin
 *     tags: [Candidates]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: organization_id
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: { data: { All, Pending, Active, Inactive } }
 */
router.get('/students/counts', authMiddleware, rbacMiddleware('students'), async (req, res) => {
  try {
    const organizationId = req.query.organization_id || req.query.organizationId;
    if (!organizationId) {
      return res.status(400).json({ success: false, message: 'organization_id is required' });
    }
    const createdBy = req.user?.dataFilter?.createdBy;
    const result = await CandidateService.getStudentCounts(organizationId, createdBy, req.tenantDb);
    res.status(200).json(result);
  } catch (error) {
    res.status(400).json({ success: false, message: error.message });
  }
});

/**
 * @swagger
 * /candidates/students/batches:
 *   get:
 *     summary: Get unique batches (years) for students
 *     tags: [Candidates]
 */
router.get('/students/batches', authMiddleware, async (req, res) => {
  try {
    const organizationId = req.user?.organizationId || req.user?.organization_id || req.query.organizationId;
    if (!organizationId) {
      return res.status(400).json({ success: false, message: 'organization_id is required' });
    }
    const result = await CandidateService.getUniqueBatches(organizationId);
    res.status(200).json({ success: true, data: result });
  } catch (error) {
    res.status(400).json({ success: false, message: error.message });
  }
});

/**
 * @swagger
 * /candidates/students:
 *   get:
 *     summary: List students (college_candidates) for organization - college admin Students page
 *     tags: [Candidates]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: organization_id
 *         required: true
 *         schema:
 *           type: string
 *       - in: query
 *         name: page
 *         schema:
 *           type: integer
 *       - in: query
 *         name: size
 *         schema:
 *           type: integer
 *       - in: query
 *         name: status
 *         schema:
 *           type: string
 *           enum: [All, Pending, Active, Inactive]
 *       - in: query
 *         name: searchTerm
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Paginated list of students
 */
router.get('/students', authMiddleware, rbacMiddleware('students'), async (req, res) => {
  try {
    const organizationId = req.query.organization_id || req.query.organizationId;
    if (!organizationId) {
      return res.status(400).json({ success: false, message: 'organization_id is required' });
    }
    const sortOrderParam = (req.query.sortOrder || req.query.sort_order || 'DESC').toUpperCase();

    // Support advanced array filters
    const parseArray = (val) => {
      if (!val) return [];
      if (Array.isArray(val)) return val;
      if (typeof val === 'string' && val.includes(',')) return val.split(',');
      return [val];
    };

    const filters = {
      organizationId,
      page: parseInt(req.query.page) || 0,
      pageSize: parseInt(req.query.size || req.query.pageSize) || 10,
      status: (req.query.status && req.query.status !== 'All') ? req.query.status : undefined,
      statuses: parseArray(req.query.statuses),
      searchTerm: req.query.searchTerm,
      createdBy: req.user?.dataFilter?.createdBy || req.query.createdBy,
      sortBy: req.query.sortBy || 'created_at',
      sortOrder: sortOrderParam,
      deptIds: parseArray(req.query.deptIds || req.query.dept_ids),
      branchIds: parseArray(req.query.branchIds || req.query.branch_ids),
      semesters: parseArray(req.query.semesters),
      batches: parseArray(req.query.batches)
    };

    const result = await CandidateService.getStudents(filters, req.tenantDb);
    const pagination = result.pagination || {};
    res.status(200).json({
      content: result.data || [],
      page: pagination.page ?? 0,
      size: pagination.pageSize ?? 10,
      totalElements: pagination.total ?? 0,
      totalPages: pagination.totalPages ?? 0,
      last: pagination.hasNextPage === false
    });
  } catch (error) {
    res.status(400).json({ success: false, message: error.message });
  }
});

/**
 * @swagger
 * /candidates:
 *   get:
 *     summary: Get all candidates with filters and pagination
 *     tags: [Candidates]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: organization_id
 *         required: true
 *         schema:
 *           type: string
 *       - in: query
 *         name: page
 *         schema:
 *           type: integer
 *           default: 0
 *       - in: query
 *         name: pageSize
 *         schema:
 *           type: integer
 *           default: 10
 *       - in: query
 *         name: status
 *         schema:
 *           type: string
 *       - in: query
 *         name: statuses
 *         schema:
 *           type: array
 *           items:
 *             type: string
 *       - in: query
 *         name: searchTerm
 *         schema:
 *           type: string
 *       - in: query
 *         name: createdBy
 *         schema:
 *           type: string
 *       - in: query
 *         name: sortBy
 *         schema:
 *           type: string
 *           default: created_at
 *       - in: query
 *         name: sortOrder
 *         schema:
 *           type: string
 *           enum: [ASC, DESC]
 *           default: DESC
 *     responses:
 *       200:
 *         description: List of candidates with pagination
 */
router.get('/', authMiddleware, tenantMiddleware, rbacMiddleware('candidates'), async (req, res) => {
  try {
    const sortOrderParam = (req.query.sortOrder || req.query.sort_order || 'DESC').toUpperCase();
    const sortOrder = sortOrderParam === 'NEWEST_TO_OLDEST' || sortOrderParam === 'OLDEST_TO_NEWEST'
      ? (sortOrderParam === 'NEWEST_TO_OLDEST' ? 'DESC' : 'ASC')
      : (sortOrderParam === 'ASC' ? 'ASC' : 'DESC');

    const filters = {
      organizationId: req.query.organization_id || req.query.organizationId,
      page: parseInt(req.query.page) || 0,
      pageSize: parseInt(req.query.size || req.query.pageSize) || 10,
      status: req.query.recommendationStatus || req.query.status,
      statuses: req.query.recommendationStatuses
        ? (Array.isArray(req.query.recommendationStatuses) ? req.query.recommendationStatuses : [req.query.recommendationStatuses])
        : (req.query.statuses ? (Array.isArray(req.query.statuses) ? req.query.statuses : [req.query.statuses]) : []),
      searchTerm: req.query.searchTerm,
      createdBy: req.user?.dataFilter?.createdBy || req.query.createdBy,
      sortBy: req.query.sortBy || 'created_at',
      sortOrder,
      dateFrom: req.query.dateFrom || req.query.interviewDateFrom,
      dateTo: req.query.dateTo || req.query.interviewDateTo,
      positionId: req.query.positionId || req.query.position_id
    };

    if (!filters.organizationId) {
      return res.status(400).json({
        success: false,
        message: 'organization_id is required'
      });
    }

    if (!req.tenantDb) {
      return res.status(400).json({
        success: false,
        message: 'Tenant database not resolved. Ensure X-Tenant-Id or auth context is set.'
      });
    }

    const result = await CandidateService.getAllLinkedCandidates(filters, req.tenantDb);
    res.status(200).json({
      content: result.content || [],
      page: result.page ?? 0,
      size: result.size ?? 10,
      totalElements: result.totalElements ?? 0,
      totalPages: result.totalPages ?? 0,
      last: result.last ?? true
    });
  } catch (error) {
    res.status(400).json({
      success: false,
      message: error.message
    });
  }
});

/**
 * @swagger
 * /candidates/linked:
 *   get:
 *     summary: Get all candidates joined with position and question set data
 *     tags: [Candidates]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: organization_id
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Linked candidate list
 */
router.get('/linked', authMiddleware, tenantMiddleware, rbacMiddleware('candidates'), async (req, res) => {
  try {
    const organizationId = req.user?.organizationId || req.user?.organization_id || req.query.organization_id;
    if (!organizationId) {
      return res.status(400).json({
        success: false,
        message: 'organization_id is required'
      });
    }
    const sortOrderParam = (req.query.sortOrder || 'DESC').toUpperCase();
    const sortOrder = sortOrderParam === 'NEWEST_TO_OLDEST' ? 'DESC' : (sortOrderParam === 'OLDEST_TO_NEWEST' ? 'ASC' : (sortOrderParam === 'ASC' ? 'ASC' : 'DESC'));

    const filters = {
      organizationId: organizationId,
      page: parseInt(req.query.page) || 0,
      pageSize: parseInt(req.query.pageSize || req.query.size) || 10,
      status: req.query.status,
      statuses: req.query.statuses ? (Array.isArray(req.query.statuses) ? req.query.statuses : [req.query.statuses]) : [],
      searchTerm: req.query.searchTerm,
      createdBy: req.query.createdBy,
      sortBy: req.query.sortBy || 'created_at',
      sortOrder,
      dateFrom: req.query.dateFrom,
      dateTo: req.query.dateTo
    };

    if (!filters.organizationId) {
      return res.status(400).json({
        success: false,
        message: 'organization_id is required'
      });
    }

    const result = await CandidateService.getAllLinkedCandidates(filters, req.tenantDb);
    res.status(200).json({
      content: result.content || [],
      page: result.page ?? 0,
      size: result.size ?? 10,
      totalElements: result.totalElements ?? 0,
      totalPages: result.totalPages ?? 0,
      last: result.last ?? true
    });
  } catch (error) {
    res.status(400).json({
      success: false,
      message: error.message
    });
  }
});

/**
 * @swagger
 * /candidates/search:
 *   post:
 *     summary: Search candidates with advanced filters
 *     tags: [Candidates]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - organization_id
 *             properties:
 *               organization_id:
 *                 type: string
 *               page:
 *                 type: integer
 *               pageSize:
 *                 type: integer
 *               status:
 *                 type: string
 *               statuses:
 *                 type: array
 *                 items:
 *                   type: string
 *               searchTerm:
 *                 type: string
 *               dateFrom:
 *                 type: string
 *               dateTo:
 *                 type: string
 *     responses:
 *       200:
 *         description: Search results
 */
router.post('/search', authMiddleware, rbacMiddleware('candidates'), async (req, res) => {
  try {
    const organizationId = req.user?.organizationId || req.user?.organization_id || req.body.organization_id;
    if (!organizationId) {
      return res.status(400).json({
        success: false,
        message: 'organization_id is required'
      });
    }
    const filters = {
      organizationId: organizationId,
      page: req.body.page || 0,
      pageSize: req.body.pageSize || 10,
      status: req.body.status,
      statuses: req.body.statuses || [],
      searchTerm: req.body.searchTerm,
      createdBy: req.body.createdBy,
      sortBy: req.body.sortBy || 'created_at',
      sortOrder: (req.body.sortOrder || 'DESC').toUpperCase(),
      dateFrom: req.body.dateFrom,
      dateTo: req.body.dateTo
    };

    if (!filters.organizationId) {
      return res.status(400).json({
        success: false,
        message: 'organization_id is required'
      });
    }

    const result = await CandidateService.getAllCandidates(filters, req.tenantDb);
    res.status(200).json(result);
  } catch (error) {
    res.status(400).json({
      success: false,
      message: error.message
    });
  }
});

/**
 * @swagger
 * /candidates/auto-fetch/{email}:
 *   get:
 *     summary: Fetch existing candidate details by email
 *     tags: [Candidates]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: email
 *         required: true
 *         schema:
 *           type: string
 *       - in: query
 *         name: organization_id
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Candidate details
 */
router.get('/auto-fetch/:email', authMiddleware, rbacMiddleware('candidates'), async (req, res) => {
  try {
    const organizationId = req.user?.organizationId || req.user?.organization_id || req.query.organization_id;
    if (!organizationId) {
      return res.status(400).json({
        success: false,
        message: 'organization_id is required'
      });
    }

    const result = await CandidateService.getCandidateByEmail(req.params.email, organizationId, req.tenantDb);
    res.status(200).json(result);
  } catch (error) {
    res.status(400).json({
      success: false,
      message: error.message
    });
  }
});

/**
 * @swagger
 * /candidates/check-whatsapp/{whatsapp}:
 *   get:
 *     summary: Check if WhatsApp number is available
 *     tags: [Candidates]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: whatsapp
 *         required: true
 *         schema:
 *           type: string
 *       - in: query
 *         name: organization_id
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: WhatsApp availability status
 */
router.get('/check-whatsapp/:whatsapp', authMiddleware, rbacMiddleware('candidates'), async (req, res) => {
  try {
    const organizationId = req.user?.organizationId || req.user?.organization_id || req.query.organization_id;
    if (!organizationId) {
      return res.status(400).json({
        success: false,
        message: 'organization_id is required'
      });
    }
    // When adding existing candidate to another position (add exam), pass candidate_id so their own number is treated as available
    const candidateId = req.query.candidate_id || req.query.candidateId || null;

    const result = await CandidateService.checkWhatsAppAvailability(req.params.whatsapp, organizationId, candidateId, req.tenantDb);
    res.status(200).json(result);
  } catch (error) {
    res.status(400).json({
      success: false,
      message: error.message
    });
  }
});

/**
 * @swagger
 * /candidates/{id}:
 *   get:
 *     summary: Get candidate by ID
 *     tags: [Candidates]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *       - in: query
 *         name: organization_id
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Candidate details
 *       404:
 *         description: Candidate not found
 */
router.get('/:id/positions', authMiddleware, tenantMiddleware, async (req, res) => {
  try {
    const organizationId = req.query.organization_id || req.query.organizationId;
    if (!organizationId) {
      return res.status(400).json({ success: false, message: 'organization_id is required' });
    }
    if (!req.tenantDb) {
      return res.status(400).json({ success: false, message: 'Tenant database not resolved (X-Tenant-Id)' });
    }
    const result = await CandidateService.getPositionsForCandidate(req.params.id, organizationId, req.tenantDb);
    res.status(200).json(result);
  } catch (error) {
    res.status(400).json({ success: false, message: error.message });
  }
});

router.get('/:id', authMiddleware, rbacMiddleware('candidates'), async (req, res) => {
  try {
    const organizationId = req.user?.organizationId || req.user?.organization_id || req.query.organization_id;
    if (!organizationId) {
      return res.status(400).json({
        success: false,
        message: 'organization_id is required'
      });
    }

    const result = await CandidateService.getCandidateById(req.params.id, organizationId, req.tenantDb);
    res.status(200).json(result);
  } catch (error) {
    res.status(error.message.includes('not found') ? 404 : 400).json({
      success: false,
      message: error.message
    });
  }
});

/**
 * GET /candidates/:id/resume/download — download resume file (from qwikhire-prod-storage/.../Resume or legacy uploads)
 */
router.get('/:id/resume/download', authMiddleware, rbacMiddleware('candidates'), async (req, res) => {
  try {
    const organizationId = req.user?.organizationId || req.user?.organization_id || req.query.organization_id;
    if (!organizationId) {
      return res.status(400).json({ success: false, message: 'organization_id is required' });
    }
    const fileStorageUtil = require('../utils/fileStorageUtil');
    const { buffer, filename } = await CandidateService.getCandidateResume(req.params.id, organizationId, req.tenantDb);
    const contentType = fileStorageUtil.getContentType(filename);
    res.setHeader('Content-Type', contentType);
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.send(buffer);
  } catch (error) {
    res.status(error.message.includes('not found') || error.message.includes('does not have') ? 404 : 400).json({
      success: false,
      message: error.message
    });
  }
});

/**
 * @swagger
 * /candidates/{id}:
 *   put:
 *     summary: Update candidate details
 *     tags: [Candidates]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *       - in: query
 *         name: organization_id
 *         required: true
 *         schema:
 *           type: string
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               candidate_name:
 *                 type: string
 *               email:
 *                 type: string
 *               mobile_number:
 *                 type: string
 *               department:
 *                 type: string
 *               semester:
 *                 type: integer
 *               location:
 *                 type: string
 *               address:
 *                 type: string
 *               interview_notes:
 *                 type: string
 *               internal_notes:
 *                 type: string
 *               status:
 *                 type: string
 *     responses:
 *       200:
 *         description: Candidate updated successfully
 */
router.put('/:id', authMiddleware, rbacMiddleware('candidates'), async (req, res) => {
  try {
    const organizationId = req.user?.organizationId || req.user?.organization_id || req.query.organization_id;
    if (!organizationId) {
      return res.status(400).json({
        success: false,
        message: 'organization_id is required'
      });
    }

    const result = await CandidateService.updateCandidate(req.params.id, organizationId, req.body, req.tenantDb);
    res.status(200).json(result);
  } catch (error) {
    res.status(error.message.includes('not found') ? 404 : 400).json({
      success: false,
      message: error.message
    });
  }
});

/**
 * @swagger
 * /candidates/{id}/internal-notes:
 *   put:
 *     summary: Update internal notes for candidate
 *     tags: [Candidates]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *       - in: query
 *         name: organization_id
 *         required: true
 *         schema:
 *           type: string
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - internal_notes
 *             properties:
 *               internal_notes:
 *                 type: string
 *     responses:
 *       200:
 *         description: Internal notes updated
 */
router.put('/:id/internal-notes', authMiddleware, rbacMiddleware('candidates'), async (req, res) => {
  try {
    const organizationId = req.user?.organizationId || req.user?.organization_id || req.query.organization_id;
    if (!organizationId) {
      return res.status(400).json({
        success: false,
        message: 'organization_id is required'
      });
    }

    const notesBy = req.user?.id || req.headers['x-user-id'] || req.headers['X-User-Id'] || req.headers['X-User-ID'] || null;
    const result = await CandidateService.updateInternalNotes(
      req.params.id,
      organizationId,
      req.body.internal_notes,
      notesBy
    );
    res.status(200).json(result);
  } catch (error) {
    res.status(400).json({
      success: false,
      message: error.message
    });
  }
});

/**
 * @swagger
 * /candidates/{id}/status:
 *   put:
 *     summary: Update candidate status
 *     tags: [Candidates]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *       - in: query
 *         name: organization_id
 *         required: true
 *         schema:
 *           type: string
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - status
 *             properties:
 *               status:
 *                 type: string
 *                 enum: [All, Applied, Invited, Manually Invited, Resume Rejected, Recommended, Not-Recommended, Cautiously Recommended, Test Completed, Round1, Round2, Round3, Round4, Network Issue]
 *     responses:
 *       200:
 *         description: Status updated
 */
router.put('/:id/status', authMiddleware, rbacMiddleware('candidates'), async (req, res) => {
  try {
    const organizationId = req.user?.organizationId || req.user?.organization_id || req.query.organization_id;
    if (!organizationId) {
      return res.status(400).json({
        success: false,
        message: 'organization_id is required'
      });
    }

    const changedBy = req.user?.id || req.headers['x-user-id'] || req.headers['X-User-Id'] || req.headers['X-User-ID'] || null;
    const result = await CandidateService.updateCandidateStatus(
      req.params.id,
      organizationId,
      req.body.status,
      changedBy,
      req.body.remarks
    );
    res.status(200).json(result);
  } catch (error) {
    res.status(400).json({
      success: false,
      message: error.message
    });
  }
});

/**
 * @swagger
 * /candidates/{id}:
 *   delete:
 *     summary: Delete candidate
 *     tags: [Candidates]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *       - in: query
 *         name: organization_id
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Candidate deleted
 */
router.delete('/:id', authMiddleware, rbacMiddleware('candidates'), async (req, res) => {
  try {
    const organizationId = req.user?.organizationId || req.user?.organization_id || req.query.organization_id;
    if (!organizationId) {
      return res.status(400).json({
        success: false,
        message: 'organization_id is required'
      });
    }

    const result = await CandidateService.deleteCandidate(req.params.id, organizationId);
    res.status(200).json(result);
  } catch (error) {
    res.status(400).json({
      success: false,
      message: error.message
    });
  }
});

/**
 * @swagger
 * /candidates/{id}/link:
 *   post:
 *     summary: Create private or public link for candidate
 *     tags: [Candidates]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *       - in: query
 *         name: organization_id
 *         required: true
 *         schema:
 *           type: string
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - link_type
 *               - position_id
 *             properties:
 *               link_type:
 *                 type: string
 *                 enum: [PRIVATE, PUBLIC]
 *               position_id:
 *                 type: string
 *     responses:
 *       201:
 *         description: Link created successfully
 */
router.post('/:id/link', authMiddleware, rbacMiddleware('candidates'), async (req, res) => {
  try {
    const organizationId = req.user?.organizationId || req.user?.organization_id || req.query.organization_id;
    if (!organizationId) {
      return res.status(400).json({
        success: false,
        message: 'organization_id is required'
      });
    }

    const result = await CandidateService.createCandidateLink(
      req.params.id,
      organizationId,
      req.body.position_id,
      req.body.link_type,
      req.user?.id || req.body.created_by
    );
    res.status(201).json(result);
  } catch (error) {
    res.status(400).json({
      success: false,
      message: error.message
    });
  }
});

/**
 * @swagger
 * /candidates/{id}/position-mapping:
 *   post:
 *     summary: Map candidate to position
 *     tags: [Candidates]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *       - in: query
 *         name: organization_id
 *         required: true
 *         schema:
 *           type: string
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - position_id
 *             properties:
 *               position_id:
 *                 type: string
 *               job_title:
 *                 type: string
 *               position_code:
 *                 type: string
 *               question_set_id:
 *                 type: string
 *               question_section_id:
 *                 type: string
 *               resume_score:
 *                 type: number
 *               status:
 *                 type: string
 *               interview_notes:
 *                 type: string
 *               notes_by:
 *                 type: string
 *               notes_date:
 *                 type: string
 *     responses:
 *       201:
 *         description: Candidate mapped to position
 */
router.post('/:id/position-mapping', authMiddleware, tenantMiddleware, rbacMiddleware('candidates'), async (req, res) => {
  try {
    const organizationId = req.user?.organizationId || req.user?.organization_id || req.query.organization_id;
    if (!organizationId) {
      return res.status(400).json({
        success: false,
        message: 'organization_id is required'
      });
    }

    const createdBy = req.user?.id || req.headers['x-user-id'] || req.headers['X-User-Id'] || req.headers['X-User-ID'] || req.body.created_by || null;
    const result = await CandidateService.mapCandidateToPosition(
      req.params.id,
      organizationId,
      {
        ...req.body,
        created_by: createdBy
      },
      req.tenantDb
    );
    res.status(201).json(result);
  } catch (error) {
    res.status(400).json({
      success: false,
      message: error.message
    });
  }
});

/**
 * @swagger
 * /candidates/position/{positionId}:
 *   get:
 *     summary: Get candidates for a specific position
 *     tags: [Candidates]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: positionId
 *         required: true
 *         schema:
 *           type: string
 *       - in: query
 *         name: organization_id
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: List of candidates for position
 */
router.get('/position/:positionId', authMiddleware, tenantMiddleware, rbacMiddleware('candidates'), async (req, res) => {
  try {
    const organizationId = req.user?.organizationId || req.user?.organization_id || req.query.organization_id;
    if (!organizationId) {
      return res.status(400).json({
        success: false,
        message: 'organization_id is required'
      });
    }

    const result = await CandidateService.getCandidatesForPosition(
      req.params.positionId,
      organizationId,
      req.tenantDb
    );
    res.status(200).json(result);
  } catch (error) {
    res.status(400).json({
      success: false,
      message: error.message
    });
  }
});

/**
 * @swagger
 * /candidates/bulk/status:
 *   put:
 *     summary: Bulk update candidate status
 *     tags: [Candidates]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - candidate_ids
 *               - organization_id
 *               - status
 *             properties:
 *               candidate_ids:
 *                 type: array
 *                 items:
 *                   type: string
 *               organization_id:
 *                 type: string
 *               status:
 *                 type: string
 *     responses:
 *       200:
 *         description: Bulk update completed
 */
router.put('/bulk/status', authMiddleware, rbacMiddleware('candidates'), async (req, res) => {
  try {
    const organizationId = req.user?.organizationId || req.user?.organization_id || req.body.organization_id;
    if (!organizationId) {
      return res.status(400).json({ success: false, message: 'organization_id is required' });
    }
    const result = await CandidateService.bulkUpdateCandidateStatus(
      req.body.candidate_ids,
      req.body.organization_id,
      req.body.status
    );
    res.status(200).json(result);
  } catch (error) {
    res.status(400).json({
      success: false,
      message: error.message
    });
  }
});

// Add candidate with private link (with file upload) — resumes saved under qwikhire-prod-storage/6464-0160-2190-198-79266/Resume
router.post('/add-with-link', authMiddleware, tenantMiddleware, rbacMiddleware('candidates'), async (req, res) => {
  try {
    const multer = require('multer');
    const upload = multer({ storage: multer.memoryStorage() });

    upload.any()(req, res, async (err) => {
      if (err) {
        return res.status(400).json({
          success: false,
          message: 'File upload error: ' + err.message
        });
      }

      console.log('DEBUG: Received multipart request /add-with-link');
      console.log('DEBUG: req.body fields:', Object.keys(req.body));
      console.log('DEBUG: req.files fieldnames:', (req.files || []).map(f => f.fieldname));

      try {
        const resumeFile = req.files ? req.files.find(f => f.fieldname === 'resumeFile') : null;
        const candidateFile = req.files ? req.files.find(f => f.fieldname === 'candidate') : null;

        const result = await CandidateService.createCandidateWithPrivateLink(
          req.body,
          resumeFile,
          req.user,
          req.tenantDb,
          candidateFile
        );
        res.status(201).json(result);
      } catch (innerError) {
        console.error('DEBUG: Error in add-with-link callback:', innerError);
        if (!res.headersSent) {
          res.status(innerError.status || 500).json({
            success: false,
            message: innerError.message
          });
        }
      }
    });
  } catch (error) {
    res.status(400).json({
      success: false,
      message: error.message
    });
  }
});

// Check if public link exists
router.get('/public-link/check/:positionId', authMiddleware, tenantMiddleware, rbacMiddleware('candidates'), async (req, res) => {
  try {
    const result = await CandidateService.checkPublicLinkExists(req.params.positionId, req.user);
    res.status(200).json(result);
  } catch (error) {
    res.status(400).json({
      success: false,
      message: error.message
    });
  }
});

// Generate public link
router.post('/public-link', authMiddleware, tenantMiddleware, rbacMiddleware('candidates'), async (req, res) => {
  try {
    const result = await CandidateService.generatePublicLink(req.body, req.user);
    res.status(201).json(result);
  } catch (error) {
    res.status(400).json({
      success: false,
      message: error.message
    });
  }
});

// Get public link details (no auth required)
router.get('/public-link/:linkId', async (req, res) => {
  try {
    const result = await CandidateService.getPublicLinkDetails(req.params.linkId);
    res.status(200).json(result);
  } catch (error) {
    res.status(400).json({
      success: false,
      message: error.message
    });
  }
});

// Public registration (no auth required) — resumes saved under qwikhire-prod-storage/6464-0160-2190-198-79266/Resume
router.post('/public-register', async (req, res) => {
  try {
    const multer = require('multer');
    const upload = multer({ storage: multer.memoryStorage() });

    upload.single('resume')(req, res, async (err) => {
      if (err) {
        return res.status(400).json({
          success: false,
          message: 'File upload error'
        });
      }

      const result = await CandidateService.publicRegistration(req.body, req.file);
      res.status(201).json(result);
    });
  } catch (error) {
    res.status(400).json({
      success: false,
      message: error.message
    });
  }
});

// Get public position details (no auth required)
router.get('/public-position/:positionId/:organizationId', async (req, res) => {
  try {
    const result = await CandidateService.getPublicPositionDetails(
      req.params.positionId,
      req.params.organizationId
    );
    res.status(200).json(result);
  } catch (error) {
    res.status(400).json({
      success: false,
      message: error.message
    });
  }
});




module.exports = router;
