const AtsCandidateModel = require('../models/atsCandidateModel');
const CandidateModel = require('../models/candidateModel');
const adminService = require('./adminService');
const docExtractor = require('../utils/docExtractor');
const ActivityLogService = require('./activityLogService');
const { sendEmail } = require('./emailService');
const db = require('../config/db');
const config = require('../config');
const { v4: uuidv4 } = require('uuid');
const fileStorageUtil = require('../utils/fileStorageUtil');



function extractBasicDetails(text) {
    if (!text) return { email: null, mobile_number: null, name: null, linkedin_link: null };
    const emailMatch = text.match(/\b([a-zA-Z0-9][a-zA-Z0-9._%+\-]{0,63}@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,})\b/i);
    const email = emailMatch ? emailMatch[1].toLowerCase() : null;
    const phonePatterns = [
        /(?:\+91[\s\-]?)?(?:\(?[0-9]{3,5}\)?[\s\-]?)[0-9]{3,5}[\s\-]?[0-9]{4,6}/,
        /\b[6-9]\d{9}\b/,
    ];
    let mobile_number = null;
    for (const pat of phonePatterns) {
        const m = text.match(pat);
        if (m) { mobile_number = m[0].trim(); break; }
    }
    const linkedinMatch = text.match(/(?:https?:\/\/)?(?:www\.)?linkedin\.com\/in\/[a-zA-Z0-9_\-]+\/?/i);
    const linkedin_link = linkedinMatch ? linkedinMatch[0] : null;

    const lines = text.split('\n').map(l => l.trim()).filter(l => l.length > 1);
    const skipWords = ['resume', 'curriculum vitae', 'cv', 'profile', 'summary', 'objective', 'page', 'address', 'contact', 'email', 'phone', 'mobile', 'linkedin', 'github'];
    let name = null;
    for (let i = 0; i < Math.min(lines.length, 10); i++) {
        const line = lines[i];
        const words = line.split(/\s+/);
        const hasEmail = /@/.test(line);
        const hasNumber = /\d{5,}/.test(line);
        const isSkip = skipWords.some(w => line.toLowerCase().includes(w));
        if (!hasEmail && !hasNumber && !isSkip && words.length >= 1 && words.length <= 5) {
            const capitalized = words.filter(w => w.length > 0 && /^[A-Z][a-z]/.test(w)).length;
            if (capitalized >= Math.min(words.length, 1)) {
                name = line;
                break;
            }
        }
    }
    return { email, mobile_number, name: name || 'Extracted Candidate', linkedin_link };
}

