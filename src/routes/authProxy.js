/**
 * Proxy /auth/* to the auth service (SuperadminBackend) so AdminFrontend can call
 * GET /auth/users/:id without a separate base URL. Used e.g. by PositionDetailsDrawer for creator name.
 */
const express = require('express');
const axios = require('axios');
const config = require('../config');
const authMiddleware = require('../middlewares/auth.middleware');

const router = express.Router();
const authBase = (config.authServiceUrl || '').replace(/\/$/, '');

if (!authBase) {
  console.warn('[authProxy] AUTH_SERVICE_URL not set; GET /auth/users/:id will return 503.');
}

router.get('/users/:id', authMiddleware, async (req, res) => {
  try {
    if (!authBase) {
      return res.status(503).json({ success: false, message: 'Auth service URL not configured' });
    }
    const userId = req.params.id;
    const url = `${authBase}/users/${userId}`;
    const headers = {};
    if (req.headers.authorization) headers.Authorization = req.headers.authorization;
    if (req.headers.cookie) headers.Cookie = req.headers.cookie;
    const response = await axios.get(url, {
      headers,
      timeout: 10000,
      validateStatus: () => true
    });
    res.status(response.status).json(response.data);
  } catch (err) {
    console.error('[authProxy] GET /users/:id error:', err.message);
    res.status(502).json({ success: false, message: 'Auth service unavailable' });
  }
});

module.exports = router;
