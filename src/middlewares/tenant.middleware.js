const db = require('../config/db');

const tenantMiddleware = async (req, res, next) => {
    // 1. Initial extraction from all possible sources
    const userId = req.headers['x-user-id'] || req.headers['X-User-Id'] || req.headers['X-User-ID'] || req.user?.id;
    let tenantId =
        req.headers['x-user-cl'] ||
        req.headers['x-tenant-id'] ||
        req.headers['X-Tenant-Id'] ||
        req.user?.client ||
        req.cookies?.tenantDb ||
        req.query.tenantDb;

    console.log(`[TenantMiddleware] Initial extraction: tenantId=${tenantId}, userId=${userId}`);

    // 2. Fallback resolution if tenant is missing or points to auth_db (common for platform admins/new sessions)
    if (!tenantId || tenantId === 'auth_db' || tenantId === 'superadmin_db') {
        // Try resolving via organizationId first (useful for public/setup routes)
        const orgId = req.headers['x-organization-id'] || req.params.organizationId || req.params.orgId || req.query.organizationId || req.query.orgId || req.query.organization_id;
        
        if (orgId) {
            try {
                // Try direct string match first
                let orgs = await db.authQuery(
                    'SELECT client FROM users WHERE (organization_id = ? OR id = ?) AND client IS NOT NULL AND is_active = true LIMIT 1',
                    [orgId, orgId]
                );
                
                // If no result, try binary conversion (for BINARY(16) columns)
                if (orgs.length === 0 && orgId.length >= 32) {
                    try {
                        const cleanId = orgId.replace(/-/g, '');
                        if (cleanId.length === 32) {
                            const buffer = Buffer.from(cleanId, 'hex');
                            orgs = await db.authQuery(
                                'SELECT client FROM users WHERE organization_id = ? AND client IS NOT NULL AND is_active = true LIMIT 1',
                                [buffer]
                            );
                        }
                    } catch (e) {}
                }

                if (orgs.length > 0 && orgs[0].client) {
                    console.log(`[TenantMiddleware] Resolved missing tenant for org ${orgId} -> ${orgs[0].client}`);
                    tenantId = orgs[0].client;
                }
            } catch (err) {
                console.error(`[TenantMiddleware] Org fallback lookup failed for ${orgId}:`, err.message);
            }
        }

        // Try resolving via userId if still missing
        if (!tenantId && userId) {
            try {
                // Lookup the client schema in auth_db.users (explicit auth_db)
                const users = await db.authQuery(
                    'SELECT client FROM users WHERE id = ? AND is_active = true LIMIT 1',
                    [userId]
                );

                if (users.length > 0 && users[0].client) {
                    console.log(`[TenantMiddleware] Resolved missing tenant for user ${userId} -> ${users[0].client}`);
                    tenantId = users[0].client;
                } else {
                    console.log(`[TenantMiddleware] Fallback lookup returned no client for user ${userId}`);
                }
            } catch (err) {
                console.error(`[TenantMiddleware] Fallback lookup failed for user ${userId}:`, err.message);
            }
        } else if (!tenantId) {
            console.log(`[TenantMiddleware] No userId or valid orgId found for fallback resolution`);
        }
    }

    if (!tenantId) {
        console.warn(`[TenantMiddleware] Missing tenant identity for ${req.method} ${req.url}`);
        return res.status(400).json({
            success: false,
            message: 'Tenant identity (X-Tenant-Id, X-User-Cl, or cookie) is required'
        });
    }

    console.log(`[TenantMiddleware] Final tenantDb set to: ${tenantId}`);
    req.tenantDb = tenantId;
    next();
};

module.exports = tenantMiddleware;
