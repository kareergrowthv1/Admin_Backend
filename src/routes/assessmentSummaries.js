/**
 * Assessment summaries under /candidates/assessment-summaries (AdminBackend).
 * GET, POST, PATCH using CandidateModel. assessments_summary table lives in candidates_db
 * (shared), not in tenant DB; tenant is used only for round times from question sections.
 */
const express = require('express');
const router = express.Router();
const config = require('../config');
const db = require('../config/db');
const authMiddleware = require('../middlewares/auth.middleware');
const tenantMiddleware = require('../middlewares/tenant.middleware');
const CandidateModel = require('../models/candidateModel');
const questionSectionService = require('../services/questionSectionService');

/** DB where assessments_summary table exists. Always use candidates_db (shared); do not use tenant DB. */
function getAssessmentSummaryDb() {
  return 'candidates_db';
}

function toCleanAssessmentData(raw) {
  if (!raw || typeof raw !== 'object') return raw;
  const hexToUuid = (val) => {
    if (val == null) return null;
    const s = (typeof val === 'string' ? val : (Buffer.isBuffer(val) ? val.toString('hex') : String(val))).replace(/-/g, '').toLowerCase();
    return s.length === 32 ? [s.slice(0, 8), s.slice(8, 12), s.slice(12, 16), s.slice(16, 20), s.slice(20)].join('-') : val;
  };
  const toBool = (v) => (Buffer.isBuffer(v) ? v[0] === 1 : Boolean(v));
  const toDateStr = (v) => (v ? (v instanceof Date ? v.toISOString().slice(0, 19).replace('T', ' ') : String(v).slice(0, 19).replace('T', ' ')) : null);
  return {
    id: hexToUuid(raw.id),
    positionId: hexToUuid(raw.positionId),
    candidateId: hexToUuid(raw.candidateId),
    questionId: hexToUuid(raw.questionId),
    totalRoundsAssigned: Number(raw.totalRoundsAssigned) || 0,
    totalRoundsCompleted: Number(raw.totalRoundsCompleted) || 0,
    totalInterviewTime: raw.totalInterviewTime ?? null,
    totalCompletionTime: raw.totalCompletionTime ?? null,
    assessmentStartTime: raw.assessmentStartTime ?? raw.assessment_start_time ?? null,
    assessmentEndTime: raw.assessmentEndTime ?? raw.assessment_end_time ?? null,
    round1Assigned: toBool(raw.round1Assigned),
    round1Completed: toBool(raw.round1Completed),
    round1TimeTaken: raw.round1TimeTaken ?? raw.round1_time_taken ?? null,
    round1StartTime: raw.round1StartTime ?? raw.round1_start_time ?? null,
    round1EndTime: raw.round1EndTime ?? raw.round1_end_time ?? null,
    round2Assigned: toBool(raw.round2Assigned),
    round2Completed: toBool(raw.round2Completed),
    round2TimeTaken: raw.round2TimeTaken ?? null,
    round2StartTime: raw.round2StartTime ?? null,
    round2EndTime: raw.round2EndTime ?? null,
    round3Assigned: toBool(raw.round3Assigned),
    round3Completed: toBool(raw.round3Completed),
    round3TimeTaken: raw.round3TimeTaken ?? null,
    round3StartTime: raw.round3StartTime ?? null,
    round3EndTime: raw.round3EndTime ?? null,
    round4Assigned: toBool(raw.round4Assigned),
    round4Completed: toBool(raw.round4Completed),
    round4TimeTaken: raw.round4TimeTaken ?? null,
    round4StartTime: raw.round4StartTime ?? null,
    round4EndTime: raw.round4EndTime ?? null,
    round1AssignedTime: raw.round1GivenTime ?? null,
    round2AssignedTime: raw.round2GivenTime ?? null,
    round3AssignedTime: raw.round3GivenTime ?? null,
    round4AssignedTime: raw.round4GivenTime ?? null,
    isAssessmentCompleted: toBool(raw.isAssessmentCompleted),
    isReportGenerated: toBool(raw.isReportGenerated),
    createdAt: toDateStr(raw.createdAt) ?? raw.createdAt,
    updatedAt: toDateStr(raw.updatedAt) ?? raw.updatedAt
  };
}

/**
 * GET /candidates/assessment-summaries?candidateId=...&positionId=...
 */
