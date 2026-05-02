const AtsCandidateService = require('../services/atsCandidateService');
const AtsCandidateModel = require('../models/atsCandidateModel');
const fileStorageUtil = require('../utils/fileStorageUtil');
const axios = require('axios');
const config = require('../config');
const db = require('../config/db');
const buildHttpsAgent = require('../utils/buildHttpsAgent');

exports.addCandidate = async (req, res, next) => {
    try {
        const organizationId = req.user?.organizationId || req.user?.organization_id || req.body.organization_id;
        if (!organizationId) {
            return res.status(400).json({ success: false, message: 'organization_id is required' });
        }

        // Handle File Upload if present
        let resumeUrl = req.body.resume_url || '';
        let resumeFilename = req.body.resume_filename || '';
        if (req.file) {
            try {
                const uploadResult = await fileStorageUtil.storeFile('Resume', req.file, {
                    tenantDb: req.tenantDb,
                    organizationId
                });
                resumeUrl = uploadResult.relativePath;
                resumeFilename = req.file.originalname;

                // AUTOMATIC EXTRACTION: Extract text from the uploaded file immediately
                try {
                    const extractService = require('../services/extractService');
                    // We use a temporary UUID for extraction linked to this job if provided
                    const tempCandidateId = uuidv4(); 
                    const extraction = await extractService.extractAndSaveResume(
                        req.tenantDb, 
                        tempCandidateId, 
                        req.body.job_id || req.body.jobId || 'GENERAL', 
                        organizationId, 
                        req.file.buffer, 
                        resumeFilename
                    );
                    
                    if (extraction && extraction.text) {
                        // Populate extractedJson with the newly extracted text
                        extractedJson = {
                            raw_text: extraction.text,
                            skills: extraction.keywords || [],
                            extracted_at: new Date().toISOString()
                        };
                        console.log(`[AtsCandidateController] Auto-extracted ${extraction.text.length} chars from uploaded resume`);
                    }
                } catch (extractErr) {
                    console.warn('[AtsCandidateController] Auto-extraction failed:', extractErr.message);
                }
            } catch (uploadErr) {
                console.warn('[AtsCandidateController] Failed to upload resume during creation:', uploadErr.message);
            }
        }

        // Parse JSON strings from multipart form
        let skills = req.body.skills;
        if (typeof skills === 'string') {
            try { skills = JSON.parse(skills); } catch (e) { skills = []; }
        }

        let extractedJson = req.body.extracted_json;
        if (typeof extractedJson === 'string') {
            try { extractedJson = JSON.parse(extractedJson); } catch (e) { extractedJson = null; }
        }

        const candidateData = {
            ...req.body,
            organization_id: organizationId,
            resume_url: resumeUrl,
            resume_filename: resumeFilename,
            skills: skills,
            extracted_json: extractedJson,
            source: (req.file || resumeUrl) ? 'RESUME' : (req.body.source || 'MANUAL')
        };

        const id = await AtsCandidateService.createCandidate(req.tenantDb, candidateData);

        // Trigger resume scoring automatically after creation (Synchronously so UI gets score)
        try {
            const streamingUrl = (config.streamingServiceUrl || config.aiServiceUrl || '').replace(/\/$/, '');
            console.log(`[AtsCandidateController] Starting automatic scoring for candidate ${id} at ${streamingUrl}`);
            
            if (streamingUrl && id) {
                // Fetch job description for better accuracy
                const jobIdClean = candidateData.job_id ? candidateData.job_id.replace(/-/g, '') : null;
                const jobRows = await db.query(
                    `SELECT job_title, job_description FROM \`${req.tenantDb}\`.\`jobs\` WHERE id = UNHEX(?)`,
                    [jobIdClean]
                );
                const job = jobRows[0] || {};

                const skillRows = await db.query(
                    `SELECT skill FROM \`${req.tenantDb}\`.\`job_mandatory_skills\` WHERE job_id = UNHEX(?)`,
                    [jobIdClean]
                );
                const jobSkills = skillRows.map(r => r.skill);
                job.skills = jobSkills;
                
                const payload = {
                    positionId: candidateData.job_id,
                    candidateId: id,
                    positionCandidateId: id,
                    tenantId: req.tenantDb,
                    resumeText: extractedJson?.raw_text || '',
                    jobDescriptionText: job.job_description || '',
                    skills: extractedJson?.skills || job.skills || [],
                    extractedData: extractedJson
                };

                console.log(`[AtsCandidateController] Calling ${streamingUrl}/resume-ats/calculate-score for candidate ${id}...`);

                const httpsAgent = buildHttpsAgent(streamingUrl);
                const scoreResponse = await axios.post(`${streamingUrl}/resume-ats/calculate-score`, payload, { timeout: 60000, httpsAgent });
                
                console.log(`[AtsCandidateController] Response Data: ${JSON.stringify(scoreResponse.data)}`);

                const overallScore = scoreResponse.data?.overallScore ?? null;
                if (overallScore !== null && jobIdClean) {
                    const idClean = id.replace(/-/g, '');
                    
                    // Fetch the dynamic AI scoring threshold from the organization's settings
                    const adminService = require('../services/adminService');
                    const aiConfig = await adminService.getAiScoringSettings(req.tenantDb, organizationId);
                    const rejectionThreshold = aiConfig?.resume?.rejection?.notSelected ?? 50;

                    // Check if candidate fails the rejection threshold
                    const isRejected = overallScore < rejectionThreshold;

                    let updateQuery = `UPDATE \`${req.tenantDb}\`.\`candidates_job\` SET resume_score = ? WHERE candidate_id = UNHEX(?) AND job_id = UNHEX(?)`;
                    let queryParams = [overallScore, idClean, jobIdClean];

                    if (isRejected) {
                        updateQuery = `UPDATE \`${req.tenantDb}\`.\`candidates_job\` SET resume_score = ?, stage = 'resume_rejected' WHERE candidate_id = UNHEX(?) AND job_id = UNHEX(?)`;
                        console.log(`[AtsCandidateController] Candidate ${id} scored ${overallScore} (below ${rejectionThreshold}). Updating stage to resume_rejected.`);
                    } else {
                        // NEW: Automatically move passing candidates to 'invitations' (Selected) stage
                        updateQuery = `UPDATE \`${req.tenantDb}\`.\`candidates_job\` SET resume_score = ?, stage = 'invitations' WHERE candidate_id = UNHEX(?) AND job_id = UNHEX(?)`;
                        console.log(`[AtsCandidateController] Candidate ${id} scored ${overallScore} (passes ${rejectionThreshold}). Automatically moving to invitations (Selected) stage.`);
                    }

                    // Now we update in the applications table (job-specific)
                    const updateResult = await db.query(updateQuery, queryParams);
                    console.log(`[AtsCandidateController] DB Update Result affectedRows: ${updateResult.affectedRows}`);
                    console.log(`[AtsCandidateController] Successfully updated job-specific score for application (Candidate: ${id}, Job: ${jobIdClean}): ${overallScore}`);
                } else if (!jobIdClean) {
                    console.warn(`[AtsCandidateController] Missing jobId for scoring update (Candidate: ${id})`);
                } else {
                    console.warn(`[AtsCandidateController] Scoring response missing overallScore (Candidate: ${id})`);
                }
            } else {
                console.warn(`[AtsCandidateController] Missing streamingUrl or candidateId for scoring. streamingUrl: ${streamingUrl}, candidateId: ${id}`);
            }
        } catch (e) {
            const errorData = e.response?.data || e.message;
            console.error(`[AtsCandidateController] Automatic scoring failed for candidate ${id}. Error:`, errorData);
            // Don't throw here, just proceed to return 201 so the UI creates the candidate successfully.
        }

        return res.status(201).json({ success: true, message: 'ATS Candidate created', data: { id } });
    } catch (error) {
        if (error.message.includes('credits') || error.creditError) {
            return res.status(402).json({ success: false, message: error.message });
        }
        next(error);
    }
};

