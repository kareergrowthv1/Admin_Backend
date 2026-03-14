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

// Public routes (No service token required)
router.post('/forgot-password', adminController.forgotPassword);
router.post('/reset-password', adminController.resetPassword);

// Credit routes
router.get('/credits/:organizationId', tenantMiddleware, adminController.getCredits);
router.get('/credits/history/:organizationId', tenantMiddleware, adminController.getCreditHistory);

// Organization Details routes
router.get('/college-details/:organizationId', tenantMiddleware, adminController.getCollegeDetails);
router.put('/college-details/:organizationId', tenantMiddleware, adminController.updateCollegeDetails);
router.get('/company-details/:organizationId', tenantMiddleware, adminController.getCompanyDetails);
router.put('/company-details/:organizationId', tenantMiddleware, adminController.updateCompanyDetails);
router.get('/ai-scoring-settings/:organizationId', tenantMiddleware, adminController.getAiScoringSettings);
router.put('/ai-scoring-settings/:organizationId', tenantMiddleware, adminController.updateAiScoringSettings);
router.get('/cross-question-settings/:organizationId', tenantMiddleware, adminController.getCrossQuestionSettings);
router.put('/cross-question-settings/:organizationId', tenantMiddleware, adminController.updateCrossQuestionSettings);

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
router.post('/positions', tenantMiddleware, optionalJdOnCreate, positionController.createPosition);
router.get('/positions/counts', tenantMiddleware, positionController.getPositionCounts);
router.get('/positions/filters', tenantMiddleware, positionController.getFilterMetadata);
router.get('/positions', tenantMiddleware, positionController.getPositions);
// Job description: upload (stored under qwikhire-prod-storage/6464-0160-2190-198-79266/JD)
router.post('/positions/:positionId/job-description', tenantMiddleware, uploadMemory.single('file'), positionController.uploadJobDescription);
router.get('/positions/:positionId/job-description', tenantMiddleware, positionController.downloadJobDescription);
router.get('/positions/:positionId', tenantMiddleware, positionController.getPositionById);
router.put('/positions/:positionId/status', tenantMiddleware, positionController.updatePositionStatus);
router.put('/positions/:positionId', tenantMiddleware, positionController.updatePosition);
router.get('/positions/:positionId/candidates', tenantMiddleware, candidateController.getCandidatesByPosition);

// Question Set routes
router.post('/question-sets', tenantMiddleware, questionSetController.createQuestionSet);
router.get('/question-sets', tenantMiddleware, questionSetController.getQuestionSets);
router.get('/question-sets/:id', tenantMiddleware, questionSetController.getQuestionSetById);
router.put('/question-sets/:id', tenantMiddleware, questionSetController.updateQuestionSet);

// Question Section routes
router.post('/question-sections', tenantMiddleware, questionSectionController.createQuestionSection);
router.get('/question-sections/:id', tenantMiddleware, questionSectionController.getQuestionSectionById);
router.get('/question-sections/question-set/:questionSetId', tenantMiddleware, questionSectionController.getSectionsByQuestionSetId);
router.put('/question-sections/:id', tenantMiddleware, questionSectionController.updateQuestionSection);
router.delete('/question-sections/:id', tenantMiddleware, questionSectionController.deleteQuestionSection);

// Assessment Instructions routes
router.post('/assessment-instructions', tenantMiddleware, interviewInstructionsController.saveInstructions);
router.get('/assessment-instructions/:id', tenantMiddleware, interviewInstructionsController.getInstructionsById);
router.get('/assessment-instructions/question-set/:questionSetId', tenantMiddleware, interviewInstructionsController.getByQuestionSetId);
router.put('/assessment-instructions/question-set/:questionSetId', tenantMiddleware, interviewInstructionsController.updateByQuestionSetId);

// Internal service routes (Require X-Service-Token)
router.use(serviceAuth(config.service.internalToken));

router.post('/create', adminController.createAdmin);
router.post('/provision', adminController.provisionAdmin);

module.exports = router;
