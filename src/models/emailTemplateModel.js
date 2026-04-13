const db = require('../config/db');
const { v4: uuidv4 } = require('uuid');

class EmailTemplateModel {
    static async create(tenantDb, organizationId, data) {
        const id = uuidv4();
        const { name, to_field, subject, body, cc } = data;
        const query = `
            INSERT INTO \`${tenantDb}\`.email_templates (id, organization_id, name, to_field, subject, body, cc)
            VALUES (?, ?, ?, ?, ?, ?, ?)
        `;
        await db.query(query, [id, organizationId, name, to_field, subject, body, cc]);
        return id;
    }

    static async getAllByOrg(tenantDb, organizationId) {
        const query = `SELECT * FROM \`${tenantDb}\`.email_templates WHERE organization_id = ? ORDER BY created_at DESC`;
        return await db.query(query, [organizationId]);
    }

    static async getById(tenantDb, id, organizationId) {
        const query = `SELECT * FROM \`${tenantDb}\`.email_templates WHERE id = ? AND organization_id = ?`;
        const rows = await db.query(query, [id, organizationId]);
        return rows[0];
    }

    static async update(tenantDb, id, organizationId, data) {
        const { name, to_field, subject, body, cc } = data;
        const query = `
            UPDATE \`${tenantDb}\`.email_templates 
            SET name = ?, to_field = ?, subject = ?, body = ?, cc = ?, updated_at = CURRENT_TIMESTAMP
            WHERE id = ? AND organization_id = ?
        `;
        const result = await db.query(query, [name, to_field, subject, body, cc, id, organizationId]);
        return result.affectedRows > 0;
    }

    static async delete(tenantDb, id, organizationId) {
        const query = `DELETE FROM \`${tenantDb}\`.email_templates WHERE id = ? AND organization_id = ?`;
        const result = await db.query(query, [id, organizationId]);
        return result.affectedRows > 0;
    }
}

module.exports = EmailTemplateModel;