exports.getCandidateById = async (req, res, next) => {
    try {
        const { candidateId } = req.params;
        const candidate = await AtsCandidateService.getCandidateById(req.tenantDb, candidateId);
        if (!candidate) {
            return res.status(404).json({ success: false, message: 'Candidate not found' });
        }
        res.status(200).json({ success: true, data: candidate });
    } catch (error) {
        next(error);
    }
};

exports.getApplicationByCandidateId = async (req, res, next) => {
    try {
        const { candidateId } = req.params;
        const organizationId = req.user?.organizationId || req.user?.organization_id || req.query.organization_id;
        const application = await AtsCandidateService.getApplicationByCandidateId(req.tenantDb, organizationId, candidateId);
        if (!application) {
            return res.status(404).json({ success: false, message: 'Application not found' });
        }
        res.status(200).json({ success: true, data: application });
    } catch (error) {
        next(error);
    }
};

exports.getCandidates = async (req, res, next) => {
    try {
        const organizationId = req.user?.organizationId || req.user?.organization_id || req.query.organization_id;
        const jobId = req.query.job_id || req.query.jobId;
        const stage = req.query.stage || null;
        const limit = parseInt(req.query.limit) || 10;
        const offset = parseInt(req.query.offset) || 0;
        const search = req.query.search || null;

        if (!organizationId) {
            return res.status(400).json({ success: false, message: 'organization_id is required' });
        }

        const { candidates, total } = await AtsCandidateService.getCandidates(
            req.tenantDb, organizationId, jobId, stage, limit, offset, search
        );

        // Optional: If filtered by job, fetch job title (for the banner)
        let jobTitle = null;
        if (jobId) {
            const jobIdClean = jobId.replace(/-/g, '');
            const [jobRows] = await db.query(`SELECT job_title FROM \`${req.tenantDb}\`.\`jobs\` WHERE id = UNHEX(?)`, [jobIdClean]);
            jobTitle = jobRows[0]?.job_title || null;
        }

        return res.status(200).json({
            success: true,
            data: candidates,
            totalElements: total,
            jobTitle
        });
    } catch (error) {
        next(error);
    }
};

