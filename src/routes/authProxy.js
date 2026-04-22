/**
 * Proxy /auth/* to the auth service (SuperadminBackend) so AdminFrontend can call
 * GET /auth/users/:id without a separate base URL. Used e.g. by PositionDetailsDrawer for creator name.
 */
const express = require('express');
const axios = require('axios');
const config = require('../config');
const authMiddleware = require('../middlewares/auth.middleware');
const buildHttpsAgent = require('../utils/buildHttpsAgent');

const router = express.Router();
const authBase = (config.authServiceUrl || '').replace(/\/$/, '');

if (!authBase) {
  console.warn('[authProxy] AUTH_SERVICE_URL not set; GET /auth/users/:id will return 503.');
}

function buildFallbackAuthBase(req) {
  const hostHeader = req.headers['x-forwarded-host'] || req.headers.host || '';
  const host = String(hostHeader).split(',')[0].trim().split(':')[0];
  if (!host) return '';
  return `https://${host}:8441`;
}

router.get('/users/:id', authMiddleware, async (req, res) => {
  try {
    const fallbackAuthBase = buildFallbackAuthBase(req);
    const candidateBases = [authBase, fallbackAuthBase].filter(Boolean);

    if (candidateBases.length === 0) {
      return res.status(503).json({ success: false, message: 'Auth service URL not configured' });
    }

    const userId = req.params.id;
    const headers = {};
    // Prefer trusted service-to-service auth for proxy calls.
    if (config.service && config.service.internalToken) {
      headers['X-Service-Token'] = config.service.internalToken;
      headers['X-Service-Name'] = config.service.serviceName || 'admin-backend';
    }

    // Keep user context available upstream for auth/audit middleware.
    const user = req.user || {};
    if (user.id) headers['X-User-Id'] = user.id;
    if (user.role) headers['X-User-Role'] = user.role;
    if (user.organizationId) headers['X-Organization-Id'] = user.organizationId;
    if (user.client) headers['X-User-Cl'] = user.client;
    const tenantId = user.client || req.headers['x-tenant-id'] || req.headers['x-user-cl'];
    if (tenantId) headers['X-Tenant-Id'] = tenantId;

    // Preserve frontend authorization/cookies as fallback.
    if (req.headers.authorization) headers.Authorization = req.headers.authorization;
    if (req.headers.cookie) headers.Cookie = req.headers.cookie;

    let lastError = null;
    for (const base of candidateBases) {
      try {
        const httpsAgent = buildHttpsAgent(base);
        const response = await axios.get(`${base}/users/${userId}`, {
          headers,
          httpsAgent,
          timeout: 10000,
          validateStatus: () => true
        });
        return res.status(response.status).json(response.data);
      } catch (proxyErr) {
        lastError = proxyErr;
      }
    }

    console.error('[authProxy] GET /users/:id error:', lastError?.message || 'Unknown proxy error');
    return res.status(502).json({ success: false, message: 'Auth service unavailable' });
  } catch (err) {
    console.error('[authProxy] GET /users/:id error:', err.message);
    res.status(502).json({ success: false, message: 'Auth service unavailable' });
  }
});

module.exports = router;
