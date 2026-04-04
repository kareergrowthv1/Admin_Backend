const EmailTemplateModel = require('../models/emailTemplateModel');

exports.createTemplate = async (req, res, next) => {
    try {
        const organizationId = req.user?.organizationId || req.user?.organization_id;
        const tenantDb = req.tenantDb;
        if (!organizationId) return res.status(400).json({ success: false, message: 'Organization ID is required' });
        if (!tenantDb) return res.status(400).json({ success: false, message: 'Tenant DB is required' });

        const { name, to_field, subject, body, cc } = req.body;
        if (!name || !subject || !body) return res.status(400).json({ success: false, message: 'Name, Subject and Body are required' });

        const id = await EmailTemplateModel.create(tenantDb, organizationId, { name, to_field, subject, body, cc });
        res.status(201).json({ success: true, data: { id } });
    } catch (error) {
        next(error);
    }
};

exports.getAllTemplates = async (req, res, next) => {
    try {
        const organizationId = req.user?.organizationId || req.user?.organization_id;
        const tenantDb = req.tenantDb;
        if (!organizationId) return res.status(400).json({ success: false, message: 'Organization ID is required' });
        if (!tenantDb) return res.status(400).json({ success: false, message: 'Tenant DB is required' });

        const templates = await EmailTemplateModel.getAllByOrg(tenantDb, organizationId);
        res.status(200).json({ success: true, data: templates });
    } catch (error) {
        next(error);
    }
};

exports.updateTemplate = async (req, res, next) => {
    try {
        const { id } = req.params;
        const organizationId = req.user?.organizationId || req.user?.organization_id;
        const tenantDb = req.tenantDb;
        if (!organizationId) return res.status(400).json({ success: false, message: 'Organization ID is required' });
        if (!tenantDb) return res.status(400).json({ success: false, message: 'Tenant DB is required' });

        const { name, to_field, subject, body, cc } = req.body;
        const success = await EmailTemplateModel.update(tenantDb, id, organizationId, { name, to_field, subject, body, cc });
        if (!success) return res.status(404).json({ success: false, message: 'Template not found' });

        res.status(200).json({ success: true, message: 'Template updated successfully' });
    } catch (error) {
        next(error);
    }
};

exports.deleteTemplate = async (req, res, next) => {
    try {
        const { id } = req.params;
        const organizationId = req.user?.organizationId || req.user?.organization_id;
        const tenantDb = req.tenantDb;
        if (!organizationId) return res.status(400).json({ success: false, message: 'Organization ID is required' });
        if (!tenantDb) return res.status(400).json({ success: false, message: 'Tenant DB is required' });

        const success = await EmailTemplateModel.delete(tenantDb, id, organizationId);
        if (!success) return res.status(404).json({ success: false, message: 'Template not found' });

        res.status(200).json({ success: true, message: 'Template deleted successfully' });
    } catch (error) {
        next(error);
    }
};
