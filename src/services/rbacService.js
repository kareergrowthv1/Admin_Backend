const db = require('../config/db');
const { v4: uuidv4 } = require('uuid');
const bcrypt = require('bcryptjs');

/**
 * RBAC Service for managing roles, users and permissions in auth_db
 */
class RBACService {
    constructor() {
        this._schemaEnsured = false;
    }

    async ensureSchema() {
        if (this._schemaEnsured) return;

        // Ensure roles table has required columns
        const roleCols = await db.authQuery(
            `SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS 
             WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'roles'`
        );
        const existingRoleCols = roleCols.map(c => c.COLUMN_NAME.toLowerCase());

        if (!existingRoleCols.includes('created_by')) {
            await db.authQuery('ALTER TABLE roles ADD COLUMN created_by CHAR(36) NULL AFTER organization_id');
        }
        if (!existingRoleCols.includes('updated_by')) {
            await db.authQuery('ALTER TABLE roles ADD COLUMN updated_by CHAR(36) NULL AFTER created_by');
        }

        // Ensure users table has required columns
        const userCols = await db.authQuery(
            `SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS 
             WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'users'`
        );
        const existingUserCols = userCols.map(c => c.COLUMN_NAME.toLowerCase());

        if (!existingUserCols.includes('updated_by')) {
            await db.authQuery('ALTER TABLE users ADD COLUMN updated_by CHAR(36) NULL AFTER created_by');
        }

        this._schemaEnsured = true;
    }

    // Roles
    async getRolesByOrganization(organizationId, createdBy = null) {
        let query = 'SELECT * FROM roles WHERE organization_id = ? AND deleted_at IS NULL';
        const params = [organizationId];

        if (createdBy) {
            query += ' AND created_by = ?';
            params.push(createdBy);
        }

        query += ' ORDER BY created_at DESC';
        const roles = await db.authQuery(query, params);

        // Enrich roles with permission scopes
        const enrichedRoles = await Promise.all(roles.map(async (role) => {
            const permsData = await this.getRolePermissions(role.id);
            return {
                ...role,
                permissions_scopes: permsData.role.permissions
            };
        }));

        return enrichedRoles;
    }

    async createRole(organizationId, roleData, creatorId = null) {
        const { name, description, isSystem = 0, permissions } = roleData;
        const id = uuidv4();

        // Hosted environments can be behind on migrations; ensure this once before inserts.
        await this.ensureSchema();

        // Auto-generate code e.g., ROLE0001
        const latestRoleRows = await db.authQuery(
            "SELECT code FROM roles WHERE organization_id = ? AND code LIKE 'ROLE%' ORDER BY CAST(SUBSTRING(code, 5) AS UNSIGNED) DESC LIMIT 1",
            [organizationId]
        );
        let finalCode = 'ROLE0001';
        if (latestRoleRows.length > 0 && latestRoleRows[0].code) {
            const currentNum = parseInt(latestRoleRows[0].code.substring(4), 10);
            if (!isNaN(currentNum)) {
                finalCode = `ROLE${String(currentNum + 1).padStart(4, '0')}`;
            }
        }

        await db.authQuery(
            `INSERT INTO roles (id, organization_id, created_by, code, name, description, is_system, is_active, created_at, updated_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, 1, NOW(), NOW())`,
            [id, organizationId, creatorId, finalCode, name, description, isSystem]
        );

        // Atomic transaction: Insert permissions if provided
        if (permissions && permissions.length > 0) {
            await this.updateRolePermissions(id, permissions);
        }

        // Return the full newly created role object including its rich permissions
        const permsData = await this.getRolePermissions(id);
        
        return { 
            id, 
            organizationId, 
            code: finalCode, 
            name, 
            description,
            permissions_scopes: permsData.role.permissions
        };
    }

