/**
 * Internal API for other services (e.g. Streaming, SuperadminBackend) to fetch data or verify tokens.
 * All routes require X-Service-Token. No user auth middleware.
 */
const express = require('express');
const router = express.Router();
const serviceAuth = require('../middlewares/serviceAuth.middleware');
const config = require('../config');
const db = require('../config/db');
const axios = require('axios');
const jwt = require('jsonwebtoken');
const CandidateModel = require('../models/candidateModel');
const questionSectionService = require('../services/questionSectionService');
const adminService = require('../services/adminService');

router.use(serviceAuth(config.service.internalToken));

/**
 * GET /internal/question-sections/question-set/:questionSetId
 * Returns question sections for a question set.
 */
router.get('/question-sections/question-set/:questionSetId', async (req, res) => {
  try {
    const { questionSetId } = req.params;
    const tenantDb = req.headers['x-tenant-id'];
    if (!tenantDb) {
      return res.status(400).json({ success: false, message: 'X-Tenant-Id header is required' });
    }
    const result = await questionSectionService.getQuestionSectionsByQuestionSetId(tenantDb, questionSetId);
    return res.status(200).json({
      success: true,
      message: 'Question sections retrieved successfully',
      data: result
    });
  } catch (error) {
    console.error('internal/question-sections error:', error);
    return res.status(500).json({ success: false, message: error.message });
  }
});

/**
 * GET /internal/cross-question-settings?clientId=xxx
 * Returns cross-question count settings for an organization (used by Streaming AI backend during init).
 * Headers: X-Service-Token, X-Tenant-Id
 */
router.get('/cross-question-settings', async (req, res) => {
  try {
    const tenantDb = req.headers['x-tenant-id'];
    const { clientId, organizationId } = req.query;
    const orgId = organizationId || clientId;
    if (!tenantDb || !orgId) {
      return res.status(400).json({ success: false, message: 'X-Tenant-Id header and clientId query param required' });
    }
    const settings = await adminService.getCrossQuestionSettings(tenantDb, orgId);
    return res.status(200).json({ success: true, data: settings });
  } catch (error) {
    console.error('internal/cross-question-settings error:', error);
    // Return defaults so the Streaming AI backend always gets a usable response
    return res.status(200).json({ success: true, data: { crossQuestionCountGeneral: 2, crossQuestionCountPosition: 2 } });
  }
});

/**
 * POST /internal/verify-token
 * Body: { token: "Bearer <jwt>" or "<jwt>" }
 * Validates the JWT (same secret as auth). Used by Streaming to verify admin token for /ai/*.
 * Returns 200 { valid: true } or 401.
 */
router.post('/verify-token', (req, res) => {
  try {
    let raw = (req.body && req.body.token) || (req.headers.authorization || '').replace(/^Bearer\s+/i, '').trim();
    if (!raw) return res.status(401).json({ valid: false, message: 'Token required' });
    const secret = process.env.JWT_SECRET;
    if (!secret) return res.status(500).json({ valid: false, message: 'JWT_SECRET not configured' });
    jwt.verify(raw, secret);
    return res.status(200).json({ valid: true });
  } catch (e) {
    return res.status(401).json({ valid: false, message: e.message || 'Invalid or expired token' });
  }
});

function textFromExtractedData(extractedData) {
  if (!extractedData) return '';
  const data = typeof extractedData === 'string'
    ? (() => { try { return JSON.parse(extractedData); } catch { return {}; } })()
    : extractedData;
  if (data.text && String(data.text).trim().length >= 20) return String(data.text).trim();
  const kw = data.keywords;
  if (Array.isArray(kw) && kw.length) return kw.map(k => (k && typeof k === 'string' ? k : String(k))).join(', ');
  if (typeof data.text === 'string') return data.text.trim();
  return '';
}

/**
 * POST /internal/score-resume-input
 * Body: { positionId, candidateId, tenantId }
 * Returns: { jobDescriptionText, resumeText }
 * Used by Streaming resume-ats to get JD and resume text from jd_extract / resume_extract (and fallbacks).
 */
