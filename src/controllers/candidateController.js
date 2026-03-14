const candidateService = require('../services/candidateService');

/**
 * Get candidates assigned to a specific position
 * GET /admins/positions/:positionId/candidates
 */
exports.getCandidatesByPosition = async (req, res, next) => {
    try {
        const { positionId } = req.params;
        const { limit = 5, offset = 0 } = req.query;

        if (!positionId) {
            return res.status(400).json({
                success: false,
                message: 'Position ID is required'
            });
        }

        const userId = req.headers['x-user-id'] || req.headers['X-User-Id'] || req.headers['X-User-ID'];
        const result = await candidateService.getCandidatesByPosition(
            req.tenantDb,
            positionId,
            limit,
            offset,
            userId
        );

        return res.status(200).json({
            success: true,
            data: result
        });
    } catch (error) {
        next(error);
    }
};