    // Users (Admins for specific organization)
    async getUsersByOrganization(organizationId, createdBy = null, tenantDb = null, isCollege = false) {
        let candidatesSubquery = '0';
        let positionsSubquery = '0';
        let studentsSubquery = '0';
        let tasksSubquery = '0';

        if (tenantDb) {
            try {
                const tableCheck = await db.query(
                    `SELECT TABLE_NAME FROM INFORMATION_SCHEMA.TABLES 
                     WHERE TABLE_SCHEMA = ? AND TABLE_NAME IN ('jobs', 'positions', 'job_candidates', 'candidate_positions', 'position_candidates', 'tasks')`,
                    [tenantDb]
                );
                const existingTables = (tableCheck || []).map(t => t.TABLE_NAME);

                const positionsTable = existingTables.includes('jobs') ? 'jobs' : (existingTables.includes('positions') ? 'positions' : null);
                const candidateTable = existingTables.includes('job_candidates') ? 'job_candidates' :
                                       (existingTables.includes('candidate_positions') ? 'candidate_positions' :
                                       (existingTables.includes('position_candidates') ? 'position_candidates' : null));

                if (positionsTable) {
                    positionsSubquery = `(SELECT COUNT(*) FROM \`${tenantDb}\`.\`${positionsTable}\` p WHERE p.created_by = u.id)`;
                }
                if (candidateTable) {
                    // Only use created_by if it exists on the candidate table
                    try {
                        const colCheck = await db.query(
                            `SELECT COUNT(*) as cnt FROM INFORMATION_SCHEMA.COLUMNS 
                             WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ? AND COLUMN_NAME = 'created_by'`,
                            [tenantDb, candidateTable]
                        );
                        if (colCheck[0]?.cnt > 0) {
                            candidatesSubquery = `(SELECT COUNT(*) FROM \`${tenantDb}\`.\`${candidateTable}\` pc WHERE pc.created_by = u.id)`;
                        }
                    } catch (colErr) {
                        console.warn('[rbacService] Column check failed:', colErr.message);
                    }
                }
                if (existingTables.includes('tasks')) {
                    tasksSubquery = `(SELECT COUNT(*) FROM \`${tenantDb}\`.tasks t WHERE t.created_by = u.id)`;
                }

                // Students subquery: only for college orgs
                if (isCollege) {
                    const ccCheck = await db.query(
                        `SELECT COUNT(*) as cnt FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_SCHEMA = 'candidates_db' AND TABLE_NAME = 'college_candidates'`
                    );
                    if (ccCheck[0]?.cnt > 0) {
                        studentsSubquery = `(SELECT COUNT(*) FROM candidates_db.college_candidates cc 
                                             WHERE (cc.candidate_created_by = u.id OR (cc.candidate_created_by IS NULL AND r.code = 'ROLE0003'))
                                             AND cc.organization_id = u.organization_id)`;
                    }
                }
            } catch (subqueryErr) {
                console.warn('[rbacService] Subquery build failed, using defaults:', subqueryErr.message);
            }
        }

        let query = `SELECT u.id, u.email, u.username, u.first_name, u.last_name, u.phone_number, 
                            u.is_active, u.is_admin, u.role_id, r.name as role_name, r.code as role_code,
                            u.created_at, u.updated_at, u.created_by, u.updated_by,
                            ${positionsSubquery} as positions_count,
                            ${candidatesSubquery} as candidates_count,
                            ${studentsSubquery} as students_count,
                            ${tasksSubquery} as tasks_count
                     FROM users u
                     LEFT JOIN roles r ON u.role_id = r.id
                     WHERE u.organization_id = ? AND u.deleted_at IS NULL`;
        const params = [organizationId];

        if (createdBy) {
            query += ' AND u.created_by = ?';
            params.push(createdBy);
        }

        query += ' ORDER BY u.created_at DESC';
        return await db.authQuery(query, params);
    }

    async createUser(organizationId, userData, creatorId = null) {
        const { 
            email, password, firstName, lastName, phoneNumber, roleId, isAdmin = 0, client 
        } = userData;

        // Check if user exists
        const existing = await db.authQuery('SELECT id FROM users WHERE email = ? AND deleted_at IS NULL', [email]);
        if (existing.length > 0) {
            throw new Error('Email already exists');
        }

        const id = uuidv4();
        const passwordHash = await bcrypt.hash(password, 12);

        await db.authQuery(
            `INSERT INTO users (
                id, organization_id, created_by, email, username, password_hash, first_name, last_name, 
                phone_number, role_id, is_admin, client, is_active, enabled, 
                created_at, updated_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, 1, NOW(), NOW())`,
            [id, organizationId, creatorId, email, email, passwordHash, firstName, lastName, phoneNumber, roleId, isAdmin, client]
        );

        return { id, organizationId, email, firstName, lastName, roleId };
    }