router.get('/', tenantMiddleware, async (req, res) => {
  try {
    const { candidateId, positionId } = req.query;
    if (!candidateId || !positionId) {
      return res.status(400).json({ success: false, message: 'candidateId and positionId are required' });
    }
    const summaryDb = getAssessmentSummaryDb();
    let result = await CandidateModel.getAssessmentSummary(candidateId, positionId, summaryDb);
    if (result && req.tenantDb && result.questionId && (result.round1GivenTime == null && result.round2GivenTime == null && result.round3GivenTime == null && result.round4GivenTime == null)) {
      try {
        const roundTimes = await questionSectionService.getRoundGivenTimesForQuestionSet(req.tenantDb, result.questionId, req.user?.id);
        result = { ...result, ...roundTimes };
      } catch (_) {}
    }
    if (!result) {
      return res.status(200).json({
        success: true,
        message: 'No assessment summary yet; returning defaults',
        data: toCleanAssessmentData({
          id: null, candidateId, positionId, questionId: null,
          totalRoundsAssigned: 0, totalRoundsCompleted: 0, totalInterviewTime: null,
          round1Assigned: false, round1Completed: false, round1StartTime: null, round1EndTime: null, round1TimeTaken: null, round1GivenTime: null,
          round2Assigned: false, round2Completed: false, round2StartTime: null, round2EndTime: null, round2TimeTaken: null, round2GivenTime: null,
          round3Assigned: false, round3Completed: false, round3StartTime: null, round3EndTime: null, round3TimeTaken: null, round3GivenTime: null,
          round4Assigned: false, round4Completed: false, round4StartTime: null, round4EndTime: null, round4TimeTaken: null, round4GivenTime: null,
          isAssessmentCompleted: false, isReportGenerated: false
        })
      });
    }
    return res.status(200).json({
      success: true,
      message: 'Assessment summary retrieved successfully',
      data: toCleanAssessmentData(result)
    });
  } catch (error) {
    console.error('Error fetching assessment summary:', error);
    return res.status(500).json({ success: false, message: error.message });
  }
});

/**
 * POST /candidates/assessment-summaries
 */
router.post('/', tenantMiddleware, authMiddleware, async (req, res) => {
  try {
    const {
      positionId, candidateId, questionId,
      totalRoundsAssigned, totalRoundsCompleted,
      round1Assigned, round1Completed, round2Assigned, round2Completed,
      round3Assigned, round3Completed, round4Assigned, round4Completed,
      isAssessmentCompleted, isReportGenerated, totalInterviewTime,
      round1GivenTime, round2GivenTime, round3GivenTime, round4GivenTime
    } = req.body;
    if (!positionId || !candidateId || !questionId) {
      return res.status(400).json({ success: false, message: 'positionId, candidateId, and questionId are required' });
    }
    let round1 = round1GivenTime ?? null, round2 = round2GivenTime ?? null, round3 = round3GivenTime ?? null, round4 = round4GivenTime ?? null;
    if ((round1 == null || round2 == null || round3 == null || round4 == null) && req.tenantDb) {
      try {
        const roundTimes = await questionSectionService.getRoundGivenTimesForQuestionSet(req.tenantDb, questionId, req.user?.id);
        if (roundTimes.round1GivenTime != null) round1 = roundTimes.round1GivenTime;
        if (roundTimes.round2GivenTime != null) round2 = roundTimes.round2GivenTime;
        if (roundTimes.round3GivenTime != null) round3 = roundTimes.round3GivenTime;
        if (roundTimes.round4GivenTime != null) round4 = roundTimes.round4GivenTime;
      } catch (_) {}
    }
    const summaryData = {
      positionId, candidateId, questionId,
      totalRoundsAssigned: totalRoundsAssigned ?? 4,
      totalRoundsCompleted: totalRoundsCompleted ?? 0,
      round1Assigned: round1Assigned ?? false, round1Completed: round1Completed ?? false,
      round2Assigned: round2Assigned ?? false, round2Completed: round2Completed ?? false,
      round3Assigned: round3Assigned ?? false, round3Completed: round3Completed ?? false,
      round4Assigned: round4Assigned ?? false, round4Completed: round4Completed ?? false,
      isAssessmentCompleted: isAssessmentCompleted ?? false,
      isReportGenerated: isReportGenerated ?? false,
      totalInterviewTime: totalInterviewTime ?? '0',
      round1GivenTime: round1, round2GivenTime: round2, round3GivenTime: round3, round4GivenTime: round4
    };
    const db = getAssessmentSummaryDb();
    const result = await CandidateModel.createAssessmentSummary(summaryData, db);
    return res.status(201).json({
      success: true,
      message: 'Assessment summary created successfully',
      data: toCleanAssessmentData(result)
    });
  } catch (error) {
    console.error('Error creating assessment summary:', error);
    return res.status(500).json({ success: false, message: error.sqlMessage || error.message || 'Failed to create assessment summary' });
  }
});

