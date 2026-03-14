/**
 * Public routes for candidate test entry: verify email + OTP against private_link.
 * No auth required (candidate enters from test link).
 */
const express = require('express');
const router = express.Router();
const config = require('../config');
const db = require('../config/db');
const CandidateModel = require('../models/candidateModel');
const interviewInstructionsService = require('../services/interviewInstructionsService');
const adminService = require('../services/adminService');
const questionSectionService = require('../services/questionSectionService');

const assessmentSummaryDb = () => (config.database && config.database.name) || process.env.DB_NAME || 'candidates_db';

/** Normalize assessment summary for verify response (id as UUID, dates as strings). */
function toCleanSummary(summary) {
  if (!summary || typeof summary !== 'object') return summary;
  const hexToUuid = (val) => {
    if (val == null) return null;
    const s = (typeof val === 'string' ? val : (Buffer.isBuffer(val) ? val.toString('hex') : String(val))).replace(/-/g, '').toLowerCase();
    return s.length === 32 ? [s.slice(0, 8), s.slice(8, 12), s.slice(12, 16), s.slice(16, 20), s.slice(20)].join('-') : val;
  };
  const toDateStr = (v) => (v ? (v instanceof Date ? v.toISOString().slice(0, 19).replace('T', ' ') : String(v).slice(0, 19).replace('T', ' ')) : null);
  // Buffer.isBuffer guard: MySQL BIT/TINYINT columns arrive as Buffer objects in mysql2.
  // Boolean(Buffer.from([0])) === true (wrong!). Must read the byte value instead.
  const toBool = (v) => (Buffer.isBuffer(v) ? v[0] !== 0 : Boolean(v));
  return {
    id: hexToUuid(summary.id),
    positionId: hexToUuid(summary.positionId),
    candidateId: hexToUuid(summary.candidateId),
    questionId: hexToUuid(summary.questionId),
    totalRoundsAssigned: Number(summary.totalRoundsAssigned) || 0,
    totalRoundsCompleted: Number(summary.totalRoundsCompleted) || 0,
    totalInterviewTime: summary.totalInterviewTime ?? null,
    totalCompletionTime: summary.totalCompletionTime ?? null,
    assessmentStartTime: summary.assessmentStartTime ?? summary.assessment_start_time ?? null,
    assessmentEndTime: summary.assessmentEndTime ?? summary.assessment_end_time ?? null,
    round1Assigned: toBool(summary.round1Assigned),
    round1Completed: toBool(summary.round1Completed),
    round1TimeTaken: summary.round1TimeTaken ?? summary.round1_time_taken ?? null,
    round1StartTime: summary.round1StartTime ?? summary.round1_start_time ?? null,
    round1EndTime: summary.round1EndTime ?? summary.round1_end_time ?? null,
    round2Assigned: toBool(summary.round2Assigned),
    round2Completed: toBool(summary.round2Completed),
    round2TimeTaken: summary.round2TimeTaken ?? summary.round2_time_taken ?? null,
    round2StartTime: summary.round2StartTime ?? null,
    round2EndTime: summary.round2EndTime ?? null,
    round3Assigned: toBool(summary.round3Assigned),
    round3Completed: toBool(summary.round3Completed),
    round3TimeTaken: summary.round3TimeTaken ?? null,
    round3StartTime: summary.round3StartTime ?? null,
    round3EndTime: summary.round3EndTime ?? null,
    round4Assigned: toBool(summary.round4Assigned),
    round4Completed: toBool(summary.round4Completed),
    round4TimeTaken: summary.round4TimeTaken ?? null,
    round4StartTime: summary.round4StartTime ?? null,
    round4EndTime: summary.round4EndTime ?? null,
    isAssessmentCompleted: toBool(summary.isAssessmentCompleted),
    isReportGenerated: toBool(summary.isReportGenerated),
    round1AssignedTime: summary.round1GivenTime ?? null,
    round2AssignedTime: summary.round2GivenTime ?? null,
    round3AssignedTime: summary.round3GivenTime ?? null,
    round4AssignedTime: summary.round4GivenTime ?? null,
    createdAt: toDateStr(summary.createdAt),
    updatedAt: toDateStr(summary.updatedAt),
  };
}

/**
 * GET /private-links/verify/by/email-and-code
 * Returns link + instructions + assessmentSummary + isConversational so frontend can show rounds and pass conversational flag to WS.
 */
