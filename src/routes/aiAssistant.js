/**
 * POST /ai-assistant/schedule-interview
 * Proxies to Streaming service POST /schedule-interview (same as ref backend_ai-main). No auth required.
 */
const express = require('express');
const router = express.Router();
const AiAssistantService = require('../services/aiAssistantService');
const serviceAuth = require('../middlewares/serviceAuth.middleware');
const config = require('../config');
const { getGoogleMeetCredentials } = require('../services/googleMeetService');

router.get('/google-meet-credentials', serviceAuth(config.service?.internalToken), async (req, res) => {
  try {
    const data = await getGoogleMeetCredentials({
      authorization: req.headers.authorization || '',
      cookie: req.headers.cookie || ''
    });
    return res.status(200).json({ success: true, data });
  } catch (error) {
    console.error('google-meet-credentials error:', error);
    return res.status(error.status || 500).json({
      success: false,
      message: error.message || 'Failed to fetch Google Meet credentials'
    });
  }
});

router.post('/schedule-interview', async (req, res) => {
  try {
    const result = await AiAssistantService.scheduleInterview(req.body, {
      authorization: req.headers.authorization || '',
      cookie: req.headers.cookie || '',
      googleRefreshToken: req.headers['x-google-refresh-token'] || req.headers['X-Google-Refresh-Token'] || ''
    });
    return res.status(200).json(result);
  } catch (error) {
    console.error('schedule-interview error:', error);
    let message = error?.message;
    if (message && typeof message === 'object') {
      message = message.message || message.detail || JSON.stringify(message);
    }
    if (!message || message === '[object Object]') {
      const fallback = error?.response?.data;
      if (fallback && typeof fallback === 'object') {
        message = fallback.message || fallback.detail || JSON.stringify(fallback);
      }
    }
    return res.status(error.status || 500).json({
      success: false,
      message: message || 'Failed to schedule interview'
    });
  }
});

module.exports = router;