router.post('/score-resume-input', async (req, res) => {
  try {
    const { positionId, candidateId, tenantId } = req.body;
    const tenantDb = tenantId || req.headers['x-tenant-id'];
    if (!positionId || !candidateId || !tenantDb) {
      return res.status(400).json({
        success: false,
        message: 'positionId, candidateId, and tenantId are required'
      });
    }

    let jobDescriptionText = '';
    try {
      const jdRows = await db.query(
        `SELECT extracted_data FROM \`${tenantDb}\`.jd_extract WHERE position_id = ? OR LOWER(REPLACE(position_id, '-', '')) = LOWER(REPLACE(?, '-', '')) LIMIT 1`,
        [positionId, positionId]
      );
      const jdRow = Array.isArray(jdRows) && jdRows[0] ? jdRows[0] : null;
      jobDescriptionText = textFromExtractedData(jdRow?.extracted_data);
    } catch (_) { /* table may not exist */ }

    let minExperience = null;
    let maxExperience = null;
    try {
      const posRows = await db.query(
        `SELECT title, minimum_experience AS minExperience, maximum_experience AS maxExperience
         FROM \`${tenantDb}\`.positions
         WHERE id = UNHEX(REPLACE(?,'-','')) OR BIN_TO_UUID(id) = ? LIMIT 1`,
        [positionId, positionId]
      );
      const pos = Array.isArray(posRows) && posRows[0] ? posRows[0] : null;
      if (pos) {
        if (pos.minExperience != null && !Number.isNaN(Number(pos.minExperience))) minExperience = Number(pos.minExperience);
        if (pos.maxExperience != null && !Number.isNaN(Number(pos.maxExperience))) maxExperience = Number(pos.maxExperience);
        if ((!jobDescriptionText || jobDescriptionText.length < 20) && pos.title) {
          jobDescriptionText = `Role: ${pos.title}. Position requirements and responsibilities.`;
        }
      }
    } catch (_) { /* table/columns may not exist */ }
    if (!jobDescriptionText || jobDescriptionText.length < 20) {
      jobDescriptionText = jobDescriptionText || 'Job role and requirements.';
    }

    let resumeText = '';
    try {
      const resRows = await db.query(
        `SELECT extracted_data FROM \`${tenantDb}\`.resume_extract WHERE (candidate_id = ? OR LOWER(REPLACE(candidate_id, '-', '')) = LOWER(REPLACE(?, '-', ''))) AND (position_id = ? OR LOWER(REPLACE(position_id, '-', '')) = LOWER(REPLACE(?, '-', ''))) LIMIT 1`,
        [candidateId, candidateId, positionId, positionId]
      );
      const resRow = Array.isArray(resRows) && resRows[0] ? resRows[0] : null;
      resumeText = textFromExtractedData(resRow?.extracted_data);
    } catch (_) { /* table may not exist */ }

    if (!resumeText || resumeText.length < 50) {
      const candidateServiceUrl = (config.candidateServiceUrl || '').replace(/\/$/, '');
      if (candidateServiceUrl) {
        try {
          const resumeRes = await axios.get(
            `${candidateServiceUrl}/candidates/${encodeURIComponent(candidateId)}/resume-text`,
            { timeout: 15000, headers: { 'X-Service-Token': config.service.internalToken } }
          );
          resumeText = resumeRes.data?.resumeText || resumeText || '';
        } catch (_) { /* fallback failed */ }
      }
    }

    return res.status(200).json({
      success: true,
      jobDescriptionText: jobDescriptionText || '',
      resumeText: resumeText || '',
      minExperience: minExperience ?? undefined,
      maxExperience: maxExperience ?? undefined
    });
  } catch (error) {
    console.error('internal/score-resume-input error:', error);
    return res.status(500).json({
      success: false,
      message: error.message || 'Failed to get score-resume input'
    });
  }
});

/**
 * POST /internal/candidates/by-identifier
 * Body: { organizationId?, email?, mobile? } – organizationId optional; if omitted, search by email/phone across all orgs.
 * Returns: { candidate: row | null } for portal prefill after OTP.
 */
router.post('/candidates/by-identifier', async (req, res) => {
  try {
    const { organizationId, email, mobile } = req.body || {};
    const hasIdentifier = (email && String(email).trim()) || (mobile && String(mobile).replace(/\D/g, '').length >= 10);
    if (!hasIdentifier) {
      return res.status(400).json({ success: false, message: 'email or mobile is required' });
    }
    const candidate = await CandidateModel.getCandidateByEmailOrPhone(
      organizationId,
      email || null,
      mobile || null,
      'candidates_db'
    );
    const row = candidate ? {
      candidate_id: candidate.candidate_id,
      organization_id: candidate.organization_id,
      candidate_code: candidate.candidate_code,
      register_no: candidate.register_no,
      candidate_name: candidate.candidate_name,
      department: candidate.department,
      semester: candidate.semester,
      email: candidate.email,
      mobile_number: candidate.mobile_number,
      location: candidate.location,
      address: candidate.address,
      birthdate: candidate.birthdate,
      skills: typeof candidate.skills === 'string' ? (() => { try { return JSON.parse(candidate.skills); } catch { return []; } })() : (candidate.skills || [])
    } : null;
    return res.status(200).json({ success: true, candidate: row });
  } catch (e) {
    console.error('internal/candidates/by-identifier error:', e);
    return res.status(500).json({ success: false, message: e.message || 'Failed to get candidate' });
  }
});

/**
 * POST /internal/candidates/register-or-update
 * Body: { organization_id, candidate_id, email, mobile_number?, candidate_name?, register_no?, department?, semester?, location?, address?, birthdate?, skills? }
 * Creates or updates college_candidates (called by SuperadminBackend on candidate register).
 */
router.post('/candidates/register-or-update', async (req, res) => {
  try {
    const id = await CandidateModel.registerOrUpdateCandidate(req.body || {}, 'candidates_db');
    return res.status(200).json({ success: true, candidate_id: id });
  } catch (e) {
    console.error('internal/candidates/register-or-update error:', e);
    return res.status(400).json({ success: false, message: e.message || 'Failed to register or update candidate' });
  }
});

