/**
 * Auth Middleware for AdminBackend
 * Supports: (1) Bearer JWT from AdminFrontend (login via SuperadminBackend),
 *           (2) X-Service-Token for internal service calls,
 *           (3) X-User-Id etc. from gateway.
 */

let jwt;
try {
  jwt = require('jsonwebtoken');
} catch (e) {
  jwt = null;
}

const config = require('../config');

const authMiddleware = async (req, res, next) => {
  let userId, userRole, organizationId, client;

  try {
    userId = req.headers['x-user-id'] || req.headers['X-User-Id'] || req.headers['X-User-ID'];
    userRole = req.headers['x-user-role'] || req.headers['X-User-Role'];
    organizationId = req.headers['x-organization-id'] || req.headers['X-Organization-Id'] || req.headers['x-user-orgid'] || req.headers['X-User-OrgId'];
    client = req.headers['x-user-cl'] || req.headers['X-User-Cl'] || req.headers['x-tenant-id'] || req.headers['X-Tenant-Id'];

    const serviceToken = req.headers['x-service-token'] || req.headers['X-Service-Token'];
    const expectedServiceToken = config.service && config.service.internalToken;
    
    if (serviceToken && expectedServiceToken && serviceToken === expectedServiceToken) {
      if (!userId) {
        return res.status(401).json({ success: false, message: 'X-Service-Token accepted but X-User-Id required for context.' });
      }
      req.user = { id: userId, role: userRole, organizationId, client };
      return next();
    }

    // Prefer Bearer token
    const authHeader = req.headers.authorization || req.headers.Authorization;
    const bearerToken = (authHeader && String(authHeader).startsWith('Bearer '))
      ? String(authHeader).slice(7).replace(/^"+|"+$/g, '').trim()
      : (req.cookies && req.cookies.accessToken) || null;

    if (bearerToken) {
      if (!jwt) {
        return res.status(500).json({ success: false, message: 'Server misconfiguration: jsonwebtoken missing.' });
      }
      
      const secret = process.env.JWT_SECRET;
      if (!secret) {
        return res.status(500).json({ success: false, message: 'Server misconfiguration: JWT_SECRET missing.' });
      }

      try {
        const decoded = jwt.verify(bearerToken, secret);
        
        // Normalize claim names
        const uid = decoded.userId || decoded.id || decoded.sub;
        const role = decoded.roleName || decoded.roleCode || decoded.role || decoded.role_code;
        const orgId = decoded.organizationId || decoded.organization_id;
        const rid = decoded.roleId || decoded.role_id;
        const tenant = decoded.client || decoded.tenantDb || decoded.tenantId;
        const isCollege = decoded.isCollege !== undefined ? !!decoded.isCollege : (role === 'ADMIN');

        req.user = {
          ...decoded,
          id: uid,
          role: role,
          roleId: rid,
          organizationId: orgId,
          client: tenant,
          isCollege: isCollege
        };
        
        userId = uid; // Update for the check later
      } catch (e) {
        const hint = process.env.NODE_ENV !== 'production' ? ' (Check JWT_SECRET consistency)' : '';
        return res.status(401).json({ success: false, message: 'Invalid or expired token.' + hint });
      }
    }

    if (!userId) {
      return res.status(401).json({
        success: false,
        message: 'Authentication required. missing Bearer token or gateway headers.'
      });
    }

    next();
  } catch (err) {
    console.error('[AuthMiddleware] Error:', err);
    return res.status(500).json({ success: false, message: 'Internal server error during authentication.' });
  }
};

module.exports = authMiddleware;
