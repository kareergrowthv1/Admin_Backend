/**
 * POST /ai-assistant/schedule-interview
 * Proxies to Streaming service POST /schedule-interview (same as ref backend_ai-main). No auth required.
 */
const express = require('express');
const router = express.Router();
const AiAssistantService = require('../services/aiAssistantService');

router.post('/schedule-interview', async (req, res) => {
  try {
    const result = await AiAssistantService.scheduleInterview(req.body);
    return res.status(200).json(result);
  } catch (error) {
    console.error('schedule-interview error:', error);
    return res.status(500).json({
      success: false,
      message: error.message || 'Failed to schedule interview'
    });
  }
});

module.exports = router;
