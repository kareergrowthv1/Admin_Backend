const adminService = require('../services/adminService');

exports.createAdmin = async (req, res, next) => {
    try {
        const {
            email,
            password,
            firstName,
            lastName,
            phoneNumber,
            clientName,
            validTill = null,
            roleId
        } = req.body;

        // Validate required fields
        if (!email || !password || !clientName) {
            const error = new Error('Email, password, and clientName are required');
            error.status = 400;
            throw error;
        }

        const result = await adminService.createAdminWithDB({
            email,
            password,
            firstName,
            lastName,
            phoneNumber,
            clientName,
            roleId
        });

        return res.status(201).json({
            success: true,
            message: 'Admin user created successfully',
            data: result
        });
    } catch (error) {
        next(error);
    }
};

exports.provisionAdmin = async (req, res, next) => {
    try {
        const { adminId } = req.body;
        if (!adminId) {
            return res.status(400).json({
                success: false,
                message: 'Admin ID is required'
            });
        }

        const result = await adminService.provisionAdminSchema(adminId);
        return res.status(200).json(result);
    } catch (error) {
        next(error);
    }
};

exports.getCredits = async (req, res, next) => {
    try {
        const { organizationId } = req.params;  // NOTE: despite the name, this is the user's ID (not org ID)
        console.log(`[getCredits CONTROLLER] req.tenantDb=${req.tenantDb}, userId=${organizationId}, user.client=${req.user?.client}, user.isCollege=${req.user?.isCollege}`);
        const result = await adminService.getCredits(req.tenantDb, organizationId, req.user);
        return res.status(200).json({
            success: true,
            data: result
        });
    } catch (error) {
        next(error);
    }
};

exports.getCreditHistory = async (req, res, next) => {
    try {
        const { organizationId } = req.params;
        const result = await adminService.getCreditHistory(req.tenantDb, organizationId);
        return res.status(200).json({
            success: true,
            data: result
        });
    } catch (error) {
        next(error);
    }
};

exports.forgotPassword = async (req, res, next) => {
    try {
        const { email } = req.body;
        const result = await adminService.requestPasswordReset(email);
        return res.status(200).json(result);
    } catch (error) {
        next(error);
    }
};

exports.resetPassword = async (req, res, next) => {
    try {
        const { email, otp, newPassword } = req.body;
        const result = await adminService.resetPassword(email, otp, newPassword);
        return res.status(200).json(result);
    } catch (error) {
        next(error);
    }
};
exports.getCollegeDetails = async (req, res, next) => {
    try {
        const { organizationId } = req.params;
        const result = await adminService.getCollegeDetails(req.tenantDb, organizationId);
        if (!result) {
            return res.status(404).json({ success: false, message: 'College details not found' });
        }
        return res.status(200).json({
            success: true,
            message: 'College retrieved successfully',
            data: result
        });
    } catch (error) {
        next(error);
    }
};

exports.updateCollegeDetails = async (req, res, next) => {
    try {
        const { organizationId } = req.params;
        await adminService.updateCollegeDetails(req.tenantDb, organizationId, req.body);
        return res.status(200).json({
            success: true,
            message: 'College details updated successfully'
        });
    } catch (error) {
        next(error);
    }
};

exports.getCompanyDetails = async (req, res, next) => {
    try {
        const { organizationId } = req.params;
        const result = await adminService.getCompanyDetails(req.tenantDb, organizationId);
        if (!result) {
            return res.status(404).json({ success: false, message: 'Company details not found' });
        }
        return res.status(200).json({
            success: true,
            message: 'Company retrieved successfully',
            data: result
        });
    } catch (error) {
        next(error);
    }
};

exports.updateCompanyDetails = async (req, res, next) => {
    try {
        const { organizationId } = req.params;
        await adminService.updateCompanyDetails(req.tenantDb, organizationId, req.body);
        return res.status(200).json({
            success: true,
            message: 'Company details updated successfully'
        });
    } catch (error) {
        next(error);
    }
};

exports.getAiScoringSettings = async (req, res, next) => {
    try {
        const { organizationId } = req.params;
        const result = await adminService.getAiScoringSettings(req.tenantDb, organizationId);
        return res.status(200).json({
            success: true,
            message: 'AI Scoring settings retrieved successfully',
            data: result
        });
    } catch (error) {
        next(error);
    }
};

exports.updateAiScoringSettings = async (req, res, next) => {
    try {
        const { organizationId } = req.params;
        await adminService.updateAiScoringSettings(req.tenantDb, organizationId, req.body);
        return res.status(200).json({
            success: true,
            message: 'AI Scoring settings updated successfully'
        });
    } catch (error) {
        next(error);
    }
};

exports.getCrossQuestionSettings = async (req, res, next) => {
    try {
        const { organizationId } = req.params;
        const result = await adminService.getCrossQuestionSettings(req.tenantDb, organizationId);
        return res.status(200).json({
            success: true,
            message: 'Cross question settings retrieved successfully',
            data: result
        });
    } catch (error) {
        next(error);
    }
};

exports.updateCrossQuestionSettings = async (req, res, next) => {
    try {
        const { organizationId } = req.params;
        await adminService.updateCrossQuestionSettings(req.tenantDb, organizationId, req.body);
        return res.status(200).json({
            success: true,
            message: 'Cross question settings updated successfully'
        });
    } catch (error) {
        next(error);
    }
};