router.get('/verify/by/email-and-code', async (req, res) => {
  const email = (req.query.email || '').toString().trim();
  const verificationCode = (req.query.verificationCode || req.query.otp || '').toString().trim();
  if (!email || !verificationCode) {
    return res.status(400).json({
      success: false,
      message: 'email and verificationCode (OTP) are required',
    });
  }
  try {
    const link = await CandidateModel.getLinkByEmailAndCode(email, verificationCode);
    if (!link) {
      return res.status(404).json({
        success: false,
        message: 'Invalid email or OTP, or link expired.',
      });
    }
    let instructions = '';
    let instructionsData = [];
    if (link.tenantId && link.questionSetId) {
      try {
        const rows = await interviewInstructionsService.getInstructionsByQuestionSetId(link.tenantId, link.questionSetId, null);
        if (rows && rows.length > 0) {
          instructionsData = rows;
          instructions = rows[0].content || '';
        }
      } catch (e) {
        console.warn('Verify: instructions fetch failed', e.message);
      }
    }
    const dbForSummary = link.tenantId || 'candidates_db';
    let assessmentSummary = await CandidateModel.getAssessmentSummary(
      link.candidateId,
      link.positionId,
      dbForSummary,
      link.questionSetId,
      null
    );
    if (assessmentSummary) {
      assessmentSummary = toCleanSummary(assessmentSummary);
    } else if (link.candidateId && link.positionId && link.questionSetId && link.tenantId) {
      // No summary found: create one (same as manual-invite) so candidate can take the test instead of being sent to completion
      try {
        let round1Assigned = false, round2Assigned = false, round3Assigned = false, round4Assigned = false;
        let totalDuration = '0';
        const sections = await questionSectionService.getQuestionSectionsByQuestionSetId(link.tenantId, link.questionSetId, null);
        const section = Array.isArray(sections) && sections.length > 0 ? sections[0] : null;
        if (section) {
          const genList = (section.generalQuestions || {}).questions || [];
          const posList = (section.positionSpecificQuestions || {}).questions || [];
          const codingList = section.codingQuestions || [];
          const aptitudeList = section.aptitudeQuestions || [];
          round1Assigned = genList.length > 0;
          round2Assigned = posList.length > 0;
          round3Assigned = Array.isArray(codingList) && codingList.length > 0;
          round4Assigned = Array.isArray(aptitudeList) && aptitudeList.length > 0;
          if (section.totalDuration) totalDuration = section.totalDuration;
        } else {
          round1Assigned = true;
        }
        const totalRounds = [round1Assigned, round2Assigned, round3Assigned, round4Assigned].filter(Boolean).length;
        const summaryDb = assessmentSummaryDb();
        await CandidateModel.createAssessmentSummary({
          positionId: link.positionId,
          candidateId: link.candidateId,
          questionId: link.questionSetId,
          totalRoundsAssigned: totalRounds || 1,
          totalRoundsCompleted: 0,
          round1Assigned, round1Completed: false,
          round2Assigned, round2Completed: false,
          round3Assigned, round3Completed: false,
          round4Assigned, round4Completed: false,
          isAssessmentCompleted: false,
          isReportGenerated: false,
          totalInterviewTime: totalDuration,
        }, summaryDb);
        assessmentSummary = await CandidateModel.getAssessmentSummary(link.candidateId, link.positionId, summaryDb);
        if (assessmentSummary) assessmentSummary = toCleanSummary(assessmentSummary);
      } catch (createErr) {
        console.warn('Verify: create assessment summary failed', createErr.message);
      }
    }
    // Interview mode (conversational vs non-conversational) from question set in tenant DB; fallback to link if present
    let isConversational = link.isConversational != null ? Boolean(link.isConversational) : (link.is_conversational != null ? Boolean(link.is_conversational) : false);
    if (link.tenantId && link.questionSetId) {
      try {
        const qsIdHex = String(link.questionSetId).replace(/-/g, '');
        if (qsIdHex.length === 32) {
          const qsRows = await db.query(
            `SELECT interview_mode FROM \`${link.tenantId}\`.question_sets WHERE id = UNHEX(?) LIMIT 1`,
            [qsIdHex]
          );
          if (qsRows && qsRows[0] && String(qsRows[0].interview_mode || '').toUpperCase() === 'CONVERSATIONAL') {
            isConversational = true;
          }
        }
      } catch (e) {
        console.warn('Verify: question set interview_mode fetch failed', e.message);
      }
    }
    let crossQuestionCountGeneral = 2;
    let crossQuestionCountPosition = 2;
    if (link.tenantId && link.clientId) {
      try {
        const crossSettings = await adminService.getCrossQuestionSettings(link.tenantId, link.clientId);
        crossQuestionCountGeneral = crossSettings.crossQuestionCountGeneral ?? 2;
        crossQuestionCountPosition = crossSettings.crossQuestionCountPosition ?? 2;
      } catch (e) {
        console.warn('Verify: cross-question settings fetch failed', e.message);
      }
    }
    // Always fetch question section so candidate test portal knows all coding/aptitude/general question configs
    let questionSectionData = null;
    if (link.tenantId && link.questionSetId) {
      try {
        const sections = await questionSectionService.getQuestionSectionsByQuestionSetId(link.tenantId, link.questionSetId, null);
        questionSectionData = (Array.isArray(sections) && sections.length > 0) ? sections[0] : null;
      } catch (e) {
        console.warn('Verify: question section fetch failed', e.message);
      }
    }
    return res.status(200).json({
      ...link,
      instructions,
      instructionsData,
      assessmentSummary: assessmentSummary || null,
      isConversational,
      crossQuestionCountGeneral,
      crossQuestionCountPosition,
      questionSectionData,
    });
  } catch (err) {
    console.error('private-links verify error:', err);
    return res.status(500).json({
      success: false,
      message: err.message || 'Verification failed',
    });
  }
});

