/**
 * Extract APIs: extract keywords from JD/Resume (PDF/DOCX) and save to jd_extract / resume_extract.
 * No AI. Uses pdf-parse and mammoth. Upsert: JD by position_id; resume by (candidate_id, position_id).
 */
const express = require('express');
const multer = require('multer');
const router = express.Router();
const authMiddleware = require('../middlewares/auth.middleware');
const tenantMiddleware = require('../middlewares/tenant.middleware');
const extractService = require('../services/extractService');
const config = require('../config');
const axios = require('axios');

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });

/**
 * POST /extract/jd
 * Body: multipart with file (JD PDF/DOCX), positionId, organizationId.
 * If position_id already in jd_extract → update; else insert.
 */
router.post('/jd', authMiddleware, tenantMiddleware, upload.single('file'), async (req, res) => {
  try {
    const file = req.file;
    const positionId = req.body.positionId || req.body.position_id;
    const organizationId = req.body.organizationId || req.body.organization_id || req.body.orgId;
    if (!file || !file.buffer) {
      return res.status(400).json({ success: false, message: 'File (PDF or DOCX) is required' });
    }
    if (!positionId || !organizationId) {
      return res.status(400).json({ success: false, message: 'positionId and organizationId are required' });
    }
    if (!req.tenantDb) {
      return res.status(400).json({ success: false, message: 'Tenant not resolved' });
    }
    const result = await extractService.extractAndSaveJd(
      req.tenantDb,
      positionId,
      organizationId,
      file.buffer,
      file.originalname
    );
    return res.status(200).json({
      success: true,
      message: result.updated ? 'JD extract updated' : 'JD extract saved',
      data: { id: result.id, updated: result.updated, keywordsCount: result.keywordsCount }
    });
  } catch (err) {
    console.error('extract/jd error:', err);
    return res.status(500).json({
      success: false,
      message: err.message || 'Failed to extract and save JD'
    });
  }
});

/**
 * POST /extract/resume
 * Body: multipart with file (resume PDF/DOCX), candidateId, positionId, organizationId.
 * If (candidate_id, position_id) already in resume_extract → update; else insert.
 */
router.post('/resume', authMiddleware, tenantMiddleware, upload.single('file'), async (req, res) => {
  try {
    const file = req.file;
    const candidateId = req.body.candidateId || req.body.candidate_id;
    const positionId = req.body.positionId || req.body.position_id;
    const organizationId = req.body.organizationId || req.body.organization_id || req.body.orgId;
    if (!file || !file.buffer) {
      return res.status(400).json({ success: false, message: 'File (PDF or DOCX) is required' });
    }
    if (!candidateId || !positionId || !organizationId) {
      return res.status(400).json({ success: false, message: 'candidateId, positionId and organizationId are required' });
    }
    if (!req.tenantDb) {
      return res.status(400).json({ success: false, message: 'Tenant not resolved' });
    }
    const result = await extractService.extractAndSaveResume(
      req.tenantDb,
      candidateId,
      positionId,
      organizationId,
      file.buffer,
      file.originalname
    );
    return res.status(200).json({
      success: true,
      message: result.updated ? 'Resume extract updated' : 'Resume extract saved',
      data: { id: result.id, updated: result.updated, keywordsCount: result.keywordsCount }
    });
  } catch (err) {
    console.error('extract/resume error:', err);
    return res.status(500).json({
      success: false,
      message: err.message || 'Failed to extract and save resume'
    });
  }
});

/**
 * POST /extract/resume-from-candidate
 * Body: JSON { candidateId, positionId, organizationId }. Fetches resume text from CandidateBackend, extracts keywords, saves.
 * Use when resume is already stored (e.g. after add candidate); no file upload.
 */
router.post('/resume-from-candidate', authMiddleware, tenantMiddleware, async (req, res) => {
  try {
    const { candidateId, positionId, organizationId } = req.body;
    if (!candidateId || !positionId || !organizationId) {
      return res.status(400).json({ success: false, message: 'candidateId, positionId and organizationId are required' });
    }
    if (!req.tenantDb) {
      return res.status(400).json({ success: false, message: 'Tenant not resolved' });
    }
    const candidateUrl = (config.candidateServiceUrl || '').replace(/\/$/, '');
    if (!candidateUrl) {
      return res.status(503).json({ success: false, message: 'Candidate service not configured' });
    }
    const authHeader = req.headers.authorization || req.headers.Authorization;
    const headers = { 'Content-Type': 'application/json' };
    if (authHeader) headers.Authorization = authHeader;
    if (req.headers['x-tenant-id']) headers['X-Tenant-Id'] = req.headers['x-tenant-id'];
    const resumeRes = await axios.get(
      `${candidateUrl}/candidates/${encodeURIComponent(candidateId)}/resume-text`,
      { timeout: 15000, headers }
    );
    const resumeText = resumeRes.data?.resumeText || '';
    if (!resumeText || resumeText.length < 20) {
      return res.status(422).json({ success: false, message: 'Resume text not available or too short' });
    }
    const result = await extractService.extractAndSaveResumeFromText(
      req.tenantDb,
      candidateId,
      positionId,
      organizationId,
      resumeText
    );
    return res.status(200).json({
      success: true,
      message: result.updated ? 'Resume extract updated' : 'Resume extract saved',
      data: { id: result.id, updated: result.updated, keywordsCount: result.keywordsCount }
    });
  } catch (err) {
    const status = err.response?.status || 500;
    const msg = err.response?.data?.message || err.message || 'Failed to fetch resume or save extract';
    console.error('extract/resume-from-candidate error:', err.message);
    return res.status(status).json({ success: false, message: msg });
  }
});

module.exports = router;