    async updateUser(organizationId, userId, userData, updaterId = null) {
        await this.ensureSchema();
        const updates = [];
        const params = [];

        for (const [key, value] of Object.entries(userData)) {
            if (value !== undefined && value !== null && value !== '') {
                let dbKey = key;
                let dbValue = value;

                if (key === 'firstName') dbKey = 'first_name';
                else if (key === 'lastName') dbKey = 'last_name';
                else if (key === 'isActive') dbKey = 'is_active';
                else if (key === 'phoneNumber') dbKey = 'phone_number';
                else if (key === 'roleId') dbKey = 'role_id';
                else if (key === 'password') {
                    dbKey = 'password_hash';
                    dbValue = await bcrypt.hash(value, 12);
                } else if (key === 'username') dbKey = 'username';
                else if (key === 'email') dbKey = 'email';
                else if (key === 'isAdmin') dbKey = 'is_admin';
                else if (key === 'client') dbKey = 'client';
                else continue; // Skip unknown fields to prevent SQL errors

                updates.push(`${dbKey} = ?`);
                params.push(dbValue);
            }
        }

        if (updates.length === 0) return { success: true };

        if (updaterId) {
            updates.push('updated_by = ?');
            params.push(updaterId);
        }

        updates.push('updated_at = NOW()');
        params.push(userId, organizationId);

        await db.authQuery(
            `UPDATE users SET ${updates.join(', ')} WHERE id = ? AND organization_id = ?`,
            params
        );
        return { success: true };
    }

    // Permissions
    async getFeatures() {
        return await db.authQuery('SELECT * FROM features WHERE is_active = 1 ORDER BY display_order ASC');
    }

    async getRolePermissions(roleId) {
        const roleRows = await db.authQuery('SELECT name, description, is_active FROM roles WHERE id = ?', [roleId]);
        
        const rows = await db.authQuery(
            `SELECT rfp.*, f.feature_key, f.name as feature_name
             FROM role_feature_permissions rfp
             JOIN features f ON rfp.feature_id = f.id
             WHERE rfp.role_id = ?`,
            [roleId]
        );

        const permissions = rows.map(row => ({
            ...row,
            data_scope: row.data_scope || 'ALL',
            dashboard_options: row.dashboard_options ? JSON.parse(JSON.stringify(row.dashboard_options)) : null,
            permissions: {
                read: (row.permissions & 1) !== 0,
                create: (row.permissions & 2) !== 0,
                update: (row.permissions & 4) !== 0,
                delete: (row.permissions & 8) !== 0,
                export: (row.permissions & 16) !== 0,
                import: (row.permissions & 32) !== 0,
                show: (row.permissions & 64) !== 0,
                score: (row.permissions & 128) !== 0,
                bulk: (row.permissions & 256) !== 0
            }
        }));

        return {
            role: {
                id: roleId,
                name: roleRows[0]?.name || 'User',
                description: roleRows[0]?.description || '',
                is_active: roleRows[0]?.is_active || 1,
                permissions: permissions
            }
        };
    }

    async updateRolePermissions(roleId, permissions, metadata = {}, updaterId = null) {
        await this.ensureSchema();
        // 1. Update Role Metadata if provided
        if (metadata.name || metadata.description || metadata.status) {
            const updates = [];
            const params = [];
            
            if (metadata.name) {
                updates.push('name = ?');
                params.push(metadata.name);
            }
            if (metadata.description !== undefined) {
                updates.push('description = ?');
                params.push(metadata.description);
            }
            if (metadata.status) {
                updates.push('is_active = ?');
                params.push(metadata.status === 'Active' ? 1 : 0);
            }
            if (updaterId) {
                updates.push('updated_by = ?');
                params.push(updaterId);
            }
            
            if (updates.length > 0) {
                updates.push('updated_at = NOW()');
                params.push(roleId);
                await db.authQuery(
                    `UPDATE roles SET ${updates.join(', ')} WHERE id = ?`,
                    params
                );
            }
        }

        // 2. Update Permissions
        await db.authQuery('DELETE FROM role_feature_permissions WHERE role_id = ?', [roleId]);
        
        if (permissions && permissions.length > 0) {
            for (const p of permissions) {
                const id = uuidv4();
                await db.authQuery(
                    `INSERT INTO role_feature_permissions (id, role_id, feature_id, permissions, data_scope, dashboard_options, created_at, updated_at)
                     VALUES (?, ?, ?, ?, ?, ?, NOW(), NOW())`,
                    [id, roleId, p.featureId, p.permissionsBitmask, p.dataScope || 'ALL', p.dashboardOptions ? JSON.stringify(p.dashboardOptions) : null]
                );
            }
        }
        return { success: true };
    }
}

module.exports = new RBACService();
