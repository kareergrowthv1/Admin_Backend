/**
 * Dedicated route for POST /position-candidates/score-resume.
 * Mounted first at /position-candidates so this path always matches (avoids 404 from router order).
 */
const express = require('express');
const authMiddleware = require('../middlewares/auth.middleware');
const tenantMiddleware = require('../middlewares/tenant.middleware');
const { handleScoreResume } = require('./positionCandidates');

const router = express.Router();
router.post('/score-resume', authMiddleware, tenantMiddleware, handleScoreResume);

module.exports = router;
