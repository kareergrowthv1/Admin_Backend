const express = require('express');
const router = express.Router();
const authMiddleware = require('../middlewares/auth.middleware');
const tenantMiddleware = require('../middlewares/tenant.middleware');
const CandidateModel = require('../models/candidateModel');
const adminService = require('../services/adminService');
const ActivityLogService = require('../services/activityLogService');
const questionSectionService = require('../services/questionSectionService');
const db = require('../config/db');
const config = require('../config');
const axios = require('axios');
const emailService = require('../services/emailService');
const whatsappService = require('../services/whatsappService');
const buildHttpsAgent = require('../utils/buildHttpsAgent');
const { getDb, COLLECTIONS } = require('../config/mongo');

const assessmentSummaryDb = () => 'candidates_db';

/**
 * POST /position-candidates/add
 * Creates a position-candidate mapping in the tenant database.
 * Reference: backend_admin-main → PositionCandidateController.java
 *
 * Payload:
 * {
 *   positionId: string,
 *   candidateId: string,
 *   questionSetId: string,
 *   linkActiveAt: ISO string,
 *   linkExpiresAt: ISO string,
 *   interviewScheduledBy: string (userId),
 *   recommendationStatus: "INVITED"
 * }
 */
router.post('/add', authMiddleware, tenantMiddleware, async (req, res) => {
    try {
        const {
            positionId,
            candidateId,
            questionSetId,
            linkActiveAt,
            linkExpiresAt,
            interviewScheduledBy,
            recommendationStatus,
            organizationId,
            createdBy
        } = req.body;

        // Validate required fields
        if (!positionId || !candidateId || !questionSetId) {
            return res.status(400).json({
                success: false,
                message: 'positionId, candidateId, and questionSetId are required'
            });
        }

        if (!req.tenantDb) {
            return res.status(400).json({
                success: false,
                message: 'Tenant database not resolved. Ensure X-Tenant-Id header is set.'
            });
        }

        const scheduledBy = interviewScheduledBy || req.user?.id || null;

        const orgId = organizationId || req.user?.organizationId || req.user?.organization_id || null;
        if (!orgId) {
            return res.status(400).json({
                success: false,
                message: 'organizationId is required. Send it in the request body or ensure you are logged in.'
            });
        }

        const createdById = createdBy || req.user?.id || scheduledBy || null;

        const tenantDb = req.tenantDb;

        // Check and deduct interview credits (same pattern as position credits when creating a position)
        const creditsQuery = `SELECT 
            id,
            total_interview_credits, 
            utilized_interview_credits,
            valid_till,
            is_active
        FROM \`${tenantDb}\`.credits 
        WHERE is_active = 1 
        ORDER BY created_at DESC LIMIT 1`;
        const creditsRows = await db.query(creditsQuery, []);

        if (creditsRows.length === 0) {
            return res.status(404).json({
                success: false,
                message: 'Credits not found for this organization'
            });
        }

        const credits = creditsRows[0];
        if (credits.valid_till) {
            const validTill = new Date(credits.valid_till);
            if (validTill < new Date()) {
                return res.status(400).json({
                    success: false,
                    message: 'Credits have expired',
                    creditError: true
                });
            }
        }

        const totalInterview = Number(credits.total_interview_credits) || 0;
        const utilizedInterview = Number(credits.utilized_interview_credits) || 0;
        const remainingInterview = totalInterview - utilizedInterview;

        if (remainingInterview <= 0) {
            return res.status(402).json({
                success: false,
                message: 'Insufficient interview credits available',
                creditError: true
            });
        }

        const result = await CandidateModel.addPositionCandidate({
            positionId,
            candidateId,
            questionSetId,
            linkActiveAt,
            linkExpiresAt,
            interviewScheduledBy: scheduledBy,
            recommendationStatus: recommendationStatus || 'INVITED',
            positionTitle: req.body.positionTitle || null,
            organizationId: orgId,
            createdBy: createdById
        }, tenantDb);

        // Deduct one interview credit: update the exact row we read (id may be BINARY(16))
        const creditsId = credits.id;
        const updateCreditsQuery = `
            UPDATE \`${tenantDb}\`.credits 
            SET utilized_interview_credits = utilized_interview_credits + 1,
                updated_at = NOW()
            WHERE id = ?
        `;
        await db.query(updateCreditsQuery, [creditsId]);

        // Create notifications for the specific candidate
        try {
            const mongoDb = await getDb();
            const positionTitle = req.body.positionTitle || 'Assessment';
            
            // 1. Test Assigned Notification
            await mongoDb.collection(COLLECTIONS.NOTIFICATIONS).insertOne({
                candidateId,
                message: `You have been assigned to the assessment for: "${positionTitle}". Check your email for details.`,
                type: 'test_assigned',
                createdAt: new Date(),
                dismissed: false
            });

            // 2. Credit Utilized Notification (Interview Credit)
            await mongoDb.collection(COLLECTIONS.NOTIFICATIONS).insertOne({
                candidateId,
                message: `1 Interview Credit has been utilized for your: "${positionTitle}" assessment.`,
                type: 'credit_utilization',
                createdAt: new Date(),
                dismissed: false
            });
        } catch (mongoErr) {
            console.warn('[PositionCandidates] Failed to create MongoDB notifications:', mongoErr.message);
        }

        const responseData = { ...result, recommendationStatus: 'PENDING' };
        
        // Log activity
        try {
            await ActivityLogService.logActivity(tenantDb, {
                organizationId: orgId,
                actorId: scheduledBy,
                actorName: req.body.actorName || req.user?.fullName || req.user?.name || 'Admin',
                actorRole: 'Admin',
                activityType: 'INTERVIEW_SCHEDULED',
                activityTitle: 'Interview Scheduled',
                activityDescription: `Interview scheduled for candidate ID ${candidateId}`,
                entityId: candidateId,
                entityType: 'CANDIDATE',
                metadata: {
                    positionId,
                    candidateId,
                    questionSetId,
                    positionName: req.body.positionTitle || 'Position'
                }
            });
        } catch (logErr) {
            console.warn('[PositionCandidates] Activity logging failed:', logErr.message);
        }

        // Always ensure assessment is ready (private link + summary created) so that subsequent test flows don't fail
        try {
            const helperResult = await ensureCandidateAssessmentReady(req, {
                positionCandidateId: result.id,
                organizationId: orgId,
                candidateId,
                positionId,
                positionName: req.body.positionTitle || 'Assessment',
                companyName: req.body.companyName || 'Company'
            });
            responseData.linkGenerated = helperResult.success;
        } catch (helperErr) {
            console.warn('[PositionCandidates] add: ensureCandidateAssessmentReady failed:', helperErr.message);
        }

        return res.status(201).json({
            success: true,
            message: 'Position candidate created successfully',
            data: responseData
        });

    } catch (error) {
        console.error('Error creating position candidate:', error);

        if (error.code === 'ER_DUP_ENTRY') {
            return res.status(409).json({
                success: false,
                message: 'Candidate is already linked to this position/question set.'
            });
        }

        if (error.creditError) {
            return res.status(error.status || 402).json({
                success: false,
                message: error.message || 'Insufficient interview credits',
                creditError: true
            });
        }

        const message = error.sqlMessage || error.message || 'Failed to create position candidate';
        return res.status(500).json({
            success: false,
            message
        });
    }
});

