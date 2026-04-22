const express = require('express');
const router = express.Router();
const adminController = require('../controllers/adminController');
const positionController = require('../controllers/positionController');
const tenantMiddleware = require('../middlewares/tenant.middleware');
const serviceAuth = require('../middlewares/serviceAuth.middleware');
const config = require('../config');
const questionSetController = require('../controllers/questionSetController');
const questionSectionController = require('../controllers/questionSectionController');
const interviewInstructionsController = require('../controllers/interviewInstructionsController');
const candidateController = require('../controllers/candidateController');
const atsCandidateController = require('../controllers/atsCandidateController');
const ActivityLogService = require('../services/activityLogService');
const authMiddleware = require('../middlewares/auth.middleware');
const rbacMiddleware = require('../middlewares/rbac.middleware');
const rbacController = require('../controllers/rbacController');
const dashboardController = require('../controllers/dashboardController');
const emailTemplateController = require('../controllers/emailTemplateController');
const jobController = require('../controllers/jobController');
const clientController = require('../controllers/clientController');

// RBAC Routes
router.get('/organizations/:orgId/roles', authMiddleware, tenantMiddleware, rbacMiddleware('roles'), rbacController.getRoles);
router.post('/organizations/:orgId/roles', authMiddleware, tenantMiddleware, rbacMiddleware('roles'), rbacController.createRole);
router.get('/organizations/:orgId/users', authMiddleware, tenantMiddleware, rbacMiddleware('myTeam'), rbacController.getUsers);
router.post('/organizations/:orgId/users', authMiddleware, tenantMiddleware, rbacMiddleware('myTeam'), rbacController.createUser);
router.put('/organizations/:orgId/users/:userId', authMiddleware, tenantMiddleware, rbacMiddleware('myTeam'), rbacController.updateUser);

// Permission management
router.get('/features', authMiddleware, tenantMiddleware, rbacController.getFeatures);
router.get('/roles/:roleId/permissions', authMiddleware, tenantMiddleware, rbacController.getRolePermissions);
router.put('/roles/:roleId/permissions', authMiddleware, tenantMiddleware, rbacController.updateRolePermissions);

// Public routes (No service token required)
router.post('/forgot-password', adminController.forgotPassword);
router.post('/reset-password', adminController.resetPassword);

// Credit routes
router.get('/credits/:organizationId', authMiddleware, tenantMiddleware, adminController.getCredits);
router.get('/credits/history/:organizationId', authMiddleware, tenantMiddleware, adminController.getCreditHistory);

router.get('/debug', authMiddleware, tenantMiddleware, (req, res) => {
    res.json({
        user: req.user,
        tenantDb: req.tenantDb,
        headers: {
            'x-tenant-id': req.headers['x-tenant-id'],
            'x-user-id': req.headers['x-user-id']
        }
    });
});