exports.getStatusCounts = async (req, res, next) => {
    try {
        const organizationId = req.user?.organizationId || req.user?.organization_id || req.query.organization_id;
        const jobId = req.query.jobId || req.query.job_id;
        if (!organizationId) return res.status(400).json({ success: false, message: 'organization_id is required' });

        const statusCounts = await AtsCandidateModel.getStatusCounts(req.tenantDb, organizationId, jobId);
        return res.status(200).json({ success: true, data: statusCounts });
    } catch (error) {
        next(error);
    }
};

exports.uploadAndExtractResume = async (req, res, next) => {
    try {
        if (!req.file) {
            return res.status(400).json({ success: false, message: 'No file uploaded' });
        }

        // 1. Extract and Parse the resume
        // Prefer frontend-extracted text if provided (avoids backend extraction issues)
        const extractedText = req.body.extractedText;
        const extractedData = await AtsCandidateService.extractResume(req.file, extractedText);

        // 2. Upload file to cloud storage (optional, but requested so we have a URL)
        let resumeUrl = '';
        try {
            const organizationId = req.user?.organizationId || req.user?.organization_id || req.body.organizationId || req.body.organization_id;
            const uploadResult = await fileStorageUtil.storeFile('Resume', req.file, {
                tenantDb: req.tenantDb,
                organizationId
            });
            resumeUrl = uploadResult.relativePath;
        } catch (uploadErr) {
            console.warn('[AtsCandidateController] Failed to upload resume:', uploadErr.message);
        }

        return res.status(200).json({ 
            success: true, 
            message: 'Resume extracted successfully', 
            data: { 
                extracted: extractedData,
                resumeUrl,
                resumeFilename: req.file.originalname
            } 
        });
    } catch (error) {
        next(error);
    }
};

