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

const authMiddleware = (req, res, next) => {
  try {
    let userId = req.headers['x-user-id'] || req.headers['X-User-Id'] || req.headers['X-User-ID'];
    let userRole = req.headers['x-user-role'] || req.headers['X-User-Role'];
    let organizationId = req.headers['x-organization-id'] || req.headers['X-Organization-Id'] || req.headers['x-user-orgid'] || req.headers['X-User-OrgId'];
    let client = req.headers['x-user-cl'] || req.headers['X-User-Cl'] || req.headers['x-tenant-id'] || req.headers['X-Tenant-Id'];

    const serviceToken = req.headers['x-service-token'] || req.headers['X-Service-Token'];
    const expectedServiceToken = config.service && config.service.internalToken;
    if (serviceToken && expectedServiceToken && serviceToken === expectedServiceToken) {
      userId = userId || req.headers['x-user-id'] || req.headers['X-User-Id'];
      if (!userId) {
        return res.status(401).json({ success: false, message: 'X-Service-Token accepted but X-User-Id required for context.' });
      }
      req.user = { id: userId, role: userRole, organizationId, client };
      return next();
    }

    // Prefer Bearer token (or accessToken cookie) so frontend auth always works
    const authHeader = req.headers.authorization || req.headers.Authorization;
    const bearerToken = (authHeader && String(authHeader).startsWith('Bearer '))
      ? String(authHeader).slice(7).replace(/^"+|"+$/g, '').trim()
      : (req.cookies && req.cookies.accessToken) || null;

    if (bearerToken) {
      if (!jwt) {
        console.error('[AuthMiddleware] jsonwebtoken not installed. Run: npm install jsonwebtoken');
        return res.status(500).json({ success: false, message: 'Server misconfiguration.' });
      }
      const secret = process.env.JWT_SECRET;
      if (!secret) {
        console.error('[AuthMiddleware] JWT_SECRET not set. Must match the auth service (SuperadminBackend) that issues the token.');
        return res.status(500).json({
          success: false,
          message: 'Server misconfiguration. Set JWT_SECRET in AdminBackend .env to match SuperadminBackend.'
        });
      }
      try {
        const decoded = jwt.verify(bearerToken, secret);
        userId = decoded.userId || decoded.id || decoded.sub;
        userRole = decoded.roleName || decoded.roleCode || decoded.role || decoded.role_code;
        organizationId = decoded.organizationId || decoded.organization_id;
        client = decoded.client || decoded.tenantDb || decoded.tenantId;
      } catch (e) {
        const hint = process.env.NODE_ENV !== 'production'
          ? ' Ensure AdminBackend .env JWT_SECRET matches SuperadminBackend (same value).'
          : '';
        return res.status(401).json({
          success: false,
          message: (e.message || 'Invalid or expired token.') + hint
        });
      }
    }

    if (!userId) {
      return res.status(401).json({
        success: false,
        message: 'Authentication required. Send Authorization: Bearer <token> (from login) or set JWT_SECRET in AdminBackend to match SuperadminBackend.'
      });
    }

    req.user = {
      id: userId,
      role: userRole,
      organizationId: organizationId,
      client: client
    };

    next();
  } catch (error) {
    console.error('[AuthMiddleware] Error:', error);
    return res.status(401).json({
      success: false,
      message: 'Authentication failed'
    });
  }
};

module.exports = authMiddleware;