// Activity routes
router.get('/activities', authMiddleware, tenantMiddleware, rbacMiddleware('dashboard'), async (req, res) => {
    try {
        const organizationId = req.user?.organizationId || req.user?.organization_id || req.query.organization_id || req.query.organizationId;
        if (!organizationId) {
            return res.status(400).json({ success: false, message: 'organization_id is required' });
        }

        const page = Math.max(parseInt(req.query.page, 10) || 0, 0);
        const requestedPageSize = Math.max(parseInt(req.query.pageSize, 10) || 10, 1);
        const limit = Math.min(requestedPageSize, 10); // Hard cap from backend: never return more than 10 records per request.
        const filters = {
            activityType: req.query.activityType || 'ALL',
            hours: req.query.hours ? parseInt(req.query.hours) : null,
            limit,
            offset: page * limit,
            actorId: req.user?.dataFilter?.createdBy || req.query.actorId
        };

        const activities = await ActivityLogService.getRecentActivities(req.tenantDb, organizationId, filters);
        const totalElements = await ActivityLogService.getRecentActivitiesCount(req.tenantDb, organizationId, filters);
        const totalPages = Math.ceil(totalElements / limit);

        res.status(200).json({
            success: true,
            data: activities,
            pagination: {
                page,
                pageSize: limit,
                totalElements,
                totalPages,
                hasNext: page < Math.max(totalPages - 1, 0),
                hasPrev: page > 0,
            },
        });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
});

router.get('/activities/counts', authMiddleware, tenantMiddleware, rbacMiddleware('dashboard'), async (req, res) => {
    try {
        const organizationId = req.user?.organizationId || req.user?.organization_id || req.query.organizationId;
        if (!organizationId) {
            return res.status(400).json({ success: false, message: 'organization_id is required' });
        }
        const hours = parseInt(req.query.hours) || 12;
        const actorId = req.user?.dataFilter?.createdBy || req.query.actorId;
        const counts = await ActivityLogService.getRecentActivityCounts(req.tenantDb, organizationId, hours, actorId);
        res.status(200).json({ success: true, data: counts });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
});

// Dashboard Analytics routes
router.get('/dashboard/stats', authMiddleware, tenantMiddleware, rbacMiddleware('dashboard'), dashboardController.getDashboardStats);
router.get('/dashboard/trends', authMiddleware, tenantMiddleware, rbacMiddleware('dashboard'), dashboardController.getDashboardTrends);
router.get('/dashboard/team-performance', authMiddleware, tenantMiddleware, rbacMiddleware('dashboard'), dashboardController.getTeamPerformance);
router.get('/dashboard/recent-grid', authMiddleware, tenantMiddleware, rbacMiddleware('dashboard'), dashboardController.getRecentGrid);
router.get('/dashboard/candidate-status', authMiddleware, tenantMiddleware, rbacMiddleware('dashboard'), dashboardController.getCandidateStatus);

// Organization Details routes
router.get('/college-details/:organizationId', authMiddleware, tenantMiddleware, adminController.getCollegeDetails);
router.put('/college-details/:organizationId', authMiddleware, tenantMiddleware, adminController.updateCollegeDetails);
router.get('/company-details/:organizationId', authMiddleware, tenantMiddleware, adminController.getCompanyDetails);
router.put('/company-details/:organizationId', authMiddleware, tenantMiddleware, adminController.updateCompanyDetails);
router.get('/ai-scoring-settings/:organizationId', authMiddleware, tenantMiddleware, adminController.getAiScoringSettings);
router.put('/ai-scoring-settings/:organizationId', authMiddleware, tenantMiddleware, adminController.updateAiScoringSettings);
router.get('/cross-question-settings/:organizationId', authMiddleware, tenantMiddleware, adminController.getCrossQuestionSettings);
router.put('/cross-question-settings/:organizationId', authMiddleware, tenantMiddleware, adminController.updateCrossQuestionSettings);

// Position routes (Require tenant context)
// Optional multer: only parse file when Content-Type is multipart (create-with-JD flow)
const multer = require('multer');
const uploadMemory = multer({ storage: multer.memoryStorage() });
const optionalJdOnCreate = (req, res, next) => {
  const ct = (req.headers['content-type'] || '').toLowerCase();
  if (ct.includes('multipart/form-data')) {
    return uploadMemory.single('file')(req, res, next);
  }
  next();
};
router.post('/positions', authMiddleware, tenantMiddleware, optionalJdOnCreate, rbacMiddleware('positions'), positionController.createPosition);
router.get('/positions/counts', authMiddleware, tenantMiddleware, rbacMiddleware('positions'), positionController.getPositionCounts);
router.get('/positions/filters', authMiddleware, tenantMiddleware, rbacMiddleware('positions'), positionController.getFilterMetadata);
router.get('/positions', authMiddleware, tenantMiddleware, rbacMiddleware('positions'), positionController.getPositions);
// Job description: upload (stored under qwikhire-prod-storage/6464-0160-2190-198-79266/JD)
router.post('/positions/:positionId/job-description', authMiddleware, tenantMiddleware, uploadMemory.single('file'), positionController.uploadJobDescription);
router.get('/positions/:positionId/job-description', authMiddleware, tenantMiddleware, positionController.downloadJobDescription);
router.get('/positions/:positionId', authMiddleware, tenantMiddleware, positionController.getPositionById);
router.put('/positions/:positionId/status', authMiddleware, tenantMiddleware, positionController.updatePositionStatus);
router.put('/positions/:positionId', authMiddleware, tenantMiddleware, positionController.updatePosition);
router.get('/positions/:positionId/candidates', authMiddleware, tenantMiddleware, rbacMiddleware('candidates'), candidateController.getCandidatesByPosition);

// Job routes (ATS only, handled by jobs table)
router.post('/jobs', authMiddleware, tenantMiddleware, optionalJdOnCreate, rbacMiddleware('jobs'), jobController.createJob);
router.get('/jobs', authMiddleware, tenantMiddleware, rbacMiddleware('jobs'), jobController.getJobs);
router.get('/jobs/counts', authMiddleware, tenantMiddleware, rbacMiddleware('jobs'), jobController.getJobsCounts);
router.get('/jobs/clients', authMiddleware, tenantMiddleware, rbacMiddleware('jobs'), jobController.getClients);
router.get('/jobs/:jobId', authMiddleware, tenantMiddleware, rbacMiddleware('jobs'), jobController.getJobById);
router.put('/jobs/:jobId/status', authMiddleware, tenantMiddleware, rbacMiddleware('jobs'), jobController.updateJobStatus);
router.put('/jobs/:jobId/stages', authMiddleware, tenantMiddleware, rbacMiddleware('jobs'), jobController.updateJobStages);
router.put('/jobs/:jobId/visibility', authMiddleware, tenantMiddleware, rbacMiddleware('jobs'), jobController.updateJobVisibility);
router.post('/jobs/:jobId/job-description', authMiddleware, tenantMiddleware, uploadMemory.single('file'), jobController.uploadJobDescription);
router.get('/jobs/:jobId/job-description', authMiddleware, tenantMiddleware, jobController.downloadJobDescription);

// Client Management routes
router.get('/clients', authMiddleware, tenantMiddleware, rbacMiddleware('clients'), clientController.getClients);
router.post('/clients', authMiddleware, tenantMiddleware, rbacMiddleware('clients'), clientController.createClient);
router.get('/clients/:clientId', authMiddleware, tenantMiddleware, rbacMiddleware('clients'), clientController.getClientById);
router.put('/clients/:clientId', authMiddleware, tenantMiddleware, rbacMiddleware('clients'), clientController.updateClient);

// ATS Candidates specifically
router.get('/ats-candidates/status-counts', authMiddleware, tenantMiddleware, rbacMiddleware('candidates'), atsCandidateController.getStatusCounts);
router.post('/ats-candidates', authMiddleware, tenantMiddleware, uploadMemory.single('resume'), rbacMiddleware('candidates'), atsCandidateController.addCandidate);
router.get('/ats-candidates', authMiddleware, tenantMiddleware, rbacMiddleware('candidates'), atsCandidateController.getCandidates);
router.get('/ats-candidates/:candidateId', authMiddleware, tenantMiddleware, rbacMiddleware('candidates'), atsCandidateController.getCandidateById);
router.get('/ats-applications/candidate/:candidateId', authMiddleware, tenantMiddleware, rbacMiddleware('candidates'), atsCandidateController.getApplicationByCandidateId);
router.put('/ats-candidates/:candidateId/stage', authMiddleware, tenantMiddleware, rbacMiddleware('candidates'), atsCandidateController.updateCandidateStage);
router.post('/ats-candidates/:candidateId/score-resume', authMiddleware, tenantMiddleware, rbacMiddleware('candidates'), atsCandidateController.scoreResume);
router.delete('/ats-candidates/:candidateId', authMiddleware, tenantMiddleware, rbacMiddleware('candidates'), atsCandidateController.deleteCandidate);
router.post('/ats-candidates/:candidateId/resend-invitation', authMiddleware, tenantMiddleware, rbacMiddleware('candidates'), atsCandidateController.resendInvitation);
router.post('/ats-candidates/:candidateId/setup-assessment', authMiddleware, tenantMiddleware, rbacMiddleware('candidates'), atsCandidateController.setupAssessment);
router.get('/ats-job-stages', authMiddleware, tenantMiddleware, rbacMiddleware('candidates'), atsCandidateController.getJobStages);
router.post('/ats-candidates/upload', authMiddleware, tenantMiddleware, uploadMemory.single('file'), atsCandidateController.uploadAndExtractResume);

// Question Set routes
router.post('/question-sets', authMiddleware, tenantMiddleware, rbacMiddleware('positions'), questionSetController.createQuestionSet);
router.get('/question-sets', authMiddleware, tenantMiddleware, rbacMiddleware('positions'), questionSetController.getQuestionSets);
router.get('/question-sets/:id', authMiddleware, tenantMiddleware, rbacMiddleware('positions'), questionSetController.getQuestionSetById);
router.put('/question-sets/:id', authMiddleware, tenantMiddleware, rbacMiddleware('positions'), questionSetController.updateQuestionSet);

// Question Section routes
router.post('/question-sections', authMiddleware, tenantMiddleware, rbacMiddleware('positions'), questionSectionController.createQuestionSection);
router.get('/question-sections/:id', authMiddleware, tenantMiddleware, rbacMiddleware('positions'), questionSectionController.getQuestionSectionById);
router.get('/question-sections/question-set/:questionSetId', authMiddleware, tenantMiddleware, rbacMiddleware('positions'), questionSectionController.getSectionsByQuestionSetId);
router.put('/question-sections/:id', authMiddleware, tenantMiddleware, rbacMiddleware('positions'), questionSectionController.updateQuestionSection);
router.delete('/question-sections/:id', authMiddleware, tenantMiddleware, rbacMiddleware('positions'), questionSectionController.deleteQuestionSection);

// Assessment Instructions routes
router.post('/assessment-instructions', authMiddleware, tenantMiddleware, rbacMiddleware('positions'), interviewInstructionsController.saveInstructions);
router.get('/assessment-instructions/:id', authMiddleware, tenantMiddleware, rbacMiddleware('positions'), interviewInstructionsController.getInstructionsById);
router.get('/assessment-instructions/question-set/:questionSetId', authMiddleware, tenantMiddleware, rbacMiddleware('positions'), interviewInstructionsController.getByQuestionSetId);
router.put('/assessment-instructions/question-set/:questionSetId', authMiddleware, tenantMiddleware, rbacMiddleware('positions'), interviewInstructionsController.updateByQuestionSetId);

// Email Template routes
router.get('/email-templates', authMiddleware, tenantMiddleware, emailTemplateController.getAllTemplates);
router.post('/email-templates', authMiddleware, tenantMiddleware, emailTemplateController.createTemplate);
router.put('/email-templates/:id', authMiddleware, tenantMiddleware, emailTemplateController.updateTemplate);
router.delete('/email-templates/:id', authMiddleware, tenantMiddleware, emailTemplateController.deleteTemplate);

router.get('/organizations/:organizationId/info', authMiddleware, adminController.getOrganizationInfo);

// Internal service routes (Require X-Service-Token)
router.use(serviceAuth(config.service.internalToken));

router.post('/create', adminController.createAdmin);
router.post('/provision', adminController.provisionAdmin);

module.exports = router;