/**
 * PUT /private-links/update-interview-status?positionId=...&candidateId=...
 * Sets interview_taken = 1 for the private_link (candidate test flow). No auth.
 */
router.put('/update-interview-status', (req, res, next) => {
  if (req.body === undefined || req.body === null) req.body = {};
  next();
}, async (req, res) => {
  const positionId = (req.query.positionId || '').toString().trim();
  const candidateId = (req.query.candidateId || '').toString().trim();
  const questionSetId = (req.query.questionSetId || req.body?.questionSetId || '').toString().trim();
  if (!positionId || !candidateId) {
    return res.status(400).json({ success: false, message: 'positionId and candidateId are required' });
  }
  try {
    const affected = await CandidateModel.updateInterviewStatus(positionId, candidateId, 'candidates_db', questionSetId || null);
    return res.status(200).json({ success: true, updated: affected > 0 });
  } catch (err) {
    console.error('update-interview-status error:', err);
    return res.status(500).json({ success: false, message: err.message || 'Update failed' });
  }
});

/**
 * PUT /private-links/set-test-started?positionId=...&candidateId=...&tenantId=...
 * Sets candidate position status to TEST_STARTED when candidate starts the test (after email/OTP verified).
 * tenantId (or X-Tenant-Id header) = tenant DB name for candidate_positions. No auth.
 */
router.put('/set-test-started', async (req, res) => {
  const positionId = (req.query.positionId || req.body?.positionId || '').toString().trim();
  const candidateId = (req.query.candidateId || req.body?.candidateId || '').toString().trim();
  const questionSetId = (req.query.questionSetId || req.body?.questionSetId || '').toString().trim();
  const assessmentSummaryId = (req.query.assessmentSummaryId || req.body?.assessmentSummaryId || '').toString().trim();
  const tenantId = (req.query.tenantId || req.body?.tenantId || req.headers['x-tenant-id'] || '').toString().trim();
  if (!positionId || !candidateId) {
    return res.status(400).json({ success: false, message: 'positionId and candidateId are required' });
  }
  try {
    const tenantDb = tenantId || 'candidates_db';
    const affected = await CandidateModel.updatePositionCandidateStatus(positionId, candidateId, 'TEST_STARTED', tenantDb, {
      questionSetId: questionSetId || null,
      assessmentSummaryId: assessmentSummaryId || null,
    });

    // ── Insert into assessment_report_generation (candidates_db) ─────────────
    // IGNORE if already exists (unique on candidate+position via PK check)
    const posHex = positionId.replace(/-/g, '');
    const candHex = candidateId.replace(/-/g, '');
    try {
      const newId = require('crypto').randomBytes(16).toString('hex');
      await db.query(
        `INSERT IGNORE INTO \`candidates_db\`.assessment_report_generation
           (id, candidate_id, position_id, is_generated, created_at, updated_at)
         VALUES (UNHEX(?), UNHEX(?), UNHEX(?), 0, NOW(6), NOW(6))`,
        [newId, candHex, posHex]
      );
    } catch (argErr) {
      console.warn('[set-test-started] assessment_report_generation insert skipped:', argErr.message);
    }

    // ── Insert blank row into interview_evaluations (tenant DB) ──────────────
    // Uses UNIQUE KEY uk_interview_position_candidate so INSERT IGNORE is safe
    if (tenantDb && tenantDb !== 'candidates_db') {
      try {
        const evalId = require('crypto').randomBytes(16).toString('hex');
        await db.query(
          `INSERT IGNORE INTO \`${tenantDb}\`.interview_evaluations
             (id, position_id, candidate_id, report_generated, created_at, updated_at)
           VALUES (UNHEX(?), UNHEX(?), UNHEX(?), FALSE, NOW(), NOW())`,
          [evalId, posHex, candHex]
        );
      } catch (ieErr) {
        console.warn('[set-test-started] interview_evaluations insert skipped:', ieErr.message);
      }
    }

    return res.status(200).json({ success: true, updated: affected > 0 });
  } catch (err) {
    console.error('set-test-started error:', err);
    return res.status(500).json({ success: false, message: err.message || 'Update failed' });
  }
});

module.exports = router;