/**
 * Build headers to forward to downstream services (CandidateBackend, AI/Streaming) so they accept the same auth.
 */
function forwardAuthHeaders(req) {
  const h = {};
  if (req.headers.authorization) h.Authorization = req.headers.authorization;
  if (req.headers['x-tenant-id']) h['X-Tenant-Id'] = req.headers['x-tenant-id'];
  if (req.headers['x-user-id']) h['X-User-Id'] = req.headers['x-user-id'];
  if (req.headers['x-organization-id']) h['X-Organization-Id'] = req.headers['x-organization-id'];
  if (req.cookies && req.cookies.accessToken && !h.Authorization) h.Authorization = `Bearer ${req.cookies.accessToken}`;
  if (req.cookies && req.cookies.tenantDb && !h['X-Tenant-Id']) h['X-Tenant-Id'] = req.cookies.tenantDb;
  return h;
}

function textFromExtractedData(raw) {
  if (!raw) return '';
  let parsed = raw;
  if (typeof raw === 'string') {
    const t = raw.trim();
    if (!t) return '';
    try {
      parsed = JSON.parse(t);
    } catch (_) {
      return t;
    }
  }

  if (typeof parsed === 'string') return parsed.trim();
  if (!parsed || typeof parsed !== 'object') return '';
  if (typeof parsed.text === 'string' && parsed.text.trim().length >= 20) return parsed.text.trim();
  if (typeof parsed.fullText === 'string' && parsed.fullText.trim().length >= 20) return parsed.fullText.trim();
  if (typeof parsed.raw_text === 'string' && parsed.raw_text.trim().length >= 20) return parsed.raw_text.trim();
  if (Array.isArray(parsed.keywords) && parsed.keywords.length) {
    return parsed.keywords.map((k) => (typeof k === 'string' ? k : String(k))).join(', ');
  }
  return '';
}