/**
 * POST /internal/report-data
 * Body: { positionId, candidateId, tenantId }
 * Returns position details (title, domainType, mandatorySkills, optionalSkills), JD text, resume text, assessment summary.
 * Used by Streaming AI report_generator.py to collect all data before AI analysis.
 */
router.post('/report-data', async (req, res) => {
  try {
    const { positionId, candidateId } = req.body || {};
    let tenantId = req.body.tenantId;
    if (!positionId || !candidateId) {
      return res.status(400).json({ success: false, message: 'positionId and candidateId are required' });
    }

    // ── Resolve UUID → actual DB name ─────────────────────────────────────────
    // If tenantId looks like an org UUID (standard 8-4-4-4-12 hex format) or an
    // unresolvable value, resolve to the real MySQL tenant DB name via auth_db.
    const isStandardUUID = (s) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s);
    const isLikelyDbName = (s) => s && s.includes('_') && !s.includes('-');

    if (tenantId && isStandardUUID(tenantId)) {
      // Standard org UUID → look up real DB name
      try {
        const orgRows = await db.authQuery(
          'SELECT name FROM auth_db.organizations WHERE id = ? LIMIT 1',
          [tenantId]
        );
        if (orgRows && orgRows[0] && orgRows[0].name) {
          console.log('[internal/report-data] resolved org UUID %s → %s', tenantId, orgRows[0].name);
          tenantId = orgRows[0].name;
        }
      } catch (uuidErr) {
        console.warn('[internal/report-data] UUID resolution failed:', uuidErr.message);
      }
    }

    // Final fallback: if tenantId is empty, not a DB name, or unresolvable,
    // use the first active client DB from auth_db.users
    if (!tenantId || !isLikelyDbName(tenantId)) {
      try {
        const clientRows = await db.authQuery(
          'SELECT DISTINCT client FROM auth_db.users WHERE client IS NOT NULL AND client != "" LIMIT 1',
          []
        );
        if (clientRows && clientRows[0] && clientRows[0].client) {
          console.log('[internal/report-data] falling back to first available client DB: %s', clientRows[0].client);
          tenantId = clientRows[0].client;
        }
      } catch (_) {}
    }
    let tenantDb = tenantId || 'candidates_db';

    // ── Verify tenant DB exists; if not, auto-discover via auth_db ────────────
    if (tenantDb && tenantDb !== 'candidates_db') {
      try {
        const dbExist = await db.query(
          `SELECT SCHEMA_NAME FROM INFORMATION_SCHEMA.SCHEMATA WHERE SCHEMA_NAME = ? LIMIT 1`,
          [tenantDb]
        );
        if (!dbExist || !dbExist[0]) {
          // DB doesn't exist locally — try all client DBs from auth_db.users
          const clientRows = await db.authQuery(
            `SELECT DISTINCT client FROM auth_db.users WHERE client IS NOT NULL AND client != '' LIMIT 20`,
            []
          );
          const clients = (clientRows || []).map(r => r.client).filter(c => c && c !== tenantDb);
          for (const client of clients) {
            try {
              const chk = await db.query(
                `SELECT TABLE_NAME FROM INFORMATION_SCHEMA.TABLES
                  WHERE TABLE_SCHEMA = ? AND TABLE_NAME IN ('positions','candidate_positions','position_candidates')
                  LIMIT 1`,
                [client]
              );
              if (chk && chk[0]) {
                console.log('[internal/report-data] tenant DB %s not found locally, auto-resolved to %s', tenantDb, client);
                tenantDb = client;
                break;
              }
            } catch (_) {}
          }
        }
      } catch (_) {}
    }

    // ── Position details ──────────────────────────────────────────────────────
    let positionDetails = { title: '', domainType: 'TECH', mandatorySkills: [], optionalSkills: [] };
    try {
      // Positions table: id is BINARY(16) in some DBs, varchar in others — try both
      const posRows = await db.query(
        `SELECT title, domain_type as domainType,
                minimum_experience as minExperience,
                maximum_experience as maxExperience,
                no_of_positions as numberOfOpenings
         FROM \`${tenantDb}\`.positions
         WHERE id = UNHEX(REPLACE(?,'-','')) OR BIN_TO_UUID(id) = ? OR BIN_TO_UUID(id,1) = ? LIMIT 1`,
        [positionId, positionId, positionId]
      );
      const pos = Array.isArray(posRows) && posRows[0] ? posRows[0] : null;
      if (pos) {
        positionDetails.title = pos.title || '';
        positionDetails.domainType = (pos.domainType || 'TECH').toUpperCase();
        positionDetails.minExperience = pos.minExperience;
        positionDetails.maxExperience = pos.maxExperience;
        positionDetails.numberOfOpenings = pos.numberOfOpenings;

        // Skills are in separate tables (position_mandatory_skills, position_optional_skills)
        try {
          const [mandRows] = await db.getPool().query(
            `SELECT skill FROM \`${tenantDb}\`.position_mandatory_skills
             WHERE position_id = UNHEX(REPLACE(?,'-','')) LIMIT 50`,
            [positionId]
          );
          positionDetails.mandatorySkills = (mandRows || []).map(r => r.skill || r.skill_name).filter(Boolean);
        } catch (_) {}

        try {
          const [optRows] = await db.getPool().query(
            `SELECT skill FROM \`${tenantDb}\`.position_optional_skills
             WHERE position_id = UNHEX(REPLACE(?,'-','')) LIMIT 50`,
            [positionId]
          );
          positionDetails.optionalSkills = (optRows || []).map(r => r.skill || r.skill_name).filter(Boolean);
        } catch (_) {}
      }
    } catch (posErr) {
      console.warn('[internal/report-data] position fetch failed:', posErr.message);
    }

    // ── JD and Resume text (from extract tables) ─────────────────────────────
    let jobDescriptionText = '';
    let resumeText = '';
    const dbsToTry = tenantDb === 'candidates_db' ? ['candidates_db'] : [tenantDb, 'candidates_db'];

    for (const db_ of dbsToTry) {
      if (jobDescriptionText) break;
      try {
        const jdRows = await db.query(
          `SELECT extracted_data FROM \`${db_}\`.jd_extract
           WHERE position_id = ? OR LOWER(REPLACE(position_id, '-', '')) = LOWER(REPLACE(?, '-', '')) LIMIT 1`,
          [positionId, positionId]
        );
        const jdRow = Array.isArray(jdRows) && jdRows[0] ? jdRows[0] : null;
        if (jdRow?.extracted_data) {
          const data = typeof jdRow.extracted_data === 'string'
            ? (() => { try { return JSON.parse(jdRow.extracted_data); } catch { return {}; } })()
            : jdRow.extracted_data;
          jobDescriptionText = data.text || (Array.isArray(data.keywords) ? data.keywords.join(', ') : '') || '';
        }
      } catch (_) {}
    }

    for (const db_ of dbsToTry) {
      if (resumeText) break;
      try {
        const resRows = await db.query(
          `SELECT extracted_data FROM \`${db_}\`.resume_extract
           WHERE (candidate_id = ? OR LOWER(REPLACE(candidate_id, '-', '')) = LOWER(REPLACE(?, '-', '')))
             AND (position_id = ? OR LOWER(REPLACE(position_id, '-', '')) = LOWER(REPLACE(?, '-', ''))) LIMIT 1`,
          [candidateId, candidateId, positionId, positionId]
        );
        const resRow = Array.isArray(resRows) && resRows[0] ? resRows[0] : null;
        if (resRow?.extracted_data) {
          const data = typeof resRow.extracted_data === 'string'
            ? (() => { try { return JSON.parse(resRow.extracted_data); } catch { return {}; } })()
            : resRow.extracted_data;
          resumeText = data.text || (Array.isArray(data.keywords) ? data.keywords.join(', ') : '') || '';
        }
      } catch (_) {}
    }

    // Fallback: try resume_extract without position filter if still empty
    if (!resumeText) {
      for (const db_ of dbsToTry) {
        if (resumeText) break;
        try {
          const resRows = await db.query(
            `SELECT extracted_data FROM \`${db_}\`.resume_extract
             WHERE (candidate_id = ? OR LOWER(REPLACE(candidate_id, '-', '')) = LOWER(REPLACE(?, '-', ''))) LIMIT 1`,
            [candidateId, candidateId]
          );
          const resRow = Array.isArray(resRows) && resRows[0] ? resRows[0] : null;
          if (resRow?.extracted_data) {
            const data = typeof resRow.extracted_data === 'string'
              ? (() => { try { return JSON.parse(resRow.extracted_data); } catch { return {}; } })()
              : resRow.extracted_data;
            resumeText = data.text || (Array.isArray(data.keywords) ? data.keywords.join(', ') : '') || '';
          }
        } catch (_) {}
      }
    }

    // ── Candidate/Profile metadata (best-effort) ─────────────────────────────
    let candidateProfile = {
      candidateCode: null, candidateName: null, email: null, phone: null,
      companyName: null, positionName: null, positionCode: null,
      questionSetCode: null, questionSetDuration: null, questionSetId: null,
      interviewDate: null, createdBy: null, resumeScore: null,
    };
    try {
      const posHex = String(positionId).replace(/-/g, '');
      const candHex = String(candidateId).replace(/-/g, '');

      // Detect which schema variant exists in tenant DB
      const tableCheck = await db.query(
        `SELECT TABLE_NAME FROM INFORMATION_SCHEMA.TABLES
          WHERE TABLE_SCHEMA = ? AND TABLE_NAME IN ('candidate_positions','position_candidates')
          LIMIT 2`,
        [tenantDb]
      );
      const existingTables = (tableCheck || []).map(t => t.TABLE_NAME);
      const usePosCand = existingTables.includes('position_candidates');
      const useCandPos = existingTables.includes('candidate_positions');

      let rawRow = null;

      // ── Schema A: candidate_positions (VARCHAR UUIDs — college schema) ───────
      if (useCandPos) {
        try {
          const rows = await db.query(
            `SELECT
                cp.candidate_code           as candidateCode,
                cp.candidate_name           as candidateName,
                cp.position_code            as positionCode,
                cp.job_title                as jobTitle,
                cp.resume_score             as resumeScore,
                cp.question_set_id          as questionSetId,
                cp.question_set_duration    as questionSetDuration,
                cp.created_at               as interviewDate,
                cp.interview_scheduled_by   as createdBy,
                COALESCE(p.title, cp.job_title) as positionName
              FROM \`${tenantDb}\`.candidate_positions cp
             LEFT JOIN \`${tenantDb}\`.positions p
               ON UPPER(REPLACE(BIN_TO_UUID(p.id,1),'-','')) = UPPER(REPLACE(cp.position_id,'-',''))
                OR UPPER(REPLACE(BIN_TO_UUID(p.id),'-','')) = UPPER(REPLACE(cp.position_id,'-',''))
                OR UPPER(REPLACE(p.id,'-','')) = UPPER(REPLACE(cp.position_id,'-',''))
             WHERE UPPER(REPLACE(cp.position_id,'-','')) = UPPER(REPLACE(?,'-',''))
               AND UPPER(REPLACE(cp.candidate_id,'-','')) = UPPER(REPLACE(?,'-',''))
             LIMIT 1`,
            [positionId, candidateId]
          );
          if (Array.isArray(rows) && rows[0]) rawRow = { ...rows[0], _schema: 'candidate_positions' };
        } catch (_) {}
      }

      // ── Schema B: position_candidates (BINARY(16) — ATS schema) ─────────────
      if (!rawRow && usePosCand && posHex.length === 32 && candHex.length === 32) {
        try {
          const rows = await db.query(
            `SELECT
                c.code               as candidateCode,
                c.name               as candidateName,
                c.email              as email,
                c.mobile_number      as phone,
                pc.resume_match_score as resumeScore,
                LOWER(BIN_TO_UUID(pc.question_set_id)) as questionSetId,
                pc.created_at        as interviewDate,
                LOWER(BIN_TO_UUID(pc.interview_scheduled_by)) as createdBy,
                p.title              as positionName,
                p.code               as positionCode
              FROM \`${tenantDb}\`.position_candidates pc
              JOIN \`${tenantDb}\`.candidates c ON c.id = pc.candidate_id
              LEFT JOIN \`${tenantDb}\`.positions p ON p.id = pc.position_id
             WHERE pc.position_id = UNHEX(?) AND pc.candidate_id = UNHEX(?)
             LIMIT 1`,
            [posHex, candHex]
          );
          if (Array.isArray(rows) && rows[0]) rawRow = { ...rows[0], _schema: 'position_candidates' };
        } catch (_) {}
      }

      if (rawRow) {
        const r = rawRow;
        // Resolve questionSetCode and duration from question_sets; fall back to row values if available
        let questionSetCode = null;
        let questionSetDuration = r.questionSetDuration || null;  // direct from candidate_positions
        try {
          const qsId = (r.questionSetId || '').replace(/-/g, '');
          if (qsId.length === 32) {
            const qsRows = await db.query(
              `SELECT question_set_code, total_duration FROM \`${tenantDb}\`.question_sets
               WHERE id = UNHEX(?) LIMIT 1`,
              [qsId]
            );
            if (qsRows && qsRows[0]) {
              questionSetCode = qsRows[0].question_set_code || null;
              questionSetDuration = qsRows[0].total_duration || questionSetDuration || null;
            }
          }
        } catch (_) {}

        // Enrich name/email/phone from college_candidates if not already populated
        let candidateName = r.candidateName || null;
        let email = r.email || null;
        let phone = r.phone || null;
        if (!email || !phone) {
          try {
            const ccRows = await db.query(
              `SELECT candidate_name, email, mobile_number
                 FROM candidates_db.college_candidates WHERE candidate_id = ? LIMIT 1`,
              [candidateId]
            );
            if (Array.isArray(ccRows) && ccRows[0]) {
              candidateName = candidateName || ccRows[0].candidate_name || null;
              email = email || ccRows[0].email || null;
              phone = phone || ccRows[0].mobile_number || null;
            }
          } catch (_) {}
        }

        candidateProfile = {
          candidateCode: r.candidateCode || null,
          candidateName,
          email,
          phone,
          companyName: null,
          positionName: r.positionName || null,
          positionCode: r.positionCode || null,
          resumeScore: r.resumeScore != null ? Number(r.resumeScore) : null,
          questionSetCode,
          questionSetDuration,
          questionSetId: r.questionSetId || null,
          interviewDate: r.interviewDate || null,
          createdBy: r.createdBy || null,
        };
        console.log('[internal/report-data] candidateProfile fetched from %s for candidate=%s', r._schema, candidateId);
      } else {
        // No row in tenant tables — fall back to candidates_db.college_candidates
        console.warn('[internal/report-data] no tenant row found for candidate=%s, trying college_candidates fallback', candidateId);
        try {
          const ccRows = await db.query(
            `SELECT candidate_code, candidate_name, email, mobile_number
               FROM candidates_db.college_candidates WHERE candidate_id = ? LIMIT 1`,
            [candidateId]
          );
          if (Array.isArray(ccRows) && ccRows[0]) {
            const cc = ccRows[0];
            candidateProfile.candidateCode = cc.candidate_code || null;
            candidateProfile.candidateName = cc.candidate_name || null;
            candidateProfile.email = cc.email || null;
            candidateProfile.phone = cc.mobile_number || null;
            console.log('[internal/report-data] candidateProfile enriched from college_candidates for candidate=%s', candidateId);
          }
        } catch (ccErr) {
          console.warn('[internal/report-data] college_candidates fallback failed:', ccErr.message);
        }
      }
    } catch (profileErr) {
      console.warn('[internal/report-data] candidate profile fetch failed:', profileErr.message);
    }

    // ── Assessment summary ────────────────────────────────────────────────────
    let assessmentSummary = null;
    try {
      assessmentSummary = await CandidateModel.getAssessmentSummary(candidateId, positionId, tenantDb, null, null);
    } catch (_) {}

    return res.status(200).json({
      success: true,
      positionDetails,
      candidateProfile,
      jobDescriptionText: jobDescriptionText || '',
      resumeText: resumeText || '',
      assessmentSummary: assessmentSummary || null,
    });
  } catch (err) {
    console.error('[internal/report-data] error:', err);
    return res.status(500).json({ success: false, message: err.message || 'Failed to get report data' });
  }
});