exports.updateCandidateStage = async (req, res, next) => {
    try {
        const { candidateId } = req.params;
        const { stage } = req.body;

        if (!candidateId || !stage) {
            return res.status(400).json({ success: false, message: 'candidateId and stage are required' });
        }

        console.log(`[AtsCandidateController] updateCandidateStage for ID/UUID: ${candidateId} to Stage: ${stage}`);
        
        let actualApplicationId = candidateId;
        const idClean = candidateId.replace(/-/g, '');
        
        // Resolve Application ID from global Candidate ID if necessary
        const dbRes = await db.query(
            `SELECT LOWER(BIN_TO_UUID(id)) as id FROM \`${req.tenantDb}\`.candidates_job WHERE candidate_id = UNHEX(?) OR id = UNHEX(?) LIMIT 1`,
            [idClean, idClean]
        );
        const appRow = Array.isArray(dbRes[0]) ? dbRes[0][0] : dbRes[0];

        if (appRow && appRow.id) {
            actualApplicationId = appRow.id;
            console.log(`[AtsCandidateController] Resolved ${candidateId} to Application ID ${actualApplicationId}`);
        }

        const actorData = {
            id: req.user?.id || req.headers['x-user-id'],
            name: req.user?.fullName || req.user?.name || 'Admin',
            role: req.user?.role || 'ADMIN'
        };

        console.log(`[AtsCandidateController] EXECUTE updateCandidateStage: ID=${actualApplicationId}, Stage=${stage}`);
        const updateResult = await AtsCandidateService.updateCandidateStage(req.tenantDb, actualApplicationId, stage, actorData);
        console.log(`[AtsCandidateController] Service Return:`, updateResult);
        
        return res.status(200).json({ success: true, message: 'Candidate stage updated successfully', updated: updateResult });
    } catch (error) {
        if (error.message.includes('not found')) {
            return res.status(404).json({ success: false, message: 'Candidate not found' });
        }
        next(error);
    }
};

exports.setupAssessment = async (req, res, next) => {
    try {
        const { candidateId } = req.params;
        if (!candidateId) {
            return res.status(400).json({ success: false, message: 'candidateId is required' });
        }

        const actorData = {
            id: req.user?.id || req.headers['x-user-id'],
            name: req.user?.fullName || req.user?.name || 'Admin',
            role: req.user?.role || 'ADMIN'
        };

        const result = await AtsCandidateService.setupAssessment(req.tenantDb, candidateId, actorData, req.body);
        
        return res.status(200).json(result);
    } catch (error) {
        next(error);
    }
};

exports.getJobStages = async (req, res, next) => {
    try {
        const organizationId = req.user?.organizationId || req.user?.organization_id || req.query.organization_id;
        if (!organizationId) {
            return res.status(400).json({ success: false, message: 'organization_id is required' });
        }

        const stages = await AtsCandidateService.getJobStages(req.tenantDb, organizationId);
        return res.status(200).json({ success: true, data: stages });
    } catch (error) {
        next(error);
    }
};

exports.createJobStage = async (req, res, next) => {
    try {
        const organizationId = req.user?.organizationId || req.user?.organization_id || req.body.organization_id;
        if (!organizationId) {
            return res.status(400).json({ success: false, message: 'organization_id is required' });
        }

        const title = String(req.body?.title || '').trim();
        if (!title) {
            return res.status(400).json({ success: false, message: 'title is required' });
        }

        const created = await AtsCandidateService.createJobStage(req.tenantDb, organizationId, {
            title,
            description: req.body?.description,
            icon: req.body?.icon,
            color: req.body?.color
        });

        return res.status(201).json({ success: true, data: created, message: 'Stage created successfully' });
    } catch (error) {
        next(error);
    }
};

/**
 * POST /admins/ats-candidates/:candidateId/score-resume
 * Uses the existing Streaming AI /resume-ats/score endpoint to compute ATS resume score.
 * Saves the score back to the ats_candidates record.
 */
