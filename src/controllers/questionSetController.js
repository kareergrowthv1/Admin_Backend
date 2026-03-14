const questionSetService = require('../services/questionSetService');

/**
 * Question Set Controller
 */

exports.createQuestionSet = async (req, res, next) => {
    try {
        const { positionId, jobId } = req.body;
        if (!positionId && !jobId) {
            return res.status(400).json({ success: false, message: 'positionId or jobId is required' });
        }

        const userId = req.headers['x-user-id'] || req.headers['X-User-Id'] || req.headers['X-User-ID'];
        const data = {
            ...req.body,
            userId,
            createdBy: req.user?.id || req.body.createdBy || 'SYSTEM'
        };

        const result = await questionSetService.createQuestionSet(req.tenantDb, data);
        res.status(201).json({ success: true, message: 'Question set created successfully', data: result });
    } catch (error) {
        next(error);
    }
};

exports.getQuestionSets = async (req, res, next) => {
    try {
        const { page = 0, size = 10, status, positionId, jobId } = req.query;
        const filters = {
            page: parseInt(page),
            size: parseInt(size),
            status,
            positionId,
            jobId
        };

        const userId = req.headers['x-user-id'] || req.headers['X-User-Id'] || req.headers['X-User-ID'];
        const result = await questionSetService.getQuestionSets(req.tenantDb, filters, userId);

        // Match Java response structure
        res.status(200).json({
            success: true,
            message: result.totalElements === 0 ? 'No question sets found' : 'Question sets retrieved successfully',
            content: result.content,
            page: result.page,
            size: result.size,
            totalElements: result.totalElements,
            totalPages: Math.ceil(result.totalElements / result.size)
        });
    } catch (error) {
        next(error);
    }
};

exports.getQuestionSetById = async (req, res, next) => {
    try {
        const { id } = req.params;
        const userId = req.headers['x-user-id'] || req.headers['X-User-Id'] || req.headers['X-User-ID'];
        const result = await questionSetService.getQuestionSetById(req.tenantDb, id, userId);
        if (!result) {
            return res.status(404).json({ success: false, message: 'Question set not found' });
        }
        res.status(200).json({ success: true, data: result });
    } catch (error) {
        next(error);
    }
};

exports.updateQuestionSet = async (req, res, next) => {
    try {
        const { id } = req.params;
        const userId = req.headers['x-user-id'] || req.headers['X-User-Id'] || req.headers['X-User-ID'];
        const result = await questionSetService.updateQuestionSet(req.tenantDb, id, req.body, userId);
        if (!result) {
            return res.status(404).json({ success: false, message: 'Question set not found' });
        }
        res.status(200).json({ success: true, message: 'Question set updated successfully', data: result });
    } catch (error) {
        next(error);
    }
};
