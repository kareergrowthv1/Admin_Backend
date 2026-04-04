const rbacService = require('../services/rbacService');

exports.getRoles = async (req, res, next) => {
    try {
        const { orgId } = req.params;
        const createdBy = req.user?.dataFilter?.createdBy || req.query.createdBy;
        const roles = await rbacService.getRolesByOrganization(orgId, createdBy);
        res.status(200).json({ success: true, data: roles });
    } catch (error) {
        next(error);
    }
};

exports.createRole = async (req, res, next) => {
    try {
        const { orgId } = req.params;
        const creatorId = req.user?.id;
        const role = await rbacService.createRole(orgId, req.body, creatorId);
        res.status(201).json({ success: true, data: role });
    } catch (error) {
        next(error);
    }
};

exports.getUsers = async (req, res, next) => {
    try {
        const { orgId } = req.params;
        const createdBy = req.user?.dataFilter?.createdBy || req.query.createdBy;
        const isCollege = req.user?.isCollege === true;
        const users = await rbacService.getUsersByOrganization(orgId, createdBy, req.tenantDb, isCollege);
        res.status(200).json({ success: true, data: users });
    } catch (error) {
        next(error);
    }
};

exports.createUser = async (req, res, next) => {
    try {
        const { orgId } = req.params;
        const creatorId = req.user?.id;
        // The admin creating the user should pass their own client schema to the sub-user
        const userData = {
            ...req.body,
            client: req.user?.client // Ensure sub-users share the same tenant DB
        };
        const user = await rbacService.createUser(orgId, userData, creatorId);
        res.status(201).json({ success: true, data: user });
    } catch (error) {
        next(error);
    }
};

exports.updateUser = async (req, res, next) => {
    try {
        const { orgId, userId } = req.params;
        await rbacService.updateUser(orgId, userId, req.body);
        res.status(200).json({ success: true, message: 'User updated successfully' });
    } catch (error) {
        next(error);
    }
};

exports.getFeatures = async (req, res, next) => {
    try {
        const features = await rbacService.getFeatures();
        
        // Modules to strictly remove (unused/unwanted across the board)
        const unwanted = [
            'vendors', 'clients', 'interviews', 'ai_tests', 
            'reports', 'audit_logs', 'integration', 'applications'
        ];

        let filtered = features.filter(f => !unwanted.includes(f.feature_key.toLowerCase()));

        const isCollege = req.user?.isCollege === true;

        if (isCollege) {
            // College Admin see 'Positions'
            // Ensure any 'jobs' feature is hidden if it exists separately
            filtered = filtered.filter(f => f.feature_key.toLowerCase() !== 'jobs');
        } else {
            // ATS Admin see 'Jobs'
            // Rename 'positions' to 'jobs' if it's the primary recruitment module
            filtered = filtered.map(f => {
                if (f.feature_key.toLowerCase() === 'positions') {
                    return { ...f, feature_key: 'jobs', name: 'Jobs' };
                }
                return f;
            });
        }

        res.status(200).json({ success: true, data: filtered });
    } catch (error) {
        next(error);
    }
};

exports.getRolePermissions = async (req, res, next) => {
    try {
        const { roleId } = req.params;
        const permissions = await rbacService.getRolePermissions(roleId);
        res.status(200).json({ success: true, data: permissions });
    } catch (error) {
        next(error);
    }
};

exports.updateRolePermissions = async (req, res, next) => {
    try {
        const { roleId } = req.params;
        const { permissions, name, description, status } = req.body;
        await rbacService.updateRolePermissions(roleId, permissions, { name, description, status });
        res.status(200).json({ success: true, message: 'Role and permissions updated successfully' });
    } catch (error) {
        next(error);
    }
};