exports.scoreResume = async (req, res, next) => {
    try {
        const { candidateId } = req.params;
        if (!candidateId) {
            return res.status(400).json({ success: false, message: 'candidateId is required' });
        }

        const streamingUrl = (config.streamingServiceUrl || config.aiServiceUrl || '').replace(/\/$/, '');
        if (!streamingUrl) {
            return res.status(503).json({
                success: false,
                message: 'Streaming AI service not configured. Set STREAMING_SERVICE_URL or AI_SERVICE_URL.'
            });
        }

        const organizationId = req.user?.organizationId || req.user?.organization_id;
        const tenantDb = req.tenantDb;

        // Fetch job_id for this candidate so we can pass a context to the Streaming service
        const idClean = candidateId.replace(/-/g, '');
        const query = `
            SELECT LOWER(BIN_TO_UUID(ja.id)) as id, LOWER(BIN_TO_UUID(ja.job_id)) as job_id, ja.resume_url, c.extracted_json
            FROM \`${tenantDb}\`.\`candidates_job\` ja
            JOIN \`candidates_db\`.\`ats_candidates\` c ON ja.candidate_id = c.id
            WHERE ja.id = UNHEX(?)
        `;
        const rows = await db.query(query, [idClean]);
        const candidate = rows[0];
        if (!candidate) {
            return res.status(404).json({ success: false, message: 'ATS Candidate not found' });
        }

        // Fetch job description from tenant DB
        const jobIdClean = candidate.job_id.replace(/-/g, '');
        const jobRows = await db.query(
            `SELECT job_title, job_description FROM \`${tenantDb}\`.\`jobs\` WHERE id = UNHEX(?)`,
            [jobIdClean]
        );
        const job = jobRows[0] || {};

        const skillRows = await db.query(
            `SELECT skill FROM \`${tenantDb}\`.\`job_mandatory_skills\` WHERE job_id = UNHEX(?)`,
            [jobIdClean]
        );
        job.skills = skillRows.map(r => r.skill);

        // Parse extracted_json if it's a string
        let extractedData = candidate.extracted_json || {};
        if (typeof extractedData === 'string') {
            try { extractedData = JSON.parse(extractedData); } catch (e) { extractedData = {}; }
        }

        // Call Streaming AI score endpoint with complete context
        let scoreResponse;
        try {
            const httpsAgent = buildHttpsAgent(streamingUrl);
            scoreResponse = await axios.post(
                `${streamingUrl}/resume-ats/calculate-score`,
                {
                    positionId: candidate.job_id,
                    candidateId: candidateId,
                    positionCandidateId: candidateId, // ATS uses candidateId as the link key
                    tenantId: tenantDb,
                    // Send complete content for accurate scoring
                    resumeText: extractedData.raw_text || '',
                    jobDescriptionText: job.job_description || job.description || '',
                    skills: extractedData.skills || job.skills || [],
                    extractedData: extractedData // Send the whole object just in case
                },
                { timeout: 60000, headers: { 'Content-Type': 'application/json' }, httpsAgent }
            );
        } catch (e) {
            const status = e.response?.status || 502;
            const msg = e.response?.data?.detail ?? e.response?.data?.message ?? e.message ?? 'Streaming AI unavailable';
            return res.status(status).json({ success: false, message: String(msg) });
        }

        const overallScore = scoreResponse.data?.overallScore ?? null;
        if (overallScore == null) {
            return res.status(502).json({ success: false, message: 'Invalid score response from Streaming AI' });
        }

        // Fetch dynamic AI scoring threshold
        const adminService = require('../services/adminService');
        const orgId = organizationId || candidate.organization_id;
        const aiConfig = await adminService.getAiScoringSettings(req.tenantDb, orgId);
        const rejectionThreshold = aiConfig?.resume?.rejection?.notSelected ?? 50;

        const isRejected = overallScore < rejectionThreshold;

        let updateQuery = `UPDATE \`${req.tenantDb}\`.\`candidates_job\` SET resume_score = ? WHERE id = UNHEX(?)`;
        let queryParams = [overallScore, idClean];

        if (isRejected) {
            updateQuery = `UPDATE \`${req.tenantDb}\`.\`candidates_job\` SET resume_score = ?, stage = 'resume_rejected' WHERE id = UNHEX(?)`;
        }

        // Save score to candidates_job (application-level)
        await db.query(updateQuery, queryParams);

        return res.status(200).json({
            success: true,
            message: 'ATS Resume score calculated and saved',
            data: {
                resumeScore: overallScore,
                categoryScores: scoreResponse.data?.categoryScores || {}
            }
        });
    } catch (error) {
        next(error);
    }
};

exports.deleteCandidate = async (req, res, next) => {
    try {
        const { candidateId } = req.params;
        const success = await AtsCandidateService.deleteCandidate(req.tenantDb, candidateId);
        if (!success) {
            return res.status(404).json({ success: false, message: 'Candidate not found' });
        }
        return res.status(200).json({ success: true, message: 'Candidate deleted successfully' });
    } catch (error) {
        next(error);
    }
};

exports.resendInvitation = async (req, res, next) => {
    try {
        const { candidateId } = req.params;
        const actorData = {
            id: req.user?.id || req.headers['x-user-id'],
            name: req.user?.fullName || req.user?.name || 'Admin',
            role: req.user?.role || 'ADMIN'
        };

        await AtsCandidateService.resendInvitation(req.tenantDb, candidateId, actorData);
        
        return res.status(200).json({ success: true, message: 'Invitation resent successfully' });
    } catch (error) {
        next(error);
    }
};