function extractSkills(text) {
    if (!text) return [];
    const skillKeywords = ['React', 'Node.js', 'JavaScript', 'Python', 'Java', 'SQL', 'AWS', 'Docker', 'HTML', 'CSS'];
    const foundSkills = [];
    skillKeywords.forEach(s => {
        const regex = new RegExp('\\b' + s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\b', 'i');
        if (regex.test(text)) foundSkills.push(s);
    });
    return foundSkills;
}

function extractExperience(text) {
    if (!text) return { total_experience: '', current_organization: '', notice_period: '' };
    const expMatch = text.match(/([0-9]+(?:\.[0-9]+)?)\+?\s*(?:years?|yrs?)/i);
    const total_experience = expMatch ? expMatch[1] : '';
    return { total_experience, current_organization: '', notice_period: '' };
}

function extractLocation(text) {
    if (!text) return '';
    const labelled = text.match(/(?:Location|Address|City)\s*[:\-]\s*([^\n,|]{3,50})/i);
    return labelled ? labelled[1].trim() : '';
}

/**
 * ATS Candidate Service
 */

class AtsCandidateService {
    static async createCandidate(tenantDb, candidateData) {
        if (!candidateData.organization_id) throw new Error('organization_id is required');
        if (!candidateData.name) throw new Error('name is required');

        const { email, mobile_number, job_id, jobId, mobileNumber } = candidateData;
        const finalJobId = job_id || jobId;
        const finalMobileNumber = mobile_number || mobileNumber;
        const orgIdClean = candidateData.organization_id.replace(/-/g, '');
        const jobIdClean = finalJobId ? finalJobId.replace(/-/g, '') : null;

        // 1. Check if this candidate already exists in the global pool for this org
        const [existingCandidate] = await db.query(
            `SELECT LOWER(BIN_TO_UUID(id)) as id FROM \`candidates_db\`.\`ats_candidates\` 
             WHERE organization_id = UNHEX(?) AND (
               (email = ? AND email != '' AND email IS NOT NULL) OR 
               (mobile_number = ? AND mobile_number != '' AND mobile_number IS NOT NULL) OR 
               (mobile_number = ? AND mobile_number != '' AND mobile_number IS NOT NULL)
             )`,
            [orgIdClean, email, finalMobileNumber, mobile_number]
        );

        let applicationExists = false;
        if (existingCandidate && jobIdClean) {
            // 2. Check if they already have an application for this specific job
            const [existingApp] = await db.query(
                `SELECT 1 FROM \`${tenantDb}\`.\`candidates_job\` 
                 WHERE candidate_id = UNHEX(?) AND job_id = UNHEX(?)`,
                [existingCandidate.id.replace(/-/g, ''), jobIdClean]
            );
            if (existingApp) applicationExists = true;
        }

        // 3. Only check and deduct credits if it's a NEW application
        if (!applicationExists) {
            const credits = await adminService.getCredits(tenantDb, candidateData.organization_id);
            const remainingInterviews = credits?.remainingInterviews ?? 0;
            
            if (remainingInterviews <= 0) {
                throw new Error('your credits got over please contact to the administrator for the more credits');
            }
        }

        // 4. Create or Update the candidate and application
        const resumeScore = candidateData.resume_score || 0;
        
        // Normalize all fields to camelCase for the Model
        const normalizedData = {
            ...candidateData,
            jobId: finalJobId,
            mobileNumber: finalMobileNumber,
            resumeScore: resumeScore,
            resumeUrl: candidateData.resume_url,
            resumeFilename: candidateData.resume_filename,
            source: candidateData.source,
            internalNotes: candidateData.internal_notes,
            currentLocation: candidateData.current_location,
            currentOrganization: candidateData.current_organization,
            totalExperience: candidateData.total_experience,
            currentCtc: candidateData.current_ctc === '' ? null : candidateData.current_ctc,
            expectedCtc: candidateData.expected_ctc === '' ? null : candidateData.expected_ctc,
            noticePeriod: candidateData.notice_period,
            linkedinLink: candidateData.linkedin_link,
            skills: candidateData.skills
        };

        const id = await AtsCandidateModel.createCandidate(tenantDb, candidateData.organization_id, normalizedData);
        
        // 5. Deduct credits ONLY for new applications
        if (id && tenantDb && !applicationExists) {
            try {
                // Always deduct interview credit
                await adminService.utilizeInterviewCredit(tenantDb, candidateData.organization_id);
                
                // Log activity for NEW candidate/application
                await ActivityLogService.logActivity(tenantDb, {
                    organizationId: candidateData.organization_id,
                    actorId: candidateData.createdBy || 'SYSTEM',
                    actorName: candidateData.actorName || 'Admin',
                    actorRole: candidateData.actorRole || 'ADMIN',
                    activityType: 'CANDIDATE_ADDED',
                    activityTitle: 'New candidate added for ' + (candidateData.position_title || 'Position'),
                    activityDescription: `${candidateData.name} was added to the pipeline`,
                    entityId: id,
                    entityType: 'CANDIDATE',
                    metadata: {
                        candidateName: candidateData.name,
                        email: candidateData.email,
                        mobileNumber: finalMobileNumber,
                        jobId: finalJobId,
                        positionName: candidateData.position_title
                    }
                });
            } catch (err) {
                console.error('[AtsCandidateService] Failed to deduct credits or log activity:', err.message);
            }
        } else if (id && applicationExists) {
            // Optional: Log update activity if needed
            console.log(`[AtsCandidateService] Candidate ${id} profile updated for existing application. No credit deducted.`);
        }
        
        return id;
    }

    static async getCandidateById(tenantDb, candidateId) {
        return await AtsCandidateModel.getCandidateForInvitation(tenantDb, candidateId);
    }

    static async getApplicationByCandidateId(tenantDb, organizationId, candidateId) {
        const results = await AtsCandidateModel.getCandidates(tenantDb, organizationId, null, null, 1, 0, null, candidateId);
        return results.candidates && results.candidates.length > 0 ? results.candidates[0] : null;
    }

    static async getCandidates(tenantDb, organizationId, jobId = null, stage = null, limit = 10, offset = 0, search = null) {
        if (!organizationId) throw new Error('organization_id is required');
        return await AtsCandidateModel.getCandidates(tenantDb, organizationId, jobId, stage, limit, offset, search);
    }

    /**
     * Upload resume, parse it, extract info, return extracted JSON data
     */
    static async extractResume(fileData, rawText = null) {
        let text = rawText;
        
        try {
            if (!text) {
                if (!fileData || !fileData.buffer) {
                    throw new Error('File buffer is missing and no raw text provided');
                }
                // Document text extraction from buffer
                const result = await docExtractor.extractTextAndKeywords(fileData.buffer, fileData.originalname);
                text = result.text;
            }
            
            const basicInfo = extractBasicDetails(text);
            const experienceInfo = extractExperience(text);
            const skillsArray = extractSkills(text);

            return {
                name: basicInfo.name,
                email: basicInfo.email,
                mobile_number: basicInfo.mobile_number,
                linkedin_link: basicInfo.linkedin_link,
                total_experience: experienceInfo.total_experience,
                current_organization: experienceInfo.current_organization,
                notice_period: experienceInfo.notice_period,
                current_location: extractLocation(text),
                skills: skillsArray,
                raw_text: text.substring(0, 1000)
            };
        } catch (error) {
            throw new Error(`Failed to extract data: ${error.message}`);
        }
    }

    static async updateCandidateStage(tenantDb, applicationId, stage, actorData) {
        const candidate = await AtsCandidateModel.getCandidateForInvitation(tenantDb, applicationId);
        if (!candidate) throw new Error('Candidate not found');

        const oldStage = candidate.stage;
        if (oldStage === stage) return true;

        // Block reverse move: once invited, cannot go back to active candidates
        if (oldStage === 'invitations' && stage === 'active_candidates') {
            throw new Error('STAGE_LOCKED: Candidate cannot be moved back from Invitations to Active Candidates');
        }

        const updated = await AtsCandidateModel.updateCandidateStage(tenantDb, applicationId, stage);

        // If moved to invitations, send invitation email (no interview link)
        if (updated && stage === 'invitations' && candidate.email) {
            await AtsCandidateService.sendInvitationEmail(tenantDb, candidate, actorData);
        }

        // Note: Assessment setup is now explicitly triggered by the frontend 
        // before calling this stage update to ensure all metadata is present.

        if (updated && tenantDb) {
            try {
                // Get stage titles for better logging
                const stages = await AtsCandidateModel.getJobStages(tenantDb, candidate.organization_id);
                const oldStageObj = stages.find(s => s.stage_id === oldStage);
                const newStageObj = stages.find(s => s.stage_id === stage);
                
                const oldTitle = oldStageObj ? oldStageObj.title : oldStage.replace(/_/g, ' ');
                const newTitle = newStageObj ? newStageObj.title : stage.replace(/_/g, ' ');

                // Get job title if jobId exists
                let positionName = 'Position';
                if (candidate.job_id) {
                    const [job] = await db.query(`SELECT job_title FROM \`${tenantDb}\`.jobs WHERE id = UNHEX(?)`, [candidate.job_id.replace(/-/g, '')]);
                    if (job) positionName = job.job_title;
                }

                await ActivityLogService.logActivity(tenantDb, {
                    organizationId: candidate.organization_id,
                    actorId: actorData.id,
                    actorName: actorData.name,
                    actorRole: actorData.role || 'ADMIN',
                    activityType: 'STATUS_CHANGED',
                    activityTitle: `Candidate moved to ${newTitle}`,
                    activityDescription: `${candidate.name} was moved from ${oldTitle} to ${newTitle}`,
                    entityId: applicationId,
                    entityType: 'CANDIDATE',
                    metadata: {
                        candidateName: candidate.name,
                        fromStage: oldStage,
                        toStage: stage,
                        positionName: positionName,
                        jobId: candidate.job_id
                    }
                });
            } catch (logErr) {
                console.warn('[AtsCandidateService] Status change logging failed:', logErr.message);
            }
        }

        return updated;
    }

    static async getJobStages(tenantDb, organizationId) {
        if (!organizationId) throw new Error('organization_id is required');
        return await AtsCandidateModel.getJobStages(tenantDb, organizationId);
    }
    
    static async deleteCandidate(tenantDb, applicationId) {
        if (!applicationId) throw new Error('applicationId is required');
        return await AtsCandidateModel.deleteCandidate(tenantDb, applicationId);
    }

    static async resendInvitation(tenantDb, applicationId, actorData) {
        const candidate = await AtsCandidateModel.getCandidateForInvitation(tenantDb, applicationId);
        if (!candidate) throw new Error('Candidate not found');
        if (!candidate.email) throw new Error('Candidate has no email address');

        await AtsCandidateService.sendInvitationEmail(tenantDb, candidate, actorData);
        return true;
    }

    static async sendInvitationEmail(tenantDb, candidate, actorData) {
        try {
            let jobTitle = 'the position';
            let jdPath = null;
            let jdFileName = 'JobDescription.pdf';
            let companyName = 'Our Company';
            let priorityLevel = 'MEDIUM';

            if (candidate.job_id && tenantDb) {
                // Fetch job details
                const jobRows = await db.query(
                    `SELECT job_title, job_description_document_path, job_description_document_file_name, priority_level 
                     FROM \`${tenantDb}\`.jobs WHERE id = UNHEX(?)`,
                    [candidate.job_id.replace(/-/g, '')]
                );
                if (jobRows.length > 0) {
                    jobTitle = jobRows[0].job_title;
                    jdPath = jobRows[0].job_description_document_path;
                    jdFileName = jobRows[0].job_description_document_file_name || 'JobDescription.pdf';
                    priorityLevel = jobRows[0].priority_level || 'MEDIUM';
                }

                // Fetch company name
                const companyRows = await db.query(
                    `SELECT company_name FROM \`${tenantDb}\`.company_details LIMIT 1`
                );
                if (companyRows.length > 0) {
                    companyName = companyRows[0].company_name;
                }
            }

            // Calculate Expiry based on priority
            // HIGH: 2 days, MEDIUM: 4 days, LOW: 6 days
            const daysToExpiry = priorityLevel.toUpperCase() === 'HIGH' ? 2 : (priorityLevel.toUpperCase() === 'LOW' ? 6 : 4);
            const expiresAt = new Date();
            expiresAt.setDate(expiresAt.getDate() + daysToExpiry);

            // Generate or fetch token
            let token = candidate.invitation_token;
            if (!token) {
                token = uuidv4();
                await AtsCandidateModel.updateInvitationToken(tenantDb, candidate.id, token, expiresAt);
            } else {
                // Always refresh expiry on re-invite
                await AtsCandidateModel.updateInvitationToken(tenantDb, candidate.id, token, expiresAt);
            }

            // Prepare attachments if JD exists
            const attachments = [];
            if (jdPath) {
                try {
                    const fileBuffer = await fileStorageUtil.retrieveFileByRelativePath(jdPath);
                    if (fileBuffer) {
                        attachments.push({
                            content: fileBuffer.toString('base64'),
                            name: jdFileName,
                            mime_type: fileStorageUtil.getContentType(jdFileName)
                        });
                    }
                } catch (fileErr) {
                    console.warn('[AtsCandidateService] Could not retrieve JD file for attachment:', fileErr.message);
                }
            }

            const senderName = (actorData && actorData.name) ? actorData.name : 'The Recruitment Team';

            const inviteHtml = `
                <div style="font-family: Arial, sans-serif; line-height: 1.6; color: #333; max-width: 600px; margin: 0 auto; padding: 20px; border: 1px solid #f0f0f0; border-radius: 8px;">
                    <p>Dear <strong>${candidate.name}</strong>,</p>
                    <p>We are pleased to inform you that you have been shortlisted and <strong>invited to proceed</strong> for the role of <strong>${jobTitle}</strong> at <strong>${companyName}</strong>.</p>
                    <p>Please find the attached Job Description for your reference.</p>
                    <p>Our recruitment team will be in touch shortly with further details about the next steps in the process.</p>
                    
                    <hr style="border: 0; border-top: 1px solid #eee; margin: 30px 0;">
                    
                    <p style="margin-top: 20px; color: #666; font-size: 14px;">
                        Best regards,<br/>
                        <strong>${senderName}</strong><br/>
                        ${companyName}
                    </p>
                </div>
            `;

            await sendEmail(
                candidate.email,
                `Invitation for ${jobTitle} at ${companyName} - Action Required`,
                inviteHtml,
                null,
                attachments
            );
            console.log('[AtsCandidateService] Invitation email sent to', candidate.email, 'with', attachments.length, 'attachments');
        } catch (mailErr) {
            console.warn('[AtsCandidateService] Failed to send invitation email:', mailErr.message);
            throw mailErr;
        }
    }

    static async setupAssessment(tenantDb, applicationId, actorData, requestData = {}) {
        const candidate = await AtsCandidateModel.getCandidateForInvitation(tenantDb, applicationId);
        if (!candidate) throw new Error('Candidate not found');

        console.log('[AtsCandidateService] setupAssessment Candidate Debug:', {
            applicationId,
            candidateId: candidate.candidate_id || candidate.id,
            job_id: candidate.job_id,
            position_id: candidate.position_id
        });

        // Dynamic Column Detection for question_sets (job_id vs position_id)
        const columnCheck = await db.query(
            `SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS 
             WHERE TABLE_SCHEMA = ? AND TABLE_NAME = 'question_sets' AND COLUMN_NAME IN ('job_id', 'position_id')`,
            [tenantDb]
        );
        const existingColumns = columnCheck.map(c => c.COLUMN_NAME);
        const qSetIdColumn = existingColumns.includes('job_id') ? 'job_id' : 'position_id';
        const jobIdValue = candidate.job_id || candidate.position_id;
        const jobIdClean = jobIdValue ? jobIdValue.replace(/-/g, '') : null;

        if (!jobIdClean) throw new Error('Job/Position ID not found for candidate');

        console.log('[AtsCandidateService] setupAssessment sequence starting...', { applicationId, jobIdClean });

        try {
            // 0. Check for EXISTING Assessment Details (Reuse to avoid duplicates)
            const globalCandidateId = candidate.candidateId || candidate.candidate_id || candidate.id;
            const existingLink = await AtsCandidateModel.getPrivateLink(globalCandidateId, jobIdValue);
            if (existingLink && existingLink.link) {
                console.log('[AtsCandidateService] Existing assessment found. REUSING credentials.', { 
                    linkId: existingLink.id, 
                    code: existingLink.verification_code 
                });
                
                // Fetch job/position details for the email
                const tableCheck = await db.query(
                    `SELECT TABLE_NAME FROM INFORMATION_SCHEMA.TABLES 
                     WHERE TABLE_SCHEMA = ? AND TABLE_NAME IN ('jobs', 'positions')`,
                    [tenantDb]
                );
                const existingTables = tableCheck.map(t => t.TABLE_NAME);
                let jobRows = [];
                if (existingTables.includes('jobs')) {
                    const res = await db.query(`SELECT job_title as title FROM \`${tenantDb}\`.jobs WHERE id = UNHEX(?)`, [jobIdClean]);
                    jobRows = Array.isArray(res[0]) ? res[0] : res;
                }
                const job = jobRows[0] || { title: existingLink.position_name || 'Position' };

                // Resend email using existing data
                await AtsCandidateService.sendAssessmentInviteEmail(tenantDb, candidate, job, existingLink, actorData);
                
                return {
                    success: true,
                    message: 'Existing assessment reused. Invitation resent.',
                    linkData: {
                        link: existingLink.link,
                        verificationCode: existingLink.verification_code,
                        expiresAt: existingLink.link_expires_at
                    }
                };
            }

            // 1. Fetch Job or Position details (Persona-Aware)
        const tableCheck = await db.query(
            `SELECT TABLE_NAME FROM INFORMATION_SCHEMA.TABLES 
             WHERE TABLE_SCHEMA = ? AND TABLE_NAME IN ('jobs', 'positions')`,
            [tenantDb]
        );
        const existingTables = tableCheck.map(t => t.TABLE_NAME);
        
        let jobRows = [];
        if (existingTables.includes('jobs')) {
            const res = await db.query(
                `SELECT job_title as title, priority_level, code FROM \`${tenantDb}\`.jobs WHERE id = UNHEX(?)`,
                [jobIdClean]
            );
            jobRows = Array.isArray(res[0]) ? res[0] : res;
            console.log('[AtsCandidateService] setupAssessment Jobs Lookup:', { count: jobRows.length });
        }
        
        if (jobRows.length === 0 && existingTables.includes('positions')) {
            const res = await db.query(
                `SELECT title, 'MEDIUM' as priority_level, code FROM \`${tenantDb}\`.positions WHERE id = UNHEX(?)`,
                [jobIdClean]
            );
            jobRows = Array.isArray(res[0]) ? res[0] : res;
            console.log('[AtsCandidateService] setupAssessment Positions Lookup:', { count: jobRows.length });
        }
        
        const job = jobRows && jobRows.length > 0 ? jobRows[0] : null;
        if (!job) {
            console.error('[AtsCandidateService] Job/Position NOT FOUND for:', jobIdClean);
            throw new Error('Job/Position not found');
        }

        const qsParams = [requestData.questionSetId ? requestData.questionSetId.replace(/-/g, '') : jobIdClean];
        console.log('[AtsCandidateService] setupAssessment Question Set Query:', {
            table: 'question_sets',
            column: requestData.questionSetId ? 'id' : qSetIdColumn,
            value: qsParams[0]
        });

        const qsRes = await db.query(
            `SELECT LOWER(BIN_TO_UUID(id)) as id, total_duration, interview_platform 
             FROM \`${tenantDb}\`.question_sets WHERE ${requestData.questionSetId ? 'id = UNHEX(?)' : `${qSetIdColumn} = UNHEX(?) AND is_active = 1 LIMIT 1`}`,
            qsParams
        );
        let qSetRows = Array.isArray(qsRes[0]) ? qsRes[0] : qsRes;
        
        // Final Fallback: If no job-specific question set found, try finding ANY active one (sometimes added without specific job link)
        if (!qSetRows || qSetRows.length === 0) {
            console.log('[AtsCandidateService] No job-specific question set, checking for generic active set...');
            const genericRes = await db.query(
                `SELECT LOWER(BIN_TO_UUID(id)) as id, total_duration, interview_platform 
                 FROM \`${tenantDb}\`.question_sets WHERE is_active = 1 LIMIT 1`
            );
            qSetRows = Array.isArray(genericRes[0]) ? genericRes[0] : genericRes;
        }

        const qSet = qSetRows && qSetRows.length > 0 ? qSetRows[0] : null;
        console.log('[AtsCandidateService] setupAssessment Question Set Lookup:', { count: qSetRows.length, qSetId: qSet?.id });
        if (!qSet) throw new Error('No active question set found for this job');

        // 2. Generate OTP and Expiry
        const verificationCode = Math.floor(100000 + Math.random() * 900000).toString();
        const priority = job.priority_level || 'MEDIUM';
        const daysToExpiry = priority.toUpperCase() === 'HIGH' ? 2 : (priority.toUpperCase() === 'LOW' ? 6 : 4);
        const expiresAt = new Date();
        expiresAt.setDate(expiresAt.getDate() + daysToExpiry);

        const testPortalUrl = 'http://localhost:4002'; // Port for CandidateTest
        const LinkId = uuidv4();
        const inviteLink = `${testPortalUrl}/test/${LinkId}`;

        // 3. Prepare link data (Using requestData if provided for higher fidelity)
        const linkData = {
            id: LinkId, // CRITICAL: Use SAME ID as in inviteLink
            candidateId: candidate.candidateId,
            candidateName: requestData.candidateName || candidate.name,
            clientId: candidate.organization_id, // organization_id
            companyName: requestData.companyName || 'Interviewer',
            email: candidate.email,
            jobId: jobIdValue,
            jobTitle: requestData.jobTitle || job.title,
            questionSetId: qSet.id,
            interviewPlatform: qSet.interview_platform || 'BROWSER',
            link: inviteLink,
            verificationCode: verificationCode,
            linkActiveAt: new Date(),
            linkExpiresAt: expiresAt,
            createdBy: actorData.id
        };

        // Fetch company name from tenant DB if possible
        const [company] = await db.query(`SELECT company_name FROM \`${tenantDb}\`.company_details LIMIT 1`);
        if (company) linkData.companyName = company.company_name;

        await AtsCandidateModel.createPrivateLink(linkData);

        // 5. Update merged assessment columns in candidates_job (Tenant DB)
        await AtsCandidateModel.updateAssessmentData(tenantDb, applicationId, {
            jobTitle: job.title,
            jobCode: job.code,
            candidateName: candidate.name,
            assessmentStatus: 'Invited',
            recommendation: 'PENDING',
            questionSetId: qSet.id,
            linkActiveAt: new Date(),
            linkExpiresAt: expiresAt,
            invitationSentAt: new Date()
        });

        // 6. Initialize Assessments Summary and Report Generation (Shared candidates_db)
        const summaryData = {
            candidateId: candidate.candidateId,
            positionId: jobIdValue, // Maps to current job_id or position_id
            questionId: qSet.id,
            totalInterviewTime: qSet.total_duration || '0',
            totalRoundsAssigned: 4, 
            isAssessmentCompleted: false,
            isReportGenerated: false,
            round1Assigned: true,
            round2Assigned: true,
            round3Assigned: true,
            round4Assigned: true
        };
        await CandidateModel.createAssessmentSummary(summaryData);

        // Initialize report generation record
        try {
            await db.query(
                `INSERT IGNORE INTO \`candidates_db\`.\`assessment_report_generation\` (id, candidate_id, position_id, is_generated)
                 VALUES (UNHEX(?), UNHEX(?), UNHEX(?), 0)`,
                [uuidv4().replace(/-/g, ''), candidate.candidateId.replace(/-/g, ''), jobIdValue.replace(/-/g, '')]
            );
        } catch (err) {
            console.warn('[AtsCandidateService] Report generation record initialization failed:', err.message);
        }

        // 7. Send Invitation Email
        await AtsCandidateService.sendAssessmentInviteEmail(tenantDb, candidate, job, linkData, actorData);

        return {
            success: true,
            message: 'Assessment setup and invitation sent successfully',
            linkData: {
                link: linkData.link,
                verificationCode: linkData.verificationCode,
                expiresAt: linkData.linkExpiresAt
            }
        };
        } catch (error) {
            console.error('[AtsCandidateService] setupAssessment FATAL ERROR:', error);
            throw error;
        }
    }

    static async sendAssessmentInviteEmail(tenantDb, candidate, job, linkData, actorData) {
        try {
            const companyName = linkData.companyName || 'KareerGrowth';
            const jobTitle = job.title || 'Position';
            const testPortalUrl = linkData.link;
            const verificationCode = linkData.verificationCode;
            const expiresAt = linkData.linkExpiresAt;
            const platform = linkData.interviewPlatform === 'EXE' ? 'KareerGrowth Dedicated Platform' : 'Web Browser (Chrome/Edge)';

            const inviteHtml = `
                <div style="font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; line-height: 1.6; color: #333; max-width: 600px; margin: 0 auto; padding: 0; border: 1px solid #e0e0e0; border-radius: 12px; overflow: hidden;">
                    <div style="background: linear-gradient(135deg, #6366f1 0%, #a855f7 100%); padding: 40px 20px; text-align: center;">
                        <h1 style="color: white; margin: 0; font-size: 24px; font-weight: 600;">Assessment Invitation</h1>
                        <p style="color: rgba(255,255,255,0.9); margin-top: 10px; font-size: 16px;">Step into your future at ${companyName}</p>
                    </div>
                    
                    <div style="padding: 30px; background: white;">
                        <p style="font-size: 18px; margin-top: 0;">Hi <strong>${candidate.name}</strong>,</p>
                        
                        <p>We are excited to invite you to take the <strong>AI-powered Assessment</strong> for the <strong>${jobTitle}</strong> position. This is a critical next step in our selection process, designed to showcase your skills and potential.</p>
                        
                        <div style="background: #f8fafc; border-radius: 12px; padding: 25px; margin: 25px 0; border: 1px solid #e2e8f0;">
                            <h3 style="margin-top: 0; color: #4338ca; font-size: 16px; text-transform: uppercase; letter-spacing: 0.05em;">Assessment Details</h3>
                            
                            <table style="width: 100%; border-collapse: collapse;">
                                <tr>
                                    <td style="padding: 10px 0; color: #64748b; width: 140px;">Test Platform:</td>
                                    <td style="padding: 10px 0; font-weight: 600; color: #1e293b;">${platform}</td>
                                </tr>
                                <tr>
                                    <td style="padding: 10px 0; color: #64748b;">Verification Code:</td>
                                    <td style="padding: 10px 0; font-weight: 700; color: #4338ca; font-size: 20px; letter-spacing: 2px;">${verificationCode}</td>
                                </tr>
                                <tr>
                                    <td style="padding: 10px 0; color: #64748b;">Valid Until:</td>
                                    <td style="padding: 10px 0; font-weight: 600; color: #ef4444;">${expiresAt.toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}</td>
                                </tr>
                            </table>
                        </div>
                        
                        <div style="text-align: center; margin: 35px 0;">
                            <a href="${testPortalUrl}" style="background: #4338ca; color: white; padding: 16px 40px; text-decoration: none; border-radius: 8px; font-weight: 600; font-size: 16px; display: inline-block; box-shadow: 0 4px 6px -1px rgba(67, 56, 202, 0.2);">Start Your Assessment</a>
                        </div>
                        
                        <div style="background: #fffbeb; border-left: 4px solid #f59e0b; padding: 15px; margin: 20px 0; font-size: 14px; color: #92400e;">
                            <strong>Note:</strong> Please ensure you have a stable internet connection and a quiet environment before starting the test. Use the verification code provided above when prompted.
                        </div>
                        
                        <p>Best of luck! We look forward to seeing your results.</p>
                        <p style="margin-bottom: 0;">Regards,</p>
                        <p style="margin-top: 5px; font-weight: 600; color: #4338ca;">The ${companyName} Recruitment Team</p>
                    </div>
                </div>
            `;

            await sendEmail(
                candidate.email,
                `Assessment Invitation: ${jobTitle} at ${companyName}`,
                inviteHtml
            );
            console.log('[AtsCandidateService] Assessment invitation email sent to', candidate.email);
        } catch (mailErr) {
            console.warn('[AtsCandidateService] Failed to send assessment invitation email:', mailErr.message);
        }
    }
}

module.exports = AtsCandidateService;
