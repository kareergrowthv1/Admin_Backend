const db = require('../config/db');

/**
 * RBAC Middleware for Data Access Scope Enforcement
 * @param {string} featureKey - The key of the feature (e.g., 'positions', 'candidates')
 */
const rbacMiddleware = (featureKey) => {
    return async (req, res, next) => {
        try {
            const { roleId, id: userId, role: roleName } = req.user;

            // 1. Check for known Administrator roles (hardcoded bypass for speed & reliability)
            // ROLE0003 is the code for Administrator in some tenants.
            if (roleName === 'Super Administrator' || roleName === 'Administrator' || roleName === 'ADMIN' || roleName === 'ROLE0003') {
                req.user.dataScope = 'ALL';
                return next();
            }

            // 2. Try resolving from JWT permissions if available (avoids DB call)
            if (req.user.permissions && Array.isArray(req.user.permissions)) {
                const perm = req.user.permissions.find(p => p.feature === featureKey);
                if (perm) {
                    // Default to ALL if found in JWT, unless we have a specific scope flag there
                    req.user.dataScope = perm.dataScope || perm.data_scope || 'ALL';
                    return next();
                }
            }

            if (!roleId) {
                // Default to OWN for safety if no role is identified
                req.user.dataScope = 'OWN';
                return next();
            }

            // 3. Final Fallback: Fetch from database
            // Normalize featureKey to uppercase to match database convention if necessary, 
            // but the query itself will handle it if collation is default.
            const rows = await db.authQuery(`
                SELECT rfp.data_scope, rfp.permissions, f.feature_key
                FROM role_feature_permissions rfp
                JOIN features f ON rfp.feature_id = f.id
                WHERE rfp.role_id = ? AND LOWER(f.feature_key) = LOWER(?)
            `, [roleId, featureKey]);

            if (rows.length === 0) {
                console.log(`[RBAC] No permission row found for role ${roleId} and feature ${featureKey}. Defaulting to OWN scope.`);
                req.user.dataScope = 'OWN';
                req.user.dataFilter = { createdBy: userId };
                return next();
            }

            const { data_scope, permissions, feature_key: dbFeatureKey } = rows[0];
            
            // Check if they even have READ permission (bit 1)
            if ((permissions & 1) === 0) {
                // Special case for dashboard: allow basic access (OWN scope) even if READ bit is 0
                if (featureKey.toLowerCase() === 'dashboard' || dbFeatureKey.toLowerCase() === 'dashboard') {
                    console.log(`[RBAC] Dashboard access granted via fallback for user ${userId} (READ bit was 0)`);
                    req.user.dataScope = 'OWN';
                    req.user.dataFilter = { createdBy: userId };
                    return next();
                }
                console.warn(`[RBAC] Access denied for user ${userId}, role ${roleId}, feature ${featureKey}. Permissions bitmask: ${permissions}`);
                return res.status(403).json({ success: false, message: `Access denied to ${featureKey}` });
            }

            req.user.dataScope = data_scope || 'ALL';
            req.user.dataFilter = req.user.dataScope === 'OWN' ? { createdBy: userId } : {};

            next();
        } catch (error) {
            console.error('[RBAC Middleware] Error:', error);
            next();
        }
    };
};

module.exports = rbacMiddleware;