/**
 * PATCH /candidates/assessment-summaries
 * Body: candidateId, positionId, and any of assessmentStartTime, round1StartTime, round1EndTime, round1TimeTaken, round1Completed, ...
 */
router.patch('/', tenantMiddleware, async (req, res) => {
  try {
    const { candidateId, positionId, assessmentSummaryId, ...rest } = req.body || {};
    if (!candidateId || !positionId) {
      return res.status(400).json({ success: false, message: 'candidateId and positionId are required' });
    }
    const db = getAssessmentSummaryDb();
    const result = await CandidateModel.updateAssessmentSummary(candidateId, positionId, rest, db, assessmentSummaryId || null);
    if (!result) return res.status(404).json({ success: false, message: 'Assessment summary not found' });
    return res.status(200).json({
      success: true,
      message: 'Assessment summary updated successfully',
      data: toCleanAssessmentData(result)
    });
  } catch (error) {
    console.error('Error updating assessment summary:', error);
    return res.status(500).json({ success: false, message: error.message });
  }
});

/**
 * PUT /candidates/assessment-summaries/round-timing
 * Body: positionId, candidateId, roundNumber (1-4), roundCompleted, roundTimeTaken, roundStartTime, roundEndTime
 * Updates the round timing; if this was the last assigned round and all assigned rounds are now completed,
 * sets assessment_end_time and is_assessment_completed.
 */