async function resolveScoreInput(tenantDb, positionId, candidateId, resumeTextOverride) {
  let jobDescriptionText = '';
  let resumeText = (resumeTextOverride || '').trim();
  let minExperience = null;
  let maxExperience = null;

  try {
    const jdRows = await db.query(
      `SELECT extracted_data FROM \`${tenantDb}\`.jd_extract WHERE position_id = ? OR LOWER(REPLACE(position_id, '-', '')) = LOWER(REPLACE(?, '-', '')) LIMIT 1`,
      [positionId, positionId]
    );
    jobDescriptionText = textFromExtractedData(jdRows?.[0]?.extracted_data);
  } catch (_) {}

  try {
    const posRows = await db.query(
      `SELECT title, minimum_experience AS minExperience, maximum_experience AS maxExperience, job_description AS jobDescription
       FROM \`${tenantDb}\`.positions
       WHERE id = UNHEX(REPLACE(?,'-','')) OR BIN_TO_UUID(id) = ? LIMIT 1`,
      [positionId, positionId]
    );
    const pos = posRows?.[0];
    if (pos) {
      if (!jobDescriptionText && pos.jobDescription) jobDescriptionText = String(pos.jobDescription).trim();
      if (!jobDescriptionText && pos.title) jobDescriptionText = `Role: ${pos.title}. Position requirements and responsibilities.`;
      if (pos.minExperience != null && !Number.isNaN(Number(pos.minExperience))) minExperience = Number(pos.minExperience);
      if (pos.maxExperience != null && !Number.isNaN(Number(pos.maxExperience))) maxExperience = Number(pos.maxExperience);
    }
  } catch (_) {}

  if (!resumeText || resumeText.length < 50) {
    try {
      const rowScoped = await db.query(
        `SELECT extracted_data FROM \`${tenantDb}\`.resume_extract WHERE (candidate_id = ? OR LOWER(REPLACE(candidate_id, '-', '')) = LOWER(REPLACE(?, '-', ''))) AND (position_id = ? OR LOWER(REPLACE(position_id, '-', '')) = LOWER(REPLACE(?, '-', ''))) LIMIT 1`,
        [candidateId, candidateId, positionId, positionId]
      );
      resumeText = textFromExtractedData(rowScoped?.[0]?.extracted_data) || resumeText;
    } catch (_) {}
  }

  if (!resumeText || resumeText.length < 50) {
    try {
      const rowGlobal = await db.query(
        `SELECT extracted_data FROM \`${tenantDb}\`.resume_extract WHERE (candidate_id = ? OR LOWER(REPLACE(candidate_id, '-', '')) = LOWER(REPLACE(?, '-', ''))) LIMIT 1`,
        [candidateId, candidateId]
      );
      const fallbackText = textFromExtractedData(rowGlobal?.[0]?.extracted_data);
      if (fallbackText.length > resumeText.length) resumeText = fallbackText;
    } catch (_) {}
  }

  return {
    jobDescriptionText: jobDescriptionText || '',
    resumeText: resumeText || '',
    minExperience,
    maxExperience
  };
}

async function handleScoreInput(req, res) {
  try {
    const { positionId, candidateId, resumeText } = req.body || {};
    if (!positionId || !candidateId) {
      return res.status(400).json({ success: false, message: 'positionId and candidateId are required' });
    }
    if (!req.tenantDb) {
      return res.status(400).json({ success: false, message: 'Tenant database not resolved' });
    }

    const input = await resolveScoreInput(req.tenantDb, positionId, candidateId, resumeText);
    return res.status(200).json({ success: true, data: input });
  } catch (error) {
    console.error('score-input error:', error);
    return res.status(500).json({ success: false, message: error.message || 'Failed to resolve score input' });
  }
}

/**
 * POST /position-candidates/score-resume
 * Body: { positionCandidateId, candidateId, positionId }
 * Calls Streaming POST /resume-ats/score (AI service); saves score to candidate-position link.
 */
