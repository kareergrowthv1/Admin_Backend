const questionSectionService = require('../services/questionSectionService');

/**
 * Question Section Controller
 */

exports.createQuestionSection = async (req, res, next) => {
    try {
        const { questionSetId } = req.query;
        if (!questionSetId) {
            return res.status(400).json({ success: false, message: 'questionSetId is required in query params' });
        }

        const userId = req.headers['x-user-id'] || req.headers['X-User-Id'] || req.headers['X-User-ID'];
        const result = await questionSectionService.createQuestionSection(req.tenantDb, questionSetId, req.body, userId);
        res.status(201).json({
            status: 'success',
            message: 'Question section created successfully',
            data: result
        });
    } catch (error) {
        next(error);
    }
};

exports.getQuestionSectionById = async (req, res, next) => {
    try {
        const { id } = req.params;
        const userId = req.headers['x-user-id'] || req.headers['X-User-Id'] || req.headers['X-User-ID'];
        const result = await questionSectionService.getQuestionSectionById(req.tenantDb, id, userId);
        if (!result) {
            return res.status(404).json({ success: false, message: 'Question section not found' });
        }
        res.status(200).json({
            status: 'success',
            message: 'Question section retrieved successfully',
            data: result
        });
    } catch (error) {
        next(error);
    }
};

exports.getSectionsByQuestionSetId = async (req, res, next) => {
    try {
        const { questionSetId } = req.params;
        const userId = req.headers['x-user-id'] || req.headers['X-User-Id'] || req.headers['X-User-ID'];
        const result = await questionSectionService.getQuestionSectionsByQuestionSetId(req.tenantDb, questionSetId, userId);
        res.status(200).json({
            status: 'success',
            message: 'Question sections retrieved successfully',
            data: result
        });
    } catch (error) {
        next(error);
    }
};

exports.updateQuestionSection = async (req, res, next) => {
    try {
        const { id } = req.params;
        const userId = req.headers['x-user-id'] || req.headers['X-User-Id'] || req.headers['X-User-ID'];
        const result = await questionSectionService.updateQuestionSection(req.tenantDb, id, req.body, userId);
        if (!result) {
            return res.status(404).json({ success: false, message: 'Question section not found' });
        }
        res.status(200).json({
            status: 'success',
            message: 'Question section updated successfully',
            data: result
        });
    } catch (error) {
        next(error);
    }
};

exports.deleteQuestionSection = async (req, res, next) => {
    try {
        const { id } = req.params;
        const userId = req.headers['x-user-id'] || req.headers['X-User-Id'] || req.headers['X-User-ID'];
        await questionSectionService.deleteQuestionSection(req.tenantDb, id, userId);
        res.status(204).end();
    } catch (error) {
        next(error);
    }
};
