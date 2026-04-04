const clientService = require('../services/clientService');

/**
 * Create a new client
 */
exports.createClient = async (req, res, next) => {
    try {
        const tenantDb = req.tenantDb;
        const createdBy = req.user.id || req.user.userId;
        const clientData = req.body;
        
        if (!clientData.clientName) {
            return res.status(400).json({ success: false, message: 'Client name is required' });
        }

        const result = await clientService.createClient(tenantDb, clientData, createdBy);
        return res.status(201).json({ success: true, data: result });
    } catch (error) {
        next(error);
    }
};

/**
 * Get all clients with filters
 */
exports.getClients = async (req, res, next) => {
    try {
        const tenantDb = req.tenantDb;
        const filters = {
            limit: parseInt(req.query.limit) || 50,
            offset: parseInt(req.query.offset) || 0,
            searchTerm: req.query.searchTerm,
            status: req.query.status
        };

        const result = await clientService.getClients(tenantDb, filters);
        return res.status(200).json({ 
            success: true, 
            data: result.clients,
            totalElements: result.totalElements,
            limit: filters.limit,
            offset: filters.offset
        });
    } catch (error) {
        next(error);
    }
};

/**
 * Get client by ID
 */
exports.getClientById = async (req, res, next) => {
    try {
        const tenantDb = req.tenantDb;
        const { clientId } = req.params;
        
        const client = await clientService.getClientById(tenantDb, clientId);
        if (!client) {
            return res.status(404).json({ success: false, message: 'Client not found' });
        }
        
        return res.status(200).json({ success: true, data: client });
    } catch (error) {
        next(error);
    }
};

/**
 * Update client
 */
exports.updateClient = async (req, res, next) => {
    try {
        const tenantDb = req.tenantDb;
        const { clientId } = req.params;
        const updateData = req.body;
        const updatedBy = req.user.id || req.user.userId;
        
        await clientService.updateClient(tenantDb, clientId, updateData, updatedBy);
        return res.status(200).json({ success: true, message: 'Client updated successfully' });
    } catch (error) {
        next(error);
    }
};