/**
 * POST /internal/report-generation-status
 * Body: { positionId, candidateId }
 * Returns current assessment_report_generation row status from candidates_db.
 */
router.post('/report-generation-status', async (req, res) => {
  try {
    const { positionId, candidateId } = req.body || {};
    if (!positionId || !candidateId) {
      return res.status(400).json({ success: false, message: 'positionId and candidateId are required' });
    }

    const posHex = String(positionId).replace(/-/g, '');
    const candHex = String(candidateId).replace(/-/g, '');

    const rows = await db.query(
      `SELECT is_generated AS isGenerated, created_at AS createdAt, updated_at AS updatedAt
         FROM \`candidates_db\`.assessment_report_generation
        WHERE candidate_id = UNHEX(?) AND position_id = UNHEX(?)
        ORDER BY updated_at DESC
        LIMIT 1`,
      [candHex, posHex]
    );

    const row = Array.isArray(rows) && rows[0] ? rows[0] : null;
    return res.status(200).json({
      success: true,
      data: {
        exists: !!row,
        isGenerated: !!(row && Number(row.isGenerated) === 1),
        createdAt: row?.createdAt || null,
        updatedAt: row?.updatedAt || null,
      },
    });
  } catch (err) {
    console.error('[report-generation-status] error:', err);
    return res.status(500).json({ success: false, message: err.message || 'Failed to fetch report generation status' });
  }
});