router.put('/round-timing', tenantMiddleware, async (req, res) => {
  try {
    const {
      positionId,
      candidateId,
      roundNumber,
      roundCompleted,
      roundTimeTaken,
      roundStartTime,
      roundEndTime,
      assessmentSummaryId,
      questionSetId,
    } = req.body || {};
    if (!positionId || !candidateId || roundNumber == null || roundNumber < 1 || roundNumber > 4) {
      return res.status(400).json({
        success: false,
        message: 'positionId, candidateId, and roundNumber (1-4) are required'
      });
    }
    const summaryDb = getAssessmentSummaryDb();
    const roundNum = Number(roundNumber);
    const updates = {};
    if (roundNum === 1) {
      if (roundStartTime != null) updates.round1StartTime = roundStartTime;
      if (roundEndTime != null) updates.round1EndTime = roundEndTime;
      if (roundTimeTaken != null) updates.round1TimeTaken = roundTimeTaken;
      if (roundCompleted != null) updates.round1Completed = Boolean(roundCompleted);
    } else if (roundNum === 2) {
      if (roundStartTime != null) updates.round2StartTime = roundStartTime;
      if (roundEndTime != null) updates.round2EndTime = roundEndTime;
      if (roundTimeTaken != null) updates.round2TimeTaken = roundTimeTaken;
      if (roundCompleted != null) updates.round2Completed = Boolean(roundCompleted);
    } else if (roundNum === 3) {
      if (roundStartTime != null) updates.round3StartTime = roundStartTime;
      if (roundEndTime != null) updates.round3EndTime = roundEndTime;
      if (roundTimeTaken != null) updates.round3TimeTaken = roundTimeTaken;
      if (roundCompleted != null) updates.round3Completed = Boolean(roundCompleted);
    } else {
      if (roundStartTime != null) updates.round4StartTime = roundStartTime;
      if (roundEndTime != null) updates.round4EndTime = roundEndTime;
      if (roundTimeTaken != null) updates.round4TimeTaken = roundTimeTaken;
      if (roundCompleted != null) updates.round4Completed = Boolean(roundCompleted);
    }
    if (Object.keys(updates).length === 0) {
      return res.status(400).json({ success: false, message: 'At least one of roundStartTime, roundEndTime, roundTimeTaken, roundCompleted is required' });
    }
    let result = await CandidateModel.updateAssessmentSummary(candidateId, positionId, updates, summaryDb, assessmentSummaryId || questionSetId || null);
    if (!result) {
      // Record not found — log warning but don't block the submission flow with a 404
      console.warn('[round-timing] Assessment summary not found for candidateId=%s positionId=%s — continuing non-fatally', candidateId, positionId);
      return res.status(200).json({
        success: true,
        partial: true,
        message: 'Round timing noted (assessment summary record not found in DB — non-fatal)',
      });
    }
    // If all assigned rounds are now completed, set assessment_end_time and is_assessment_completed
    // Use toBool (Buffer-safe) — MySQL BIT/TINYINT(1) cols return as Buffer objects in mysql2.
    // Boolean(Buffer([0])) === true (non-empty object), so we MUST use Buffer-aware conversion.
    const _rtb = (v) => (Buffer.isBuffer(v) ? v[0] !== 0 : Boolean(v));
    const r1a = _rtb(result.round1Assigned ?? result.round1_assigned);
    const r1c = _rtb(result.round1Completed ?? result.round1_completed);
    const r2a = _rtb(result.round2Assigned ?? result.round2_assigned);
    const r2c = _rtb(result.round2Completed ?? result.round2_completed);
    const r3a = _rtb(result.round3Assigned ?? result.round3_assigned);
    const r3c = _rtb(result.round3Completed ?? result.round3_completed);
    const r4a = _rtb(result.round4Assigned ?? result.round4_assigned);
    const r4c = _rtb(result.round4Completed ?? result.round4_completed);
    const totalRoundsCompleted = (r1a && r1c ? 1 : 0) + (r2a && r2c ? 1 : 0) + (r3a && r3c ? 1 : 0) + (r4a && r4c ? 1 : 0);
    result = await CandidateModel.updateAssessmentSummary(
      candidateId,
      positionId,
      { totalRoundsCompleted },
      summaryDb
    );
    if (!result) {
      return res.status(500).json({ success: false, message: 'Failed to update totalRoundsCompleted' });
    }
    const allAssignedCompleted =
      (!r1a || r1c) && (!r2a || r2c) && (!r3a || r3c) && (!r4a || r4c);
    if (allAssignedCompleted) {
      const endTime = new Date().toISOString().slice(0, 19).replace('T', ' ');
      result = await CandidateModel.updateAssessmentSummary(
        candidateId,
        positionId,
        { assessmentEndTime: endTime, isAssessmentCompleted: true },
        summaryDb
      );
      if (result) {
        console.log('[assessment-summaries] Assessment marked completed: assessment_end_time=%s, is_assessment_completed=1', endTime);
      }

      // ── Score calculation and report generation ────────────────────────────
      try {
        const tenantDb = req.tenantDb;
        const candIdStr = String(candidateId || '');
        const posIdStr = String(positionId || '');
        const qSetIdStr = String(questionSetId || '');
        const candHex = candIdStr.replace(/-/g, '');
        const posHex = posIdStr.replace(/-/g, '');

        // Round 4 (aptitude): fetch stored answers with correct_answer and calculate score
        let aptitudeScore = null;
        if (r4a) {
          let qaQuery = `SELECT answer_text, correct_answer
            FROM \`candidates_db\`.candidate_question_answers
            WHERE (candidate_id = ? OR candidate_id = REPLACE(?, '-', ''))
              AND (position_id = ? OR position_id = REPLACE(?, '-', ''))
              AND \`round\` = '4'`;
          const qaParams = [candIdStr, candIdStr, posIdStr, posIdStr];
          if (qSetIdStr) {
            qaQuery += ' AND question_set_id = ?';
            qaParams.push(qSetIdStr);
          }
          const qaRows = await db.query(qaQuery, qaParams);
          if (Array.isArray(qaRows) && qaRows.length > 0) {
            const scoreable = qaRows.filter((r) => r.correct_answer);
            if (scoreable.length > 0) {
              const correct = scoreable.filter(
                (r) => (r.answer_text || '').trim() === (r.correct_answer || '').trim()
              ).length;
              aptitudeScore = Math.round((correct / scoreable.length) * 100);
            } else {
              aptitudeScore = r4c ? 60 : 0; // fallback: no correct_answer seeds yet
            }
          } else {
            aptitudeScore = r4c ? 60 : 0;
          }
        }

        // Rounds 1-3: completion-based score (75 if completed, 40 if assigned but not completed)
        const scoreForRound = (assigned, completed) => (assigned ? (completed ? 75 : 40) : null);
        const round1Score = scoreForRound(r1a, r1c);
        const round2Score = scoreForRound(r2a, r2c);
        const round3Score = scoreForRound(r3a, r3c);

        // Total score = average of all assigned round scores
        const scores = [round1Score, round2Score, round3Score, aptitudeScore].filter((s) => s !== null);
        const totalScore = scores.length > 0 ? Math.round(scores.reduce((a, b) => a + b, 0) / scores.length) : 0;

        // Recommendation status thresholds
        const recStatus = totalScore >= 70 ? 'RECOMMENDED' : totalScore >= 50 ? 'CAUTIOUSLY_RECOMMENDED' : 'NOT_RECOMMENDED';

        // UPDATE interview_evaluations in tenant DB
        if (tenantDb && tenantDb !== 'candidates_db' && candHex.length === 32 && posHex.length === 32) {
          try {
            await db.query(
              `UPDATE \`${tenantDb}\`.interview_evaluations
                SET total_score = ?,
                    section_scores_general = ?,
                    section_scores_position_specific = ?,
                    section_scores_coding = ?,
                    section_scores_aptitude = ?,
                    recommendation_status = ?,
                    report_generated = TRUE,
                    updated_at = NOW()
                WHERE position_id = UNHEX(?) AND candidate_id = UNHEX(?)`,
              [totalScore, round1Score, round2Score, round3Score, aptitudeScore, recStatus, posHex, candHex]
            );
            console.log('[assessment-summaries] interview_evaluations scored: total=%s rec=%s', totalScore, recStatus);
          } catch (ieErr) {
            console.warn('[assessment-summaries] interview_evaluations update skipped:', ieErr.message);
          }
        }

        // UPDATE assessment_report_generation → is_generated = 1
        if (candHex.length === 32 && posHex.length === 32) {
          try {
            await db.query(
              `UPDATE \`candidates_db\`.assessment_report_generation
                SET is_generated = 1, updated_at = NOW(6)
                WHERE candidate_id = UNHEX(?) AND position_id = UNHEX(?)`,
              [candHex, posHex]
            );
          } catch (argErr) {
            console.warn('[assessment-summaries] assessment_report_generation update skipped:', argErr.message);
          }
        }

        // UPDATE assessments_summary.is_report_generated = true
        await CandidateModel.updateAssessmentSummary(
          candidateId, positionId, { isReportGenerated: true }, summaryDb, assessmentSummaryId || null
        );

        // Mark position-candidate status as TEST_COMPLETED in tenant DB
        try {
          if (tenantDb && tenantDb !== 'candidates_db') {
            // candidate_positions table
            await db.query(
              `UPDATE \`${tenantDb}\`.candidate_positions
                 SET recommendation_status = 'TEST_COMPLETED', status = 'TEST_COMPLETED', updated_at = NOW()
               WHERE (UPPER(HEX(candidate_id)) = UPPER(?) OR LOWER(REPLACE(candidate_id, '-', '')) = LOWER(?))
                 AND (UPPER(HEX(position_id)) = UPPER(?) OR LOWER(REPLACE(position_id, '-', '')) = LOWER(?))`,
              [candHex, candHex, posHex, posHex]
            ).catch(() => null);
            // position_candidates table (alternate schema)
            await db.query(
              `UPDATE \`${tenantDb}\`.position_candidates
                 SET recommendation = 'TEST_COMPLETED', updated_at = NOW()
               WHERE (LOWER(BIN_TO_UUID(candidate_id)) = LOWER(?) OR REPLACE(LOWER(BIN_TO_UUID(candidate_id)), '-', '') = LOWER(?))
                 AND (LOWER(BIN_TO_UUID(position_id)) = LOWER(?) OR REPLACE(LOWER(BIN_TO_UUID(position_id)), '-', '') = LOWER(?))`,
              [candIdStr, candHex, posIdStr, posHex]
            ).catch(() => null);
            console.log('[assessment-summaries] position status set to TEST_COMPLETED');
          }
        } catch (_) {}

        console.log('[assessment-summaries] Scoring complete — reports flagged as generated');
      } catch (scoreErr) {
        console.error('[assessment-summaries] Scoring error (non-fatal):', scoreErr.message);
      }
    }
    return res.status(200).json({
      success: true,
      message: 'Round timing updated',
      data: toCleanAssessmentData(result)
    });
  } catch (error) {
    console.error('Error updating round timing:', error);
    return res.status(500).json({ success: false, message: error.message });
  }
});

module.exports = router;
