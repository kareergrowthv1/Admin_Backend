const interviewInstructionsService = require('../services/interviewInstructionsService');

/**
 * Assessment Instructions Controller
 */

exports.saveInstructions = async (req, res, next) => {
    try {
        const userId = req.headers['x-user-id'] || req.headers['X-User-Id'] || req.headers['X-User-ID'];
        const result = await interviewInstructionsService.saveInstructions(req.tenantDb, req.body, userId);
        res.status(201).json({
            success: true,
            status: 'success',
            message: 'Instructions saved successfully',
            data: result
        });
    } catch (error) {
        next(error);
    }
};

exports.getInstructionsById = async (req, res, next) => {
    try {
        const { id } = req.params;
        const userId = req.headers['x-user-id'] || req.headers['X-User-Id'] || req.headers['X-User-ID'];
        const result = await interviewInstructionsService.getInstructionsById(req.tenantDb, id, userId);
        if (!result) {
            return res.status(404).json({
                success: false,
                status: 'error',
                message: 'Instructions not found'
            });
        }
        res.status(200).json({
            success: true,
            status: 'success',
            message: 'Instructions retrieved successfully',
            data: result
        });
    } catch (error) {
        next(error);
    }
};

exports.getByQuestionSetId = async (req, res, next) => {
    try {
        const { questionSetId } = req.params;
        const userId = req.headers['x-user-id'] || req.headers['X-User-Id'] || req.headers['X-User-ID'];
        const result = await interviewInstructionsService.getInstructionsByQuestionSetId(req.tenantDb, questionSetId, userId);
        if (result.length === 0) {
            return res.status(404).json({
                success: false,
                status: 'error',
                message: 'Instructions not found for this question set'
            });
        }
        // Reference project returns a single active instruction usually, but service returns list
        res.status(200).json({
            success: true,
            status: 'success',
            message: 'Instructions retrieved successfully',
            data: result[0]
        });
    } catch (error) {
        next(error);
    }
};

exports.updateByQuestionSetId = async (req, res, next) => {
    try {
        const { questionSetId } = req.params;
        const existing = await interviewInstructionsService.getInstructionsByQuestionSetId(req.tenantDb, questionSetId);
        if (existing.length === 0) {
            return res.status(404).json({
                success: false,
                status: 'error',
                message: 'Instructions not found'
            });
        }
        const userId = req.headers['x-user-id'] || req.headers['X-User-Id'] || req.headers['X-User-ID'];
        const result = await interviewInstructionsService.updateInstructions(req.tenantDb, existing[0].id, req.body, userId);
        res.status(200).json({
            success: true,
            status: 'success',
            message: 'Instructions updated successfully',
            data: result
        });
    } catch (error) {
        next(error);
    }
};