async function handleScoreResume(req, res) {
  try {
    const { positionCandidateId, candidateId, positionId, organizationId: bodyOrgId } = req.body;
    if (!positionCandidateId || !candidateId || !positionId) {
      return res.status(400).json({
        success: false,
        message: 'positionCandidateId, candidateId, and positionId are required'
      });
    }
    if (!req.tenantDb) {
      return res.status(400).json({ success: false, message: 'Tenant database not resolved' });
    }

    const streamingUrl = (config.streamingServiceUrl || config.aiServiceUrl || '').replace(/\/$/, '');
    if (!streamingUrl) {
      return res.status(503).json({
        success: false,
        message: 'Streaming service not configured. Set STREAMING_SERVICE_URL or AI_SERVICE_URL (e.g. http://localhost:9002).'
      });
    }

    let scoreResponse = { data: { categoryScores: req.body.categoryScores || {} } };
    let overallScore = req.body.overallScore;

    if (overallScore == null || Number.isNaN(Number(overallScore))) {
      try {
        const httpsAgent = buildHttpsAgent(streamingUrl);
        scoreResponse = await axios.post(
          `${streamingUrl}/resume-ats/score`,
          {
            positionId,
            candidateId,
            positionCandidateId,
            tenantId: req.tenantDb,
            resumeText: req.body.resumeText || undefined
          },
          { timeout: 60000, headers: { 'Content-Type': 'application/json' }, httpsAgent }
        );
      } catch (e) {
        const status = e.response?.status || 502;
        let msg = e.response?.data?.detail ?? e.response?.data?.message ?? e.message;
        if (typeof msg !== 'string') msg = msg ? JSON.stringify(msg) : 'Streaming resume-score API unavailable';

        if (status === 400 && msg.includes('too short')) {
          console.warn('[handleScoreResume] Scoring skipped: resume text too short for AI analysis.');
          return res.status(200).json({
            success: true,
            data: {
              recommendationStatus: 'INVITED',
              warning: 'Resume text too short for AI analysis. Scoring skipped.',
              overallScore: 0
            }
          });
        }

        console.error('[handleScoreResume] Streaming error:', msg);
        return res.status(status === 400 ? 200 : status).json({
          success: status === 400,
          message: msg,
          warning: status === 400 ? 'AI scoring unavailable for this resume variant.' : undefined,
          data: status === 400 ? { recommendationStatus: 'INVITED', overallScore: 0 } : undefined
        });
      }
      overallScore = scoreResponse.data?.overallScore ?? null;
    } else {
      overallScore = Number(overallScore);
    }

    if (overallScore == null) {
      return res.status(502).json({ success: false, message: 'Invalid score response from Streaming' });
    }

    let updateResult;
    try {
      updateResult = await CandidateModel.updateResumeScore(req.tenantDb, positionCandidateId, overallScore);
    } catch (updateErr) {
      console.error('score-resume: updateResumeScore failed', updateErr);
      return res.status(500).json({
        success: false,
        message: updateErr.message || 'Failed to save score to database'
      });
    }
    if (!updateResult.updated) {
      return res.status(404).json({ success: false, message: 'Position-candidate link not found for update' });
    }

    const organizationId = bodyOrgId || req.user?.organizationId || req.user?.organization_id;
    let recommendationStatus = 'INVITED';
    let inviteMeta = { emailSent: false, linkReused: false, warning: null };
    try {
      const aiSettings = organizationId
        ? await adminService.getAiScoringSettings(req.tenantDb, organizationId)
        : null;
      const minInvite = aiSettings?.resume?.rejection?.notSelected ?? 50;
      recommendationStatus = overallScore >= minInvite ? 'INVITED' : 'RESUME_REJECTED';
    } catch (err) {
      console.warn('score-resume: AI settings fetch failed, using default threshold', err.message);
      recommendationStatus = overallScore >= 50 ? 'INVITED' : 'RESUME_REJECTED';
    }

    if (recommendationStatus === 'INVITED') {
      let linkDetails = null;
      try {
        if (!organizationId) {
          return res.status(400).json({ success: false, message: 'organizationId is required to send invite.' });
        }

        linkDetails = await CandidateModel.getPositionCandidateDetailsForLink(req.tenantDb, positionCandidateId);
        if (!linkDetails || !linkDetails.candidateId || !linkDetails.questionSetId) {
          return res.status(404).json({ success: false, message: 'Position candidate details not found for invitation.' });
        }

        // Fallback: fetch title when join did not resolve it.
        if (!linkDetails.positionName && linkDetails.positionId) {
          try {
            const posHex = String(linkDetails.positionId).replace(/-/g, '');
            const posRows = await db.query(
              `SELECT title FROM \`${req.tenantDb}\`.positions WHERE id = UNHEX(?) LIMIT 1`,
              [posHex]
            );
            if (posRows && posRows[0]?.title) linkDetails.positionName = posRows[0].title;
          } catch (_) {}
        }

        let candidateEmail = req.body.candidateEmail || linkDetails.candidateEmail;
        let candidateRecord = null;

        if (!candidateEmail) {
          try {
            const rows = await db.query(
              `SELECT email, candidate_name, mobile_number FROM \`${req.tenantDb}\`.college_candidates WHERE candidate_id = ? LIMIT 1`,
              [linkDetails.candidateId]
            );
            if (rows && rows[0]?.email) {
              candidateRecord = rows[0];
              candidateEmail = rows[0].email;
            }
          } catch (_) {}
        }
        if (!candidateEmail) {
          candidateRecord = candidateRecord || await CandidateModel.getCandidateById(linkDetails.candidateId, organizationId);
          candidateEmail = candidateRecord?.email || candidateRecord?.candidate_email;
        }
        if (!candidateEmail) {
          return res.status(400).json({ success: false, message: 'Candidate email not found for invitation.' });
        }

        let resolvedCompanyName = (req.body.companyName || '').trim();
        if (!resolvedCompanyName) {
          try {
            const college = await adminService.getCollegeDetails(req.tenantDb, organizationId);
            if (college && college.collegeName) resolvedCompanyName = college.collegeName;
          } catch (_) {}
          if (!resolvedCompanyName) {
            try {
              const company = await adminService.getCompanyDetails(req.tenantDb, organizationId);
              if (company && company.companyName) resolvedCompanyName = company.companyName;
            } catch (_) {}
          }
        }
        resolvedCompanyName = resolvedCompanyName || 'Company';

        const candidateDisplayName = req.body.candidateName || linkDetails.candidateName || candidateRecord?.candidate_name || 'Candidate';
        const positionDisplayName = req.body.positionName || linkDetails.positionName || 'Assessment';

        const assessmentReady = await ensureCandidateAssessmentReady(req, {
          positionCandidateId,
          organizationId,
          candidateId: linkDetails.candidateId,
          positionId: linkDetails.positionId,
          positionName: positionDisplayName,
          companyName: resolvedCompanyName,
          candidateEmail,
          candidateName: candidateDisplayName,
          questionSetId: linkDetails.questionSetId,
          linkActiveAt: linkDetails.linkActiveAt,
          linkExpiresAt: linkDetails.linkExpiresAt
        });

        inviteMeta.linkReused = Boolean(assessmentReady?.linkReused);

        const testPortalUrl = (config.candidateTestPortalUrl || process.env.CANDIDATE_TEST_PORTAL_URL || process.env.CANDIDATE_LINK_BASE_URL || '').trim() || 'your test portal';
        const inviteSubject = `You have been invited to take the assessment – ${positionDisplayName}`;
        const inviteBody = `<p>Hi ${candidateDisplayName},</p><p>You have been selected to take an assessment for the position: <strong>${positionDisplayName}</strong> at <strong>${resolvedCompanyName}</strong>.</p><p>Your verification code is: <strong>${assessmentReady?.verificationCode}</strong></p><p>Take your test at: <a href="${testPortalUrl}">${testPortalUrl}</a></p><p>Enter your registered email and this verification code to start the assessment.</p><p>The link is valid for 7 days.</p><p>Best regards,<br/>${resolvedCompanyName} Recruitment Team</p>`;

        const emailResult = await emailService.sendEmail(candidateEmail, inviteSubject, inviteBody);
        if (!emailResult || !emailResult.sent) {
          const emailError = emailResult?.error || 'Unknown email error';
          console.error('[position-candidates/finalize-resume-score] invite email not sent:', emailError);
          return res.status(500).json({
            success: false,
            message: `Invitation email not delivered: ${emailError}`
          });
        }
        inviteMeta.emailSent = true;

        const statusResult = await CandidateModel.updateRecommendationStatus(
          req.tenantDb,
          positionCandidateId,
          'INVITED'
        );
        if (!statusResult.updated) {
          return res.status(500).json({ success: false, message: 'Failed to update candidate status to INVITED.' });
        }
      } catch (inviteErr) {
        console.error('score-resume: invitation flow failed', inviteErr);
        return res.status(500).json({
          success: false,
          message: inviteErr.message || 'Failed to create invitation after resume score pass.'
        });
      }
    } else {
      const statusResult = await CandidateModel.updateRecommendationStatus(
        req.tenantDb,
        positionCandidateId,
        'RESUME_REJECTED'
      );
      if (!statusResult.updated) {
        console.warn('score-resume: updateRecommendationStatus had no effect for RESUME_REJECTED');
      }
    }

    // Log status change activity
    try {
        await ActivityLogService.logActivity(req.tenantDb, {
            organizationId,
            actorId: req.user?.id || 'SYSTEM',
            actorName: req.body.actorName || req.user?.fullName || req.user?.name || 'System',
            actorRole: 'Admin',
            activityType: 'STATUS_CHANGED',
            activityTitle: 'Candidate Status Updated',
            activityDescription: `Status updated to ${recommendationStatus} after resume scoring`,
            entityId: candidateId,
            entityType: 'CANDIDATE',
            metadata: {
                positionId,
                candidateId,
                score: overallScore,
                oldStatus: 'INVITED',
                newStatus: recommendationStatus,
                positionName: req.body.positionName || 'Position'
            }
        });
    } catch (logErr) {
        console.warn('[PositionCandidates] Activity logging failed:', logErr.message);
    }

    return res.status(200).json({
      success: true,
      message: 'Resume score calculated and saved',
      data: {
        resumeMatchScore: overallScore,
        recommendationStatus,
        inviteEmailSent: inviteMeta.emailSent,
        privateLinkReused: inviteMeta.linkReused,
        categoryScores: scoreResponse.data?.categoryScores || {}
      }
    });
  } catch (error) {
    console.error('score-resume error:', error);
    return res.status(500).json({
      success: false,
      message: error.message || 'Failed to score resume'
    });
  }
}

