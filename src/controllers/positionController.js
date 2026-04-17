const positionService = require('../services/positionService');
const fileStorageUtil = require('../utils/fileStorageUtil');
const extractService = require('../services/extractService');

/**
 * Parse body for create (handles multipart string values)
 */
function parseCreateBody(body) {
    const mandatorySkills = body.mandatorySkills != null
        ? (typeof body.mandatorySkills === 'string' ? JSON.parse(body.mandatorySkills || '[]') : body.mandatorySkills)
        : [];
    const optionalSkills = body.optionalSkills != null
        ? (typeof body.optionalSkills === 'string' ? JSON.parse(body.optionalSkills || '[]') : body.optionalSkills)
        : [];
    return {
        title: body.title,
        domainType: body.domainType,
        minimumExperience: body.minimumExperience != null ? Number(body.minimumExperience) : 0,
        maximumExperience: body.maximumExperience != null ? Number(body.maximumExperience) : 0,
        noOfPositions: body.noOfPositions != null ? Number(body.noOfPositions) : 1,
        mandatorySkills,
        optionalSkills,
        jobDescriptionPath: body.jobDescriptionPath,
        jobDescriptionFileName: body.jobDescriptionFileName,
        expectedStartDate: body.expectedStartDate || null,
        applicationDeadline: body.applicationDeadline || null,
        company_name: body.companyName || body.company_name || null,
        jobDescriptionText: body.jobDescriptionText || null,
        createdBy: body.createdBy || 'SYSTEM'
    };
}

/**
 * Create a new position
 * POST /admins/positions
 * Accepts JSON or multipart/form-data; when file is present, stores JD and returns position with jobDescriptionDocumentPath set.
 */
