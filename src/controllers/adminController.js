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

        // 2. Automatically provision schema (Create DB + Tables)
        try {
            console.log(`[AdminController] Triggering auto-provisioning for userId: ${result.userId}`);
            await adminService.provisionAdminSchema(result.userId);
            console.log(`[AdminController] Auto-provisioning successful for userId: ${result.userId}`);
        } catch (provisionError) {
            console.error('[AdminController] Auto-provisioning failed:', provisionError);
            // We return 201 because the user was created, but add a warning
            return res.status(201).json({
                success: true,
                message: 'Admin user created successfully, but auto-provisioning failed. Please provision manually.',
                data: result,
                provisionError: provisionError.message
            });
        }

        return res.status(201).json({
            success: true,
            message: 'Admin user created and provisioned successfully',
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
        console.log(`[getCredits CONTROLLER] userId=${organizationId}, tenantDb=${req.tenantDb}, userClient=${req.user?.client}, userIsCollege=${req.user?.isCollege}`);
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
        
        // 1. Check if it's an ATS account (req.user.isCollege is false or missing roleId)
        // If an ATS account accidentally ends up here, serve company details instead
        if (req.user && req.user.isCollege === false) {
            console.warn(`[AdminController] Redirecting college-details GET to company-details for ATS Org=${organizationId}`);
            return exports.getCompanyDetails(req, res, next);
        }

        // 2. Try fetching college details
        const result = await adminService.getCollegeDetails(req.tenantDb, organizationId);
        
        // 3. Robust fallback: If college details not found, try company details (some tenants might have both or wrong persona flags)
        if (!result) {
            const companyResult = await adminService.getCompanyDetails(req.tenantDb, organizationId);
            if (companyResult) {
                console.log(`[AdminController] Fallback: Found company details for ${organizationId}, returning that instead.`);
                return res.status(200).json({
                    success: true,
                    message: 'Organization details retrieved successfully (ATS fallback)',
                    data: companyResult,
                    persona: 'ATS'
                });
            }
        }

        if (!result) {
            return res.status(404).json({ success: false, message: `Organization details not found for ${organizationId} in database ${req.tenantDb}` });
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
        
        if (req.user && req.user.isCollege === false) {
            console.warn(`[AdminController] Redirecting college-details PUT to company-details for ATS Org=${organizationId}`);
            return exports.updateCompanyDetails(req, res, next);
        }

        // Check if college_details table exists, if not, try updating company_details
        const tableCheck = await adminService.getCollegeDetails(req.tenantDb, organizationId);
        if (!tableCheck) {
            const companyCheck = await adminService.getCompanyDetails(req.tenantDb, organizationId);
            if (companyCheck) {
                console.log(`[AdminController] Fallback UPDATE: Redirecting to company-details for ${organizationId}`);
                return exports.updateCompanyDetails(req, res, next);
            }
        }

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

        if (req.user && req.user.isCollege === true) {
            console.warn(`[AdminController] Redirecting company-details GET to college-details for College Org=${organizationId}`);
            return exports.getCollegeDetails(req, res, next);
        }

        const result = await adminService.getCompanyDetails(req.tenantDb, organizationId);
        if (!result) {
            return res.status(404).json({ success: false, message: `Company details not found for organization ${organizationId} in database ${req.tenantDb}` });
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

        if (req.user && req.user.isCollege === true) {
            console.warn(`[AdminController] Redirecting company-details PUT to college-details for College Org=${organizationId}`);
            return exports.updateCollegeDetails(req, res, next);
        }

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

exports.getOrganizationInfo = async (req, res, next) => {
    try {
        const { organizationId } = req.params;
        const result = await adminService.getOrganizationInfo(organizationId);
        if (!result) {
            return res.status(404).json({ success: false, message: 'Organization not found' });
        }

        // Enrichment: If the user is authenticated, provide their current flags for session sync
        if (req.user) {
            result.isAdmin = req.user.role === 'ADMIN' || req.user.role === 'SUPERADMIN';
            result.isPlatformAdmin = req.user.role === 'SUPERADMIN';
            // We can add subscription check here if needed, or rely on service
        }

        return res.status(200).json({
            success: true,
            data: result
        });
    } catch (error) {
        next(error);
    }
};