router.post('/score-resume', authMiddleware, tenantMiddleware, handleScoreResume);
router.post('/score-input', authMiddleware, tenantMiddleware, handleScoreInput);
router.post('/finalize-resume-score', authMiddleware, tenantMiddleware, handleScoreResume);

/**
 * POST /position-candidates/manual-invite
 * For a RESUME_REJECTED candidate: set status to MANUALLY_INVITED, create/reuse private link
 * with dynamic company and position name, and create assessment summary if not present
 * (same flow as ref: ManualAssessmentInvitationEmailSenderServiceImpl + private link + assessment state).
 */
router.post('/manual-invite', authMiddleware, tenantMiddleware, async (req, res) => {
  try {
    const { positionCandidateId, organizationId, companyName } = req.body;
    const orgId = organizationId || req.user?.organizationId || req.user?.organization_id;
    if (!req.tenantDb) {
      return res.status(400).json({ success: false, message: 'Tenant database not resolved.' });
    }
    if (!orgId) {
      return res.status(400).json({ success: false, message: 'organizationId is required.' });
    }
    if (!positionCandidateId) {
      return res.status(400).json({
        success: false,
        message: 'positionCandidateId is required.'
      });
    }

    const linkDetails = await CandidateModel.getPositionCandidateDetailsForLink(req.tenantDb, positionCandidateId);
    if (!linkDetails || !linkDetails.candidateId || !linkDetails.questionSetId) {
      return res.status(404).json({ success: false, message: 'Position candidate link details not found or incomplete.' });
    }

    // Fallback: fetch position title directly from positions table if not resolved through join
    if (!linkDetails.positionName && linkDetails.positionId) {
      try {
        const posHex = linkDetails.positionId.replace(/-/g, '');
        const posRows = await db.query(
          `SELECT title FROM \`${req.tenantDb}\`.positions WHERE id = UNHEX(?) LIMIT 1`,
          [posHex]
        );
        if (posRows && posRows[0]?.title) linkDetails.positionName = posRows[0].title;
      } catch (_) {}
    }

    // Resolve candidate email — check linkDetails first (populated via JOIN), then tenant DB, then fallback to candidates_db
    let candidateEmail = req.body.candidateEmail || linkDetails.candidateEmail;
    let candidate = null;
    if (!candidateEmail) {
      // Try tenant DB first (college linked in tenant schema)
      try {
        const emailRows = await db.query(
          `SELECT email, candidate_name, mobile_number FROM \`${req.tenantDb}\`.college_candidates WHERE candidate_id = ? LIMIT 1`,
          [linkDetails.candidateId]
        );
        if (emailRows && emailRows[0]?.email) {
          candidate = emailRows[0];
          candidateEmail = emailRows[0].email;
        }
      } catch (_) {}
    }
    if (!candidateEmail) {
      // Fallback: candidates_db
      candidate = candidate || await CandidateModel.getCandidateById(linkDetails.candidateId, orgId);
      candidateEmail = candidate?.email || candidate?.candidate_email;
    }
    if (!candidateEmail) {
      return res.status(400).json({ success: false, message: 'Candidate email not found. Ensure the candidate exists in college_candidates.' });
    }

    // Status is updated AFTER email success — done below
    // Dynamic company name: from body or fetch from tenant

    // Dynamic company name: from body or fetch from tenant (college_details / company_details)
    let resolvedCompanyName = (companyName || req.body.companyName || '').trim();
    if (!resolvedCompanyName) {
      try {
        const college = await adminService.getCollegeDetails(req.tenantDb, orgId);
        if (college && college.collegeName) resolvedCompanyName = college.collegeName;
      } catch (_) {}
      if (!resolvedCompanyName) {
        try {
          const company = await adminService.getCompanyDetails(req.tenantDb, orgId);
          if (company && company.companyName) resolvedCompanyName = company.companyName;
        } catch (_) {}
      }
    }
    resolvedCompanyName = resolvedCompanyName || 'Company';

    // 1. Prepare private link and assessment summary (before sending email)
    const assessmentReady = await ensureCandidateAssessmentReady(req, {
        positionCandidateId,
        organizationId: orgId,
        candidateId: linkDetails.candidateId,
        positionId: linkDetails.positionId,
        positionName: linkDetails.positionName || 'Position',
        companyName: resolvedCompanyName,
        candidateEmail,
        candidateName: linkDetails.candidateName || candidate?.candidate_name || 'Candidate',
        questionSetId: linkDetails.questionSetId,
        linkActiveAt: linkDetails.linkActiveAt,
        linkExpiresAt: linkDetails.linkExpiresAt
    });

    const { linkId, verificationCode, linkReused } = assessmentReady;

    // 2. Send email FIRST — only update status if email succeeds
    const testPortalUrl = (config.candidateTestPortalUrl || process.env.CANDIDATE_TEST_PORTAL_URL || process.env.CANDIDATE_LINK_BASE_URL || '').trim() || 'your test portal';
    const candidateDisplayName = linkDetails.candidateName || candidate?.candidate_name || 'Candidate';
    const positionDisplayName = linkDetails.positionName || 'the position';
    const inviteSubject = `You have been manually invited to take the assessment – ${positionDisplayName}`;
    const inviteBody = `<p>Hi ${candidateDisplayName},</p><p>You have been selected to take an assessment for the position: <strong>${positionDisplayName}</strong> at <strong>${resolvedCompanyName}</strong>.</p><p>Your verification code is: <strong>${verificationCode}</strong></p><p>Take your test at: <a href="${testPortalUrl}">${testPortalUrl}</a></p><p>Enter your registered email and this verification code to start the assessment.</p><p>The link is valid for 7 days.</p><p>Best regards,<br/>${resolvedCompanyName} Recruitment Team</p>`;

    let emailResult;
    try {
      emailResult = await emailService.sendEmail(candidateEmail, inviteSubject, inviteBody);
    } catch (emailErr) {
      console.error('[manual-invite] Email send error:', emailErr.message);
      return res.status(500).json({ success: false, message: 'Failed to send invitation email. Status not updated. Please check email configuration.' });
    }

    if (!emailResult || !emailResult.sent) {
      return res.status(500).json({ success: false, message: `Email not delivered: ${emailResult?.error || 'Unknown email error'}. Candidate status has NOT been updated.` });
    }

    // 3. Email sent successfully — now update status
    const statusResult = await CandidateModel.updateRecommendationStatus(req.tenantDb, positionCandidateId, 'MANUALLY_INVITED');
    if (!statusResult.updated) {
      // Email was sent but status update failed — log and continue
      console.warn('[manual-invite] Status update failed after email was sent. positionCandidateId:', positionCandidateId);
    }

    // 4. Log activity
    try {
        await ActivityLogService.logActivity(req.tenantDb, {
            organizationId: orgId,
            actorId: req.user?.id || 'SYSTEM',
            actorName: req.user?.fullName || req.user?.name || 'System',
            actorRole: 'Admin',
            activityType: 'STATUS_CHANGED',
            activityTitle: 'Candidate Manually Invited',
            activityDescription: `Status updated to MANUALLY_INVITED for candidate ID ${linkDetails.candidateId}`,
            entityId: linkDetails.candidateId,
            entityType: 'CANDIDATE',
            metadata: {
                positionId: linkDetails.positionId,
                candidateId: linkDetails.candidateId,
                newStatus: 'MANUALLY_INVITED',
                positionName: positionDisplayName
            }
        });
    } catch (logErr) {
        console.warn('[PositionCandidates] manual-invite activity logging failed:', logErr.message);
    }

    // 5. Log email activity
    try {
        await ActivityLogService.logActivity(req.tenantDb, {
            organizationId: orgId,
            actorId: req.user?.id || 'SYSTEM',
            actorName: req.user?.fullName || req.user?.name || 'System',
            actorRole: 'Admin',
            activityType: 'SINGLE_EMAIL',
            activityTitle: `Manual Invitation sent to ${candidateDisplayName}`,
            activityDescription: `Manual assessment invitation for position: ${positionDisplayName}`,
            entityId: linkDetails.candidateId,
            entityType: 'CANDIDATE',
            metadata: {
                recipient: candidateEmail,
                subject: inviteSubject,
                status: 'SENT',
                positionName: positionDisplayName
            }
        });
    } catch (logErr) {
        console.warn('[PositionCandidates] manual-invite email activity logging failed:', logErr.message);
    }

    // 6. WhatsApp (non-blocking, optional)
    if (candidate?.mobile_number || candidate?.mobileNumber) {
        try {
            const mobileNumber = candidate?.mobile_number || candidate?.mobileNumber;
            const waBodyValues = [candidateDisplayName, positionDisplayName, resolvedCompanyName, testPortalUrl, verificationCode];
            await whatsappService.sendWhatsAppMessage(mobileNumber, waBodyValues);
        } catch (waErr) {
            console.warn('[manual-invite] WhatsApp send error (non-fatal):', waErr.message);
        }
    }

    return res.status(200).json({
      success: true,
      message: linkReused
        ? 'Manual invite completed. Email sent, existing private link reused, status set to Manually Invited.'
        : 'Manual invite completed. Email sent, private link created, status set to Manually Invited.',
      data: {
        positionCandidateId,
        recommendationStatus: 'MANUALLY_INVITED',
        linkId,
        verificationCode,
        reused: linkReused
      }
    });
  } catch (error) {
    console.error('manual-invite error:', error);
    return res.status(500).json({
      success: false,
      message: error.message || 'Manual invite failed.'
    });
  }
});

