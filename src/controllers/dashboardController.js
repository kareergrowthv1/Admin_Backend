const DashboardService = require('../services/dashboardService');

/**
 * Controller for Dashboard Analytics
 */
exports.getDashboardStats = async (req, res, next) => {
    try {
        const organizationId = req.user?.organizationId || req.user?.organization_id || req.query.organizationId;
        if (!organizationId) {
            return res.status(400).json({ success: false, message: 'organizationId is required' });
        }

        const filters = {
            actorId: req.user?.dataFilter?.createdBy || null
        };

        const stats = await DashboardService.getStats(req.tenantDb, organizationId, filters);
        res.status(200).json({ success: true, data: stats });
    } catch (error) {
        next(error);
    }
};

exports.getDashboardTrends = async (req, res, next) => {
    try {
        const organizationId = req.user?.organizationId || req.user?.organization_id || req.query.organizationId;
        if (!organizationId) {
            return res.status(400).json({ success: false, message: 'organizationId is required' });
        }

        const filters = {
            actorId: req.user?.dataFilter?.createdBy || null
        };

        const trends = await DashboardService.getTrends(req.tenantDb, organizationId, filters);
        res.status(200).json({ success: true, data: trends });
    } catch (error) {
        next(error);
    }
};

exports.getTeamPerformance = async (req, res, next) => {
    try {
        const organizationId = req.user?.organizationId || req.user?.organization_id || req.query.organizationId;
        if (!organizationId) {
            return res.status(400).json({ success: false, message: 'organizationId is required' });
        }
        const filters = {
            actorId: req.user?.dataFilter?.createdBy || null
        };

        const performance = await DashboardService.getTeamPerformance(req.tenantDb, organizationId, filters);
        res.status(200).json({ success: true, data: performance });
    } catch (error) {
        next(error);
    }
};

exports.getRecentGrid = async (req, res, next) => {
    try {
        const organizationId = req.user?.organizationId || req.user?.organization_id || req.query.organizationId;
        if (!organizationId) {
            return res.status(400).json({ success: false, message: 'organizationId is required' });
        }
        const isCollege = req.user?.isCollege || req.query.isCollege === 'true';

        const gridData = await DashboardService.getRecentItemsGrid(req.tenantDb, organizationId, isCollege);
        res.status(200).json({ success: true, data: gridData });
    } catch (error) {
        next(error);
    }
};
exports.getCandidateStatus = async (req, res, next) => {
    try {
        const organizationId = req.user?.organizationId || req.user?.organization_id || req.query.organizationId;
        if (!organizationId) {
            return res.status(400).json({ success: false, message: 'organizationId is required' });
        }
        const data = await DashboardService.getCandidateStatusCounts(req.tenantDb, organizationId);
        res.status(200).json({ success: true, data });
    } catch (error) {
        next(error);
    }
};
