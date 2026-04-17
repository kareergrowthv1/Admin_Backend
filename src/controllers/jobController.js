const jobService = require('../services/jobService');
const fileStorageUtil = require('../utils/fileStorageUtil');
const extractService = require('../services/extractService');

/**
 * Create a new job
 * POST /admins/jobs
 * Accepts JSON or multipart/form-data
 */
exports.createJob = async (req, res, next) => {
    try {
        const body = req.body;
        
        // Parse skills if they are strings (from multipart)
        const mandatorySkills = body.mandatorySkills 
            ? (typeof body.mandatorySkills === 'string' ? JSON.parse(body.mandatorySkills) : body.mandatorySkills)
            : [];
        const optionalSkills = body.optionalSkills 
            ? (typeof body.optionalSkills === 'string' ? JSON.parse(body.optionalSkills) : body.optionalSkills)
            : [];
        const selectedVendors = body.selectedVendors 
            ? (typeof body.selectedVendors === 'string' ? JSON.parse(body.selectedVendors) : body.selectedVendors)
            : [];

        const jobData = {
            jobTitle: body.jobTitle,
            jobRole: body.jobRole,
            jobDescription: body.jobDescription,
            clientId: body.clientId,
            priorityLevel: body.priorityLevel,
            noOfPositions: body.noOfPositions != null ? Number(body.noOfPositions) : 1,
            offeredCtc: body.offeredCtc != null ? Number(body.offeredCtc) : null,
            salaryRange: body.salaryRange,
            experienceRequired: body.experienceRequired,
            location: body.location,
            jobType: body.jobType,
            managerDetails: body.managerDetails,
            spocId: body.spocId,
            spocName: body.spocName,
            spocEmail: body.spocEmail,
            spocPhone: body.spocPhone,
            applicationDeadline: body.applicationDeadline,
            expectedStartDate: body.expectedStartDate,
            showToVendor: body.showToVendor != null ? (body.showToVendor === 'true' || body.showToVendor === true || body.showToVendor === 1 || body.showToVendor === '1' ? 1 : 0) : 0,
            internalNotes: body.internalNotes,
            mandatorySkills,
            optionalSkills,
            selectedVendors,
            userId: req.headers['x-user-id'],
            organizationId: req.user?.organizationId || req.user?.organization_id || req.body.organizationId,
            actorName: req.user?.fullName || req.user?.name || 'Admin',
            actorRole: 'ATS',
            createdBy: req.user?.id || req.headers['x-user-id']
        };

        // Handle JD file upload if present
        if (req.file) {
            try {
                const { relativePath } = await fileStorageUtil.storeFile('JD', req.file, {
                    tenantDb: req.tenantDb,
                    organizationId: jobData.organizationId
                });
                jobData.jobDescriptionDocumentPath = relativePath;
                jobData.jobDescriptionDocumentFileName = req.file.originalname || 'document.pdf';
            } catch (storeErr) {
                console.warn('[JobController] JD store failed:', storeErr.message);
            }
        }

        const result = await jobService.createJob(req.tenantDb, jobData);

        // Trigger JD extraction if text is provided (for AI analysis)
        if (body.jobDescriptionText && result.id) {
            try {
                await extractService.extractAndSaveJdFromText(
                    req.tenantDb,
                    result.id,
                    jobData.organizationId,
                    body.jobDescriptionText
                );
            } catch (extractErr) {
                console.warn('[JobController] JD extraction failed:', extractErr.message);
            }
        }

        return res.status(201).json({
            success: true,
            message: 'Job created successfully',
            data: result
        });
    } catch (error) {
        if (error.creditError) {
            return res.status(402).json({
                success: false,
                message: error.message,
                code: 'INSUFFICIENT_CREDITS'
            });
        }
        next(error);
    }
};

/**
 * Get all jobs
 * GET /admins/jobs
 */
exports.getJobs = async (req, res, next) => {
    try {
        const filters = {
            status: req.query.status,
            clientId: req.query.clientId,
            limit: req.query.limit,
            offset: req.query.offset
        };
        const { jobs, totalElements } = await jobService.getJobs(req.tenantDb, filters);
        const totalPages = Math.ceil(totalElements / (parseInt(filters.limit) || 50));

        return res.status(200).json({ 
            success: true, 
            data: jobs,
            totalElements,
            totalPages,
            page: parseInt(req.query.page) || 0
        });
    } catch (error) {
        next(error);
    }
};

