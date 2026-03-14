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
        if (userId) {
            try {
                // Lookup the client schema in auth_db.users (explicit auth_db)
                const users = await db.authQuery(
                    'SELECT client FROM auth_db.users WHERE id = ? AND is_active = true LIMIT 1',
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
        } else {
            console.log(`[TenantMiddleware] No userId header found for fallback resolution`);
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
