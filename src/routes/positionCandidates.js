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
const { getDb, COLLECTIONS } = require('../config/mongo');

const assessmentSummaryDb = () => (config.database && config.database.name) || process.env.DB_NAME || 'candidates_db';

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

    let scoreResponse;
    try {
      scoreResponse = await axios.post(
        `${streamingUrl}/resume-ats/score`,
        {
          positionId,
          candidateId,
          positionCandidateId,
          tenantId: req.tenantDb
        },
        { timeout: 60000, headers: { 'Content-Type': 'application/json' } }
      );
    } catch (e) {
      const status = e.response?.status || 502;
      let msg = e.response?.data?.detail ?? e.response?.data?.message ?? e.message;
      if (typeof msg !== 'string') msg = msg ? JSON.stringify(msg) : 'Streaming resume-score API unavailable';
      return res.status(status).json({
        success: false,
        message: msg
      });
    }

    const overallScore = scoreResponse.data?.overallScore ?? null;
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
    try {
      const aiSettings = organizationId
        ? await adminService.getAiScoringSettings(req.tenantDb, organizationId)
        : null;
      const minInvite = aiSettings?.resume?.rejection?.notSelected ?? 50;
      recommendationStatus = overallScore >= minInvite ? 'INVITED' : 'RESUME_REJECTED';
      const statusResult = await CandidateModel.updateRecommendationStatus(
        req.tenantDb,
        positionCandidateId,
        recommendationStatus
      );
      if (!statusResult.updated) {
        console.warn('score-resume: updateRecommendationStatus had no effect');
      }
    } catch (err) {
      console.warn('score-resume: AI settings or status update failed, keeping INVITED', err.message);
    }

    if (recommendationStatus === 'INVITED') {
      try {
        const collegeName = req.body.companyName;
        const positionTitle = req.body.positionName;
        const candidateNameFromBody = req.body.candidateName;
        if (!collegeName || !positionTitle || !candidateNameFromBody) {
          console.warn('score-resume: skip private link — require companyName (college), positionName (title), candidateName from request');
        } else {
          const linkDetails = await CandidateModel.getPositionCandidateDetailsForLink(req.tenantDb, positionCandidateId);
          if (linkDetails?.candidateId && linkDetails?.questionSetId && organizationId) {
            let candidateEmail = linkDetails.candidateEmail;
            if (!candidateEmail) {
              const candidate = await CandidateModel.getCandidateById(candidateId, organizationId);
              if (candidate) candidateEmail = candidate.email;
            }
            if (!candidateEmail) {
              console.warn('score-resume: skip private link — candidate email not found');
            } else {
              const existingLink = await CandidateModel.getExistingPrivateLinkByCandidateAndPosition(candidateId, positionId, 'candidates_db');
              if (existingLink && existingLink.linkId) {
                // Reuse existing private link; do not create duplicate
              } else {
                const linkBase = process.env.CANDIDATE_LINK_BASE_URL || 'http://localhost:4002';
                const linkData = {
                  link_type: 'PRIVATE',
                  candidate_id: candidateId,
                  candidate_name: candidateNameFromBody,
                  client_id: organizationId,
                  company_name: collegeName,
                  email: candidateEmail,
                  position_id: positionId,
                  position_name: positionTitle,
                  question_set_id: linkDetails.questionSetId,
                  interview_platform: 'BROWSER',
                  link: linkBase,
                  link_active_at: linkDetails.linkActiveAt || new Date(),
                  link_expires_at: linkDetails.linkExpiresAt,
                  created_by: req.user?.id || req.user?.userId || ''
                };
                await CandidateModel.createCandidateLink(linkData, 'candidates_db');
              }
            }
          }
        }
      } catch (linkErr) {
        console.warn('score-resume: private link creation failed (candidate still INVITED)', linkErr.message);
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

    const candidate = await CandidateModel.getCandidateById(linkDetails.candidateId, orgId);
    const candidateEmail = candidate?.email || candidate?.candidate_email || req.body.candidateEmail;
    if (!candidateEmail) {
      return res.status(400).json({ success: false, message: 'Candidate email not found. Provide candidateEmail in body or ensure candidate exists in college_candidates.' });
    }

    const statusResult = await CandidateModel.updateRecommendationStatus(req.tenantDb, positionCandidateId, 'MANUALLY_INVITED');
    if (!statusResult.updated) {
      return res.status(500).json({ success: false, message: 'Failed to update status to Manually Invited.' });
    }

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

    const existingLink = await CandidateModel.getExistingPrivateLinkByCandidateAndPosition(
      linkDetails.candidateId,
      linkDetails.positionId,
      'candidates_db'
    );

    let linkId, verificationCode, linkReused = false;
    if (existingLink && existingLink.linkId && existingLink.verificationCode) {
      linkId = existingLink.linkId;
      verificationCode = existingLink.verificationCode;
      linkReused = true;
      // Update existing link with dynamic company/position so verify returns correct display data
      await CandidateModel.updatePrivateLinkDisplayFields(
        linkDetails.candidateId,
        linkDetails.positionId,
        { company_name: resolvedCompanyName, position_name: linkDetails.positionName || 'Position' },
        'candidates_db'
      );
    } else {
      const linkBase = process.env.CANDIDATE_LINK_BASE_URL || 'http://localhost:4002';
      const linkData = {
        link_type: 'PRIVATE',
        candidate_id: linkDetails.candidateId,
        candidate_name: linkDetails.candidateName || candidate?.candidate_name || 'Candidate',
        client_id: orgId,
        company_name: resolvedCompanyName,
        email: candidateEmail,
        position_id: linkDetails.positionId,
        position_name: linkDetails.positionName || 'Position',
        question_set_id: linkDetails.questionSetId,
        interview_platform: 'BROWSER',
        link: linkBase,
        link_active_at: linkDetails.linkActiveAt || new Date(),
        link_expires_at: linkDetails.linkExpiresAt || new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
        created_by: req.user?.id || req.user?.userId || ''
      };
      const created = await CandidateModel.createCandidateLink(linkData, 'candidates_db');
      linkId = created.linkId;
      verificationCode = created.verificationCode;
    }

    // Assessment summary: create only if not present (same as ref flow)
    const summaryDb = assessmentSummaryDb();
    let assessmentSummary = await CandidateModel.getAssessmentSummary(linkDetails.candidateId, linkDetails.positionId, summaryDb);
    if (!assessmentSummary) {
      let round1Assigned = false, round2Assigned = false, round3Assigned = false, round4Assigned = false;
      let totalDuration = '0';
      try {
        const sections = await questionSectionService.getQuestionSectionsByQuestionSetId(req.tenantDb, linkDetails.questionSetId, req.user?.id);
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
        console.warn('manual-invite: question sections fetch failed, using defaults', sectionErr.message);
        round1Assigned = true;
      }
      const totalRounds = [round1Assigned, round2Assigned, round3Assigned, round4Assigned].filter(Boolean).length;
      const summaryPayload = {
        positionId: linkDetails.positionId,
        candidateId: linkDetails.candidateId,
        questionId: linkDetails.questionSetId,
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

    // Log manual invite activity
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
                positionName: linkDetails.positionName || 'Position'
            }
        });
    } catch (logErr) {
        console.warn('[PositionCandidates] manual-invite activity logging failed:', logErr.message);
    }

    // Send invite email with verification code and correct position name
    try {
      const testPortalUrl = (config.candidateTestPortalUrl || process.env.CANDIDATE_TEST_PORTAL_URL || process.env.CANDIDATE_LINK_BASE_URL || '').trim() || 'your test portal';
      const candidateDisplayName = linkDetails.candidateName || candidate?.candidate_name || 'Candidate';
      const positionDisplayName = linkDetails.positionName || 'the position';
      const inviteSubject = `You have been manually invited to take the assessment – ${positionDisplayName}`;
      const inviteBody = `<p>Hi ${candidateDisplayName},</p><p>You have been selected to take an assessment for the position: <strong>${positionDisplayName}</strong> at <strong>${resolvedCompanyName}</strong>.</p><p>Your verification code is: <strong>${verificationCode}</strong></p><p>Take your test at: <a href="${testPortalUrl}">${testPortalUrl}</a></p><p>Enter your registered email and this verification code to start the assessment.</p><p>The link is valid for 7 days.</p><p>Best regards,<br/>${resolvedCompanyName} Recruitment Team</p>`;
      const emailResult = await emailService.sendEmail(candidateEmail, inviteSubject, inviteBody);
      
      // Log single email activity
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
                status: emailResult.sent ? 'SENT' : 'FAILED',
                error: emailResult.error || null,
                positionName: positionDisplayName
            }
        });
      } catch (logErr) {
        console.warn('[PositionCandidates] manual-invite single email activity logging failed:', logErr.message);
      }

      if (!emailResult.sent) {
        console.warn('[manual-invite] Email not sent:', emailResult.error);
      }
    } catch (emailErr) {
      console.warn('[manual-invite] Email send error (non-fatal):', emailErr.message);
    }

    // Send WhatsApp invite if mobile number is available
    if (candidate?.mobile_number || candidate?.mobileNumber) {
        try {
            const mobileNumber = candidate?.mobile_number || candidate?.mobileNumber;
            const testPortalUrl = (config.candidateTestPortalUrl || process.env.CANDIDATE_TEST_PORTAL_URL || process.env.CANDIDATE_LINK_BASE_URL || '').trim() || 'your test portal';
            const candidateDisplayName = linkDetails.candidateName || candidate?.candidate_name || 'Candidate';
            const positionDisplayName = linkDetails.positionName || 'the position';
            
            const waBodyValues = [
                candidateDisplayName,
                positionDisplayName,
                resolvedCompanyName,
                testPortalUrl,
                verificationCode
            ];
            
            const waResult = await whatsappService.sendWhatsAppMessage(mobileNumber, waBodyValues);
            
            // Log WhatsApp activity
            try {
                await ActivityLogService.logActivity(req.tenantDb, {
                    organizationId: orgId,
                    actorId: req.user?.id || 'SYSTEM',
                    actorName: req.user?.fullName || req.user?.name || 'System',
                    actorRole: 'Admin',
                    activityType: 'WHATSAPP_MESSAGE',
                    activityTitle: `Manual WhatsApp Invitation sent to ${candidateDisplayName}`,
                    activityDescription: `Manual assessment invitation WhatsApp for position: ${positionDisplayName}`,
                    entityId: linkDetails.candidateId,
                    entityType: 'CANDIDATE',
                    metadata: {
                        recipient: mobileNumber,
                        status: waResult.sent ? 'SENT' : 'FAILED',
                        error: waResult.error || null,
                        positionName: positionDisplayName,
                        positionId: linkDetails.positionId,
                        candidateId: linkDetails.candidateId
                    }
                });
            } catch (logErr) {
                console.warn('[PositionCandidates] manual-invite WhatsApp activity logging failed:', logErr.message);
            }

            if (!waResult.sent) {
                console.warn('[manual-invite] WhatsApp not sent:', waResult.error);
            }
        } catch (waErr) {
            console.warn('[manual-invite] WhatsApp send error (non-fatal):', waErr.message);
        }
    }

    return res.status(200).json({
      success: true,
      message: linkReused
        ? 'Manual invite completed. Existing private link reused; assessment summary ensured. Status set to Manually Invited.'
        : 'Manual invite completed. Private link and assessment summary created; status set to Manually Invited.',
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

module.exports = router;
module.exports.handleScoreResume = handleScoreResume;