/**
 * POST /internal/mark-report-generated
 * Body: { positionId, candidateId, tenantId, scores: { totalScore, generalScore, positionScore, codingScore, aptitudeScore, recommendationStatus, softSkills } }
 * Updates assessment_report_generation.is_generated = 1 and interview_evaluations with computed scores.
 * Called by Streaming AI report_generator.py after saving report to MongoDB.
 */
router.post('/mark-report-generated', async (req, res) => {
  try {
    const { positionId, candidateId, tenantId, scores = {} } = req.body || {};
    if (!positionId || !candidateId) {
      return res.status(400).json({ success: false, message: 'positionId and candidateId are required' });
    }
    const tenantDb = tenantId || 'candidates_db';
    const posHex = positionId.replace(/-/g, '');
    const candHex = candidateId.replace(/-/g, '');

    // ── Upsert assessment_report_generation — single atomic INSERT ... ON DUPLICATE KEY UPDATE
    // The UNIQUE KEY uk_arg_candidate_position(candidate_id, position_id) prevents duplicates.
    try {
      await db.query(
        `INSERT INTO \`candidates_db\`.assessment_report_generation
             (id, candidate_id, position_id, is_generated, created_at, updated_at)
           VALUES (UNHEX(REPLACE(UUID(),'-','')), UNHEX(?), UNHEX(?), 1, NOW(6), NOW(6))
           ON DUPLICATE KEY UPDATE
             is_generated = 1,
             updated_at   = NOW(6)`,
        [candHex, posHex]
      );
      console.log('[mark-report-generated] assessment_report_generation upserted for candidate=%s', candidateId);
    } catch (argErr) {
      console.warn('[mark-report-generated] assessment_report_generation upsert failed:', argErr.message);
    }

    // ── Update assessments_summary.is_report_generated ────────────────────────
    try {
      await CandidateModel.updateAssessmentSummary(
        candidateId, positionId, { isReportGenerated: true }, tenantDb, null
      );
    } catch (_) {}

    // ── Update interview_evaluations in tenant DB ──────────────────────────────
    if (tenantDb && tenantDb !== 'candidates_db' && candHex.length === 32 && posHex.length === 32) {
      try {
        const {
          totalScore = 0,
          generalScore = null,
          positionScore = null,
          codingScore = null,
          aptitudeScore = null,
          recommendationStatus = 'NOT_RECOMMENDED',
          softSkillsFluency = null,
          softSkillsGrammar = null,
          softSkillsConfidence = null,
          softSkillsClarity = null,
        } = scores;

        // INSERT new row or UPDATE existing row (unique key: position_id + candidate_id)
        const newEvalId = require('crypto').randomBytes(16).toString('hex').toUpperCase();
        await db.query(
          `INSERT INTO \`${tenantDb}\`.interview_evaluations
             (id, position_id, candidate_id, total_score, section_scores_general,
              section_scores_position_specific, section_scores_coding, section_scores_aptitude,
              recommendation_status, soft_skills_fluency, soft_skills_grammar,
              soft_skills_confidence, soft_skills_clarity, report_generated, created_at, updated_at)
           VALUES (UNHEX(?), UNHEX(?), UNHEX(?), ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, TRUE, NOW(), NOW())
           ON DUPLICATE KEY UPDATE
             total_score                    = VALUES(total_score),
             section_scores_general         = VALUES(section_scores_general),
             section_scores_position_specific = VALUES(section_scores_position_specific),
             section_scores_coding          = VALUES(section_scores_coding),
             section_scores_aptitude        = VALUES(section_scores_aptitude),
             recommendation_status          = VALUES(recommendation_status),
             soft_skills_fluency            = VALUES(soft_skills_fluency),
             soft_skills_grammar            = VALUES(soft_skills_grammar),
             soft_skills_confidence         = VALUES(soft_skills_confidence),
             soft_skills_clarity            = VALUES(soft_skills_clarity),
             report_generated               = TRUE,
             updated_at                     = NOW()`,
          [newEvalId, posHex, candHex, totalScore, generalScore, positionScore, codingScore, aptitudeScore,
           recommendationStatus, softSkillsFluency, softSkillsGrammar, softSkillsConfidence, softSkillsClarity]
        );
        console.log('[mark-report-generated] interview_evaluations upserted: total=%s rec=%s', totalScore, recommendationStatus);
      } catch (ieErr) {
        console.warn('[mark-report-generated] interview_evaluations update skipped:', ieErr.message);
      }
    }

    // ── Update candidate status to TEST_COMPLETED in tenant DB ────────────────
    // Keep both schema variants in sync: candidate_positions and position_candidates.
    if (tenantDb && tenantDb !== 'candidates_db' && candHex.length === 32 && posHex.length === 32) {
      try {
        const existingTables = await db.query(
          `SELECT TABLE_NAME
             FROM INFORMATION_SCHEMA.TABLES
            WHERE TABLE_SCHEMA = ?
              AND TABLE_NAME IN ('candidate_positions', 'position_candidates')`,
          [tenantDb]
        );
        const tableNames = (existingTables || []).map((t) => t.TABLE_NAME);

        if (tableNames.includes('candidate_positions')) {
          await db.query(
            `UPDATE \`${tenantDb}\`.candidate_positions
                SET recommendation_status = 'TEST_COMPLETED',
                    status = 'TEST_COMPLETED',
                    updated_at = NOW()
              WHERE position_id = UNHEX(?) AND candidate_id = UNHEX(?)`,
            [posHex, candHex]
          );
        }

        if (tableNames.includes('position_candidates')) {
          await db.query(
            `UPDATE \`${tenantDb}\`.position_candidates
                SET recommendation = 'TEST_COMPLETED',
                    updated_at = NOW()
              WHERE position_id = UNHEX(?) AND candidate_id = UNHEX(?)`,
            [posHex, candHex]
          );
        }
      } catch (statusErr) {
        console.warn('[mark-report-generated] candidate status update skipped:', statusErr.message);
      }
    }

    return res.status(200).json({ success: true, message: 'Report marked as generated' });
  } catch (err) {
    console.error('[mark-report-generated] error:', err);
    return res.status(500).json({ success: false, message: err.message || 'Failed to mark report generated' });
  }
});