/**
 * Get jobs counts by status
 * GET /admins/jobs/counts
 */
exports.getJobsCounts = async (req, res, next) => {
    try {
        const filters = {
            createdBy: req.query.createdBy
        };
        const counts = await jobService.getJobsCounts(req.tenantDb, filters);
        return res.status(200).json({ success: true, data: counts });
    } catch (error) {
        next(error);
    }
};

/**
 * Get job by ID
 * GET /admins/jobs/:jobId
 */
exports.getJobById = async (req, res, next) => {
    try {
        const { jobId } = req.params;
        const job = await jobService.getJobById(req.tenantDb, jobId);
        if (!job) {
            return res.status(404).json({ success: false, message: 'Job not found' });
        }
        return res.status(200).json({ success: true, data: job });
    } catch (error) {
        next(error);
    }
};

/**
 * Get clients for dropdown
 * GET /admins/jobs/clients
 */
exports.getClients = async (req, res, next) => {
    try {
        const clients = await jobService.getClients(req.tenantDb);
        return res.status(200).json({ success: true, data: clients });
    } catch (error) {
        next(error);
    }
};

/**
 * Upload job description document for a job.
 * POST /admins/jobs/:jobId/job-description (multipart file)
 */
exports.uploadJobDescription = async (req, res, next) => {
    try {
        const { jobId } = req.params;
        const file = req.file;
        if (!file) {
            return res.status(400).json({ success: false, message: 'Job description file is required' });
        }
        const organizationId = req.body.organizationId || req.body.organization_id;
        const { relativePath } = await fileStorageUtil.storeFile('JD', file, {
            tenantDb: req.tenantDb,
            organizationId
        });
        const fileName = file.originalname || 'document.pdf';

        // Update job with path (reusing service or direct update)
        await jobService.updateJobPathOnly(req.tenantDb, jobId, relativePath, fileName);

        // Also trigger extraction from file if uploaded
        if (organizationId && req.tenantDb && file.buffer) {
            try {
                await extractService.extractAndSaveJd(req.tenantDb, jobId, organizationId, file.buffer, fileName);
            } catch (extractErr) {
                console.warn('[JobController] JD file extract failed:', extractErr.message);
            }
        }

        return res.status(200).json({
            success: true,
            message: 'Job description uploaded successfully',
            data: {
                jobDescriptionDocumentPath: relativePath,
                jobDescriptionDocumentFileName: fileName
            }
        });
    } catch (error) {
        next(error);
    }
};

/**
 * Download job description document for a job.
 * GET /admins/jobs/:jobId/job-description
 */
exports.downloadJobDescription = async (req, res, next) => {
    try {
        const { jobId } = req.params;
        const { buffer, filename } = await jobService.getJobDescriptionDocument(req.tenantDb, jobId);
        const contentType = fileStorageUtil.getContentType(filename);
        res.setHeader('Content-Type', contentType);
        res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
        return res.send(buffer);
    } catch (error) {
        next(error);
    }
};
/**
 * Update job status
 * PUT /admins/jobs/:jobId/status
 */
exports.updateJobStatus = async (req, res, next) => {
    try {
        const { jobId } = req.params;
        const { status } = req.body;
        if (!status) return res.status(400).json({ success: false, message: 'Status is required' });
        await jobService.updateJobStatus(req.tenantDb, jobId, status);
        return res.status(200).json({ success: true, message: 'Status updated successfully' });
    } catch (error) {
        next(error);
    }
};

/**
 * Update job visibility
 * PUT /admins/jobs/:jobId/visibility
 */
exports.updateJobVisibility = async (req, res, next) => {
    try {
        const { jobId } = req.params;
        const { showToVendor } = req.body;
        await jobService.updateJobVisibility(req.tenantDb, jobId, showToVendor);
        return res.status(200).json({ success: true, message: 'Visibility updated successfully' });
    } catch (error) {
        next(error);
    }
};

/**
 * Update custom Kanban stages configuration for a job
 * PUT /admins/jobs/:jobId/stages
 */
exports.updateJobStages = async (req, res, next) => {
    try {
        const { jobId } = req.params;
        const { stages } = req.body;
        if (!stages || !Array.isArray(stages)) {
            return res.status(400).json({ success: false, message: 'valid stages array is required' });
        }
        await jobService.updateJobStages(req.tenantDb, jobId, stages);
        return res.status(200).json({ success: true, message: 'Job stages updated successfully' });
    } catch (error) {
        next(error);
    }
};