exports.createPosition = async (req, res, next) => {
    try {
        const parsed = parseCreateBody(req.body);
        const {
            title,
            domainType,
            minimumExperience,
            maximumExperience,
            noOfPositions,
            mandatorySkills,
            optionalSkills,
            jobDescriptionPath,
            jobDescriptionFileName,
            expectedStartDate,
            applicationDeadline,
            company_name,
            jobDescriptionText,
            createdBy
        } = parsed;

        // Validate required fields
        if (!title || !domainType || !noOfPositions) {
            return res.status(400).json({
                success: false,
                message: 'Title, domainType, and noOfPositions are required'
            });
        }

        if (!mandatorySkills || !Array.isArray(mandatorySkills) || mandatorySkills.length < 2) {
            return res.status(400).json({
                success: false,
                message: 'At least 2 mandatory skills are required'
            });
        }

        const userId = req.headers['x-user-id'] || req.headers['X-User-Id'] || req.headers['X-User-ID'];
        const organizationId = req.user?.organizationId || req.user?.organization_id || req.body.organizationId || req.headers['x-organization-id'];
        
        const positionData = {
            title,
            domainType,
            minimumExperience: minimumExperience || 0,
            maximumExperience: maximumExperience || 0,
            noOfPositions,
            mandatorySkills,
            optionalSkills: optionalSkills || [],
            job_description_document_path: jobDescriptionPath,
            job_description_document_file_name: jobDescriptionFileName,
            expectedStartDate,
            applicationDeadline,
            company_name,
            createdBy: req.user?.id || createdBy,
            userId,
            organizationId,
            actorName: req.user?.fullName || req.user?.name || 'Admin',
            actorRole: 'Admin'
        };

        let result = await positionService.createPosition(req.tenantDb, positionData);

        // If JD text is provided, extract and save to jd_extract. 
        // Run asynchronously without awaiting to ensure rapid API response (prevents UI timeouts)
        if (jobDescriptionText && result && result.id) {
            extractService.extractAndSaveJdFromText(req.tenantDb, result.id, organizationId, jobDescriptionText)
                .catch(err => console.warn('JD text extract async on create failed:', err.message));
        }

        // Global notification trigger for new job (background)
        const { getDb, COLLECTIONS } = require('../config/mongo');
        getDb().then(mongoDb => {
            mongoDb.collection(COLLECTIONS.NOTIFICATIONS).insertOne({
                title: 'New Job Posted!',
                message: `A new position for "${result.title || 'Job'}" has been added. Check it out now!`,
                type: 'global',
                createdAt: new Date(),
                dismissed: false
            }).catch(e => console.warn('Global notification trigger failed:', e.message));
        }).catch(err => console.warn('Mongo connection for notification failed:', err.message));



        return res.status(201).json({
            success: true,
            message: 'Position created successfully',
            data: result
        });
    } catch (error) {
        // Handle credit error specifically
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
 * Get all positions
 * GET /admins/positions
 */
exports.getPositions = async (req, res, next) => {
    try {
        const { status, search, page = 0, size = 10, domain, experience } = req.query;
        const userId = req.headers['x-user-id'] || req.headers['X-User-Id'] || req.headers['X-User-ID'];

        const filters = {
            status,
            search,
            page: parseInt(page) || 0,
            size: parseInt(size) || 10,
            userId,
            domain,
            experience,
            createdBy: req.user?.dataFilter?.createdBy || req.query.createdBy
        };

        const { positions, totalElements } = await positionService.getPositions(req.tenantDb, filters);

        const totalPages = Math.ceil(totalElements / filters.size);

        return res.status(200).json({
            content: positions,
            page: filters.page,
            size: filters.size,
            totalElements: totalElements,
            totalPages: totalPages,
            last: (filters.page + 1) >= totalPages
        });
    } catch (error) {
        next(error);
    }
};

/**
 * Get position by ID
 * GET /admins/positions/:positionId
 */
exports.getPositionById = async (req, res, next) => {
    try {
        const { positionId } = req.params;

        if (!positionId) {
            return res.status(400).json({
                success: false,
                message: 'Position ID is required'
            });
        }

        const userId = req.headers['x-user-id'] || req.headers['X-User-Id'] || req.headers['X-User-ID'];
        const result = await positionService.getPositionById(req.tenantDb, positionId, userId);

        return res.status(200).json({
            success: true,
            message: 'Position retrieved successfully',
            data: result
        });
    } catch (error) {
        if (error.status === 404) {
            return res.status(404).json({
                success: false,
                message: error.message
            });
        }
        next(error);
    }
};

/**
 * Update position status
 * PUT /admins/positions/:positionId/status
 */
exports.updatePositionStatus = async (req, res, next) => {
    try {
        const { positionId } = req.params;
        const { status } = req.body;

        if (!positionId) {
            return res.status(400).json({
                success: false,
                message: 'Position ID is required'
            });
        }

        if (!status) {
            return res.status(400).json({
                success: false,
                message: 'Status is required'
            });
        }

        const userId = req.headers['x-user-id'] || req.headers['X-User-Id'] || req.headers['X-User-ID'];
        const result = await positionService.updatePositionStatus(req.tenantDb, positionId, status, userId);

        return res.status(200).json({
            success: true,
            message: `Position status updated to ${status}`,
            data: result
        });
    } catch (error) {
        if (error.status === 400 || error.status === 404) {
            return res.status(error.status).json({
                success: false,
                message: error.message
            });
        }
        next(error);
    }
};

/**
 * Update position
 * PATCH /admins/positions/:positionId
 */
exports.updatePosition = async (req, res, next) => {
    try {
        const { positionId } = req.params;

        if (!positionId) {
            return res.status(400).json({
                success: false,
                message: 'Position ID is required'
            });
        }

        const userId = req.headers['x-user-id'] || req.headers['X-User-Id'] || req.headers['X-User-ID'];
        const result = await positionService.updatePosition(req.tenantDb, positionId, req.body, userId);

        // If jobDescriptionText is updated, re-extract
        if (req.body.jobDescriptionText && positionId) {
            try {
                const organizationId = req.user?.organizationId || req.user?.organization_id || req.body.organizationId || req.headers['x-organization-id'];
                if (organizationId && req.tenantDb) {
                    await extractService.extractAndSaveJdFromText(req.tenantDb, positionId, organizationId, req.body.jobDescriptionText);
                }
            } catch (extractErr) {
                console.warn('JD text extract on update failed:', extractErr.message);
            }
        }

        return res.status(200).json({
            success: true,
            message: 'Position updated successfully',
            data: result
        });
    } catch (error) {
        if (error.status === 400 || error.status === 404) {
            return res.status(error.status).json({
                success: false,
                message: error.message
            });
        }
        next(error);
    }
};
/**
 * Get position counts by status
 * GET /admins/positions/counts
 */
exports.getPositionCounts = async (req, res, next) => {
    try {
        const userId = req.headers['x-user-id'] || req.headers['X-User-Id'] || req.headers['X-User-ID'];
        const createdBy = req.user?.dataFilter?.createdBy || req.query.createdBy;
        const counts = await positionService.getPositionCounts(req.tenantDb, userId, { createdBy });

        return res.status(200).json({
            success: true,
            data: counts
        });
    } catch (error) {
        next(error);
    }
};

/**
 * Get dynamic filter metadata
 * GET /admins/positions/filters
 */
exports.getFilterMetadata = async (req, res, next) => {
    try {
        const userId = req.headers['x-user-id'] || req.headers['X-User-Id'] || req.headers['X-User-ID'];
        const createdBy = req.user?.dataFilter?.createdBy || req.query.createdBy;
        const metadata = await positionService.getFilterMetadata(req.tenantDb, userId, { createdBy });

        return res.status(200).json({
            success: true,
            data: metadata
        });
    } catch (error) {
        next(error);
    }
};

/**
 * Upload job description document for a position.
 * POST /admins/positions/:positionId/job-description (multipart file)
 * Stores file to blob; runs extract JD keywords and saves to jd_extract. Returns message + path + jdExtracted for UI.
 * Client must PUT position with path to persist. Send organizationId in body for extract.
 */
exports.uploadJobDescription = async (req, res, next) => {
    try {
        const { positionId } = req.params;
        const file = req.file;
        const organizationId = req.body.organizationId || req.body.organization_id;
        if (!file) {
            return res.status(400).json({
                success: false,
                message: 'Job description file is required'
            });
        }
        const { relativePath } = await fileStorageUtil.storeFile('JD', file, {
            tenantDb: req.tenantDb,
            organizationId
        });
        const fileName = file.originalname || 'document.pdf';

        let jdExtracted = false;
        let keywordsCount = 0;
        if (organizationId && req.tenantDb && file.buffer) {
            try {
                const extractResult = await extractService.extractAndSaveJd(req.tenantDb, positionId, organizationId, file.buffer, fileName);
                jdExtracted = true;
                keywordsCount = extractResult.keywordsCount ?? 0;
            } catch (extractErr) {
                console.warn('JD extract after upload failed (file saved):', extractErr.message);
            }
        }

        return res.status(200).json({
            success: true,
            message: 'Job description uploaded successfully',
            data: {
                jobDescriptionDocumentPath: relativePath,
                jobDescriptionDocumentFileName: fileName,
                jdExtracted,
                keywordsCount
            }
        });
    } catch (err) {
        if (err.status === 400) return res.status(400).json({ success: false, message: err.message });
        if (err.status === 404) return res.status(404).json({ success: false, message: err.message });
        next(err);
    }
};

/**
 * Download job description document for a position.
 * GET /admins/positions/:positionId/job-description
 */
exports.downloadJobDescription = async (req, res, next) => {
    try {
        const { positionId } = req.params;
        const { buffer, filename } = await positionService.getJobDescriptionDocument(req.tenantDb, positionId);
        const contentType = fileStorageUtil.getContentType(filename);
        res.setHeader('Content-Type', contentType);
        res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
        return res.send(buffer);
    } catch (err) {
        if (err.status === 404) return res.status(404).json({ success: false, message: err.message });
        next(err);
    }
};