/**
 * PATCH /internal/complete-interview
 * Body: { positionId, candidateId, tenantId }
 * Sets interview_completed_at = NOW() in candidate_positions (and position_candidates).
 * Called by Streaming AI WebSocket when all assigned rounds are complete (test_complete event).
 */
router.patch('/complete-interview', async (req, res) => {
  try {
    const { positionId, candidateId, tenantId } = req.body || {};
    if (!positionId || !candidateId) {
      return res.status(400).json({ success: false, message: 'positionId and candidateId are required' });
    }
    const posHex = String(positionId).replace(/-/g, '');
    const candHex = String(candidateId).replace(/-/g, '');
    if (posHex.length !== 32 || candHex.length !== 32) {
      return res.status(400).json({ success: false, message: 'Invalid positionId or candidateId format' });
    }
    const tenantDb = (tenantId || '').toString().trim();
    if (!tenantDb) {
      return res.status(400).json({ success: false, message: 'tenantId is required' });
    }

    let cpUpdated = 0;
    let pcUpdated = 0;

    // ── candidate_positions (VARCHAR UUID schema) ────────────────────────────
    try {
      const cpResult = await db.query(
        `UPDATE \`${tenantDb}\`.candidate_positions
            SET interview_completed_at = NOW(),
                updated_at = NOW()
          WHERE UPPER(REPLACE(position_id, '-', '')) = UPPER(?)
            AND UPPER(REPLACE(candidate_id, '-', '')) = UPPER(?)`,
        [posHex, candHex]
      );
      cpUpdated = cpResult?.affectedRows ?? 0;
      console.log('[complete-interview] candidate_positions updated:', cpUpdated);
    } catch (e) {
      console.warn('[complete-interview] candidate_positions update skipped:', e.message);
    }

    // ── position_candidates (BINARY(16) schema) ──────────────────────────────
    try {
      const pcResult = await db.query(
        `UPDATE \`${tenantDb}\`.position_candidates
            SET interview_completed_at = NOW(),
                updated_at = NOW()
          WHERE position_id = UNHEX(?) AND candidate_id = UNHEX(?)`,
        [posHex, candHex]
      );
      pcUpdated = pcResult?.affectedRows ?? 0;
      console.log('[complete-interview] position_candidates updated:', pcUpdated);
    } catch (e) {
      console.warn('[complete-interview] position_candidates update skipped:', e.message);
    }

    return res.status(200).json({
      success: true,
      message: 'interview_completed_at updated',
      candidatePositionsUpdated: cpUpdated,
      positionCandidatesUpdated: pcUpdated,
    });
  } catch (err) {
    console.error('[complete-interview] error:', err);
    return res.status(500).json({ success: false, message: err.message || 'Failed to update interview_completed_at' });
  }
});