/**
 * GET /position-candidates/position/:positionId/candidate/:candidateId
 * Fetch a specific position-candidate mapping.
 */
router.get('/position/:positionId/candidate/:candidateId', authMiddleware, tenantMiddleware, async (req, res) => {
    try {
        const { positionId, candidateId } = req.params;

        if (!req.tenantDb) {
            return res.status(400).json({ success: false, message: 'Tenant database not resolved.' });
        }

        const result = await CandidateModel.getPositionCandidate(positionId, candidateId, req.tenantDb);

        if (!result) {
            return res.status(404).json({ success: false, message: 'Position candidate not found' });
        }

        return res.status(200).json({
            success: true,
            message: 'Position candidate retrieved successfully',
            data: result
        });
    } catch (error) {
        console.error('Error fetching position candidate:', error);
        return res.status(500).json({ success: false, message: error.message });
    }
});

/**
 * Helper to ensure a candidate has a private link and an assessment summary.
 * Used during INVITED and MANUALLY_INVITED flows.
 */
async function ensureCandidateAssessmentReady(req, details) {
    const {
        positionCandidateId,
        organizationId,
        candidateId,
        positionId,
        positionName,
        companyName,
        candidateEmail: emailFromCaller,
        candidateName: nameFromCaller,
        questionSetId: qsIdFromCaller,
        linkActiveAt,
        linkExpiresAt
    } = details;

    const tenantDb = req.tenantDb;
    const summaryDb = assessmentSummaryDb();

    // 1. Resolve Missing Details from DB if needed
    let candidateId_ = candidateId;
    let positionId_ = positionId;
    let questionSetId_ = qsIdFromCaller;
    let candidateEmail = emailFromCaller;
    let resolvedPositionName = positionName || 'Assessment';
    let resolvedCandidateName = nameFromCaller || 'Candidate';

    if (!candidateId_ || !questionSetId_ || !candidateEmail) {
        const linkDetails = await CandidateModel.getPositionCandidateDetailsForLink(tenantDb, positionCandidateId);
        if (linkDetails) {
            candidateId_ = candidateId_ || linkDetails.candidateId;
            positionId_ = positionId_ || linkDetails.positionId;
            questionSetId_ = questionSetId_ || linkDetails.questionSetId;
            candidateEmail = candidateEmail || linkDetails.candidateEmail;
            resolvedCandidateName = nameFromCaller || linkDetails.candidateName || 'Candidate';
            resolvedPositionName = positionName || linkDetails.positionName || 'Assessment';
        }
    }

    // Final fallback for email: lookup in tenant DB first, then candidates_db
    if (!candidateEmail && candidateId_) {
        try {
            const emailRows = await db.query(
                `SELECT email, candidate_name, mobile_number FROM \`${tenantDb}\`.college_candidates WHERE candidate_id = ? LIMIT 1`,
                [candidateId_]
            );
            if (emailRows && emailRows[0]?.email) {
                candidateEmail = emailRows[0].email;
                resolvedCandidateName = resolvedCandidateName !== 'Candidate' ? resolvedCandidateName : (emailRows[0].candidate_name || resolvedCandidateName);
            }
        } catch (_) {}
    }
    if (!candidateEmail && candidateId_) {
        const candidate = await CandidateModel.getCandidateById(candidateId_, organizationId);
        candidateEmail = candidate?.email || candidate?.candidate_email;
    }

    if (!candidateEmail || !candidateId_ || !questionSetId_) {
        throw new Error('Incomplete data for assessment readiness: email, candidateId, and questionSetId are required.');
    }

    // 2. Private Link Creation/Re-use
    const existingLink = await CandidateModel.getExistingPrivateLinkByCandidateAndPosition(
        candidateId_,
        positionId_,
        'candidates_db'
    );

    let linkId, verificationCode, linkReused = false;
    if (existingLink && existingLink.linkId && existingLink.verificationCode) {
        linkId = existingLink.linkId;
        verificationCode = existingLink.verificationCode;
        linkReused = true;
        // Update display fields if needed
        await CandidateModel.updatePrivateLinkDisplayFields(
            candidateId_,
            positionId_,
            { company_name: companyName, position_name: resolvedPositionName },
            'candidates_db'
        );
    } else {
        const linkBase = process.env.CANDIDATE_LINK_BASE_URL || 'http://localhost:4002';
        const linkData = {
            link_type: 'PRIVATE',
            candidate_id: candidateId_,
            candidate_name: resolvedCandidateName,
            client_id: organizationId,
            company_name: companyName,
            email: candidateEmail,
            position_id: positionId_,
            position_name: resolvedPositionName,
            question_set_id: questionSetId_,
            interview_platform: 'BROWSER',
            link: linkBase,
            link_active_at: linkActiveAt || new Date(),
            link_expires_at: linkExpiresAt || new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
            created_by: req.user?.id || ''
        };
        const created = await CandidateModel.createCandidateLink(linkData, 'candidates_db');
        linkId = created.linkId;
        verificationCode = created.verificationCode;
    }

    // 3. Assessment Summary Initialization
    let assessmentSummary = await CandidateModel.getAssessmentSummary(candidateId_, positionId_, summaryDb);
    if (!assessmentSummary) {
        let round1Assigned = false, round2Assigned = false, round3Assigned = false, round4Assigned = false;
        let totalDuration = '0';
        try {
            const sections = await questionSectionService.getQuestionSectionsByQuestionSetId(tenantDb, questionSetId_, req.user?.id);
            const section = Array.isArray(sections) && sections.length > 0 ? sections[0] : null;
            if (section) {
                const genList = (section.generalQuestions || {}).questions || [];
                const posList = (section.positionSpecificQuestions || {}).questions || [];
                const codingList = section.codingQuestions || [];
                const aptitudeList = section.aptitudeQuestions || [];
                round1Assigned = genList.length > 0;
                round2Assigned = posList.length > 0;
                round3Assigned = (Array.isArray(codingList) && codingList.length > 0);
                round4Assigned = (Array.isArray(aptitudeList) && aptitudeList.length > 0);
                if (section.totalDuration) totalDuration = section.totalDuration;
            }
        } catch (sectionErr) {
            console.warn('ensureCandidateAssessmentReady: question sections fetch failed, using defaults', sectionErr.message);
            round1Assigned = true;
        }
        const totalRounds = [round1Assigned, round2Assigned, round3Assigned, round4Assigned].filter(Boolean).length;
        const summaryPayload = {
            positionId: positionId_,
            candidateId: candidateId_,
            questionId: questionSetId_,
            totalRoundsAssigned: totalRounds || 1,
            totalRoundsCompleted: 0,
            round1Assigned, round1Completed: false,
            round2Assigned, round2Completed: false,
            round3Assigned, round3Completed: false,
            round4Assigned, round4Completed: false,
            isAssessmentCompleted: false,
            isReportGenerated: false,
            totalInterviewTime: totalDuration
        };
        await CandidateModel.createAssessmentSummary(summaryPayload, summaryDb);
    }

    return {
        success: true,
        linkId,
        verificationCode,
        linkReused
    };
}

module.exports = router;
module.exports.handleScoreResume = handleScoreResume;
