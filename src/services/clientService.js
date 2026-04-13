const { v4: uuidv4 } = require('uuid');
const db = require('../config/db');

/**
 * Creates a new client in the tenant database
 * @param {string} tenantDb 
 * @param {object} clientData 
 * @param {string} createdBy (UUID)
 */
const createClient = async (tenantDb, clientData, createdBy) => {
    const id = uuidv4();
    const idClean = id.replace(/-/g, '');
    const createdByClean = createdBy.replace(/-/g, '');
    
    // 1. Generate sequential code if not provided
    let code = clientData.code;
    if (!code) {
        const countResult = await db.query(`SELECT COUNT(*) as total FROM \`${tenantDb}\`.clients`, []);
        const nextNum = (countResult[0]?.total || 0) + 1;
        code = `CLIENT${nextNum.toString().padStart(3, '0')}`;
    }

    const query = `
        INSERT INTO \`${tenantDb}\`.clients (
            id, code, client_name, client_email, client_phone, 
            manager_name, manager_email, manager_phone, 
            status, created_by, created_at
        ) VALUES (
            UNHEX(?), ?, ?, ?, ?, 
            ?, ?, ?, 
            ?, UNHEX(?), NOW()
        )
    `;

    const params = [
        idClean,
        code,
        clientData.clientName,
        clientData.clientEmail || null,
        clientData.clientPhone || null,
        clientData.managerName || null,
        clientData.managerEmail || null,
        clientData.managerPhone || null,
        clientData.status || 'ACTIVE',
        createdByClean
    ];

    await db.query(query, params);
    return { id, code, ...clientData };
};

/**
 * Get all clients with pagination and simple filtering
 * @param {string} tenantDb 
 * @param {object} filters { limit, offset, searchTerm, status }
 */
const getClients = async (tenantDb, filters = {}) => {
    const { limit = 50, offset = 0, searchTerm, status } = filters;
    
    let whereClause = 'WHERE 1=1';
    const params = [];

    if (status && status !== 'ALL') {
        whereClause += ' AND status = ?';
        params.push(status);
    }

    if (searchTerm) {
        whereClause += ' AND (client_name LIKE ? OR code LIKE ? OR manager_name LIKE ?)';
        const searchPattern = `%${searchTerm}%`;
        params.push(searchPattern, searchPattern, searchPattern);
    }

    const countQuery = `SELECT COUNT(*) as total FROM \`${tenantDb}\`.clients ${whereClause}`;
    const countResult = await db.query(countQuery, params);
    const totalElements = countResult[0]?.total || 0;

    const query = `
        SELECT 
            HEX(id) as id, code, client_name as clientName, client_email as clientEmail, 
            client_phone as clientPhone, manager_name as managerName, 
            manager_email as managerEmail, manager_phone as managerPhone, 
            status, HEX(created_by) as createdBy, HEX(updated_by) as updatedBy,
            created_at as createdAt, updated_at as updatedAt
        FROM \`${tenantDb}\`.clients
        ${whereClause}
        ORDER BY created_at DESC
        LIMIT ? OFFSET ?
    `;
    
    const rows = await db.query(query, [...params, parseInt(limit), parseInt(offset)]);
    
    return {
        clients: rows,
        totalElements
    };
};

/**
 * Get client by ID
 */
const getClientById = async (tenantDb, clientId) => {
    const idClean = clientId.replace(/-/g, '');
    const query = `
        SELECT 
            HEX(id) as id, code, client_name as clientName, client_email as clientEmail, 
            client_phone as clientPhone, manager_name as managerName, 
            manager_email as managerEmail, manager_phone as managerPhone, 
            status, HEX(created_by) as createdBy, HEX(updated_by) as updatedBy,
            created_at as createdAt, updated_at as updatedAt
        FROM \`${tenantDb}\`.clients
        WHERE id = UNHEX(?)
    `;
    const rows = await db.query(query, [idClean]);
    return rows.length > 0 ? rows[0] : null;
};

/**
 * Update client details
 * @param {string} tenantDb
 * @param {string} clientId
 * @param {object} updateData
 * @param {string} updatedBy (UUID)
 */
const updateClient = async (tenantDb, clientId, updateData, updatedBy) => {
    const idClean = clientId.replace(/-/g, '');
    const updatedByClean = updatedBy.replace(/-/g, '');
    
    const query = `
        UPDATE \`${tenantDb}\`.clients SET 
            client_name = ?, client_email = ?, client_phone = ?, 
            manager_name = ?, manager_email = ?, manager_phone = ?, 
            status = ?, updated_by = UNHEX(?), updated_at = NOW()
        WHERE id = UNHEX(?)
    `;

    const params = [
        updateData.clientName,
        updateData.clientEmail || null,
        updateData.clientPhone || null,
        updateData.managerName || null,
        updateData.managerEmail || null,
        updateData.managerPhone || null,
        updateData.status || 'ACTIVE',
        updatedByClean,
        idClean
    ];

    return await db.query(query, params);
};

module.exports = {
    createClient,
    getClients,
    getClientById,
    updateClient
};