/**
 * POST /internal/mark-all-test-completed
 * Body (optional): { tenantId }
 * - If tenantId is passed, updates only that tenant DB
 * - Else updates all tenant DBs from auth_db.users.client
 */
router.post('/mark-all-test-completed', async (req, res) => {
  try {
    const tenantId = ((req.body || {}).tenantId || '').toString().trim();

    let tenantDbs = [];
    if (tenantId) {
      tenantDbs = [tenantId];
    } else {
      const rows = await db.authQuery(
        `SELECT DISTINCT client AS tenantDb
           FROM auth_db.users
          WHERE is_admin = 1
            AND client IS NOT NULL
            AND TRIM(client) <> ''`,
        []
      );
      tenantDbs = (rows || []).map((r) => (r.tenantDb || '').toString().trim()).filter(Boolean);
    }

    const summary = {
      tenantsProcessed: 0,
      candidatePositionsUpdated: 0,
      positionCandidatesUpdated: 0,
      skipped: [],
      errors: [],
    };

    for (const tenantDb of tenantDbs) {
      try {
        const tables = await db.query(
          `SELECT TABLE_NAME
             FROM INFORMATION_SCHEMA.TABLES
            WHERE TABLE_SCHEMA = ?
              AND TABLE_NAME IN ('candidate_positions', 'position_candidates')`,
          [tenantDb]
        );
        const tableNames = (tables || []).map((t) => t.TABLE_NAME);
        summary.tenantsProcessed += 1;

        if (!tableNames.includes('candidate_positions') && !tableNames.includes('position_candidates')) {
          summary.skipped.push({ tenantDb, reason: 'No candidate_positions or position_candidates table' });
          continue;
        }

        if (tableNames.includes('candidate_positions')) {
          const cpRes = await db.query(
            `UPDATE \`${tenantDb}\`.candidate_positions
                SET recommendation_status = 'TEST_COMPLETED',
                    status = 'TEST_COMPLETED',
                    updated_at = NOW()
              WHERE recommendation_status <> 'TEST_COMPLETED' OR status <> 'TEST_COMPLETED'`,
            []
          );
          summary.candidatePositionsUpdated += Number(cpRes?.affectedRows || 0);
        }

        if (tableNames.includes('position_candidates')) {
          const pcRes = await db.query(
            `UPDATE \`${tenantDb}\`.position_candidates
                SET recommendation = 'TEST_COMPLETED',
                    updated_at = NOW()
              WHERE recommendation <> 'TEST_COMPLETED' OR recommendation IS NULL`,
            []
          );
          summary.positionCandidatesUpdated += Number(pcRes?.affectedRows || 0);
        }
      } catch (tenantErr) {
        summary.errors.push({ tenantDb, message: tenantErr.message || String(tenantErr) });
      }
    }

    return res.status(200).json({
      success: true,
      message: 'Bulk candidate status update to TEST_COMPLETED completed',
      data: summary,
    });
  } catch (err) {
    console.error('[mark-all-test-completed] error:', err);
    return res.status(500).json({ success: false, message: err.message || 'Failed to bulk update statuses' });
  }
});

module.exports = router;
