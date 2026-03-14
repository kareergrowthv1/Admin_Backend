/**
 * Service to interact with the Streaming service for scheduling interviews (private link).
 * Same flow as ref backend_ai-main: schedule-interview API lives on Streaming; AdminBackend proxies to it.
 */
const axios = require('axios');
const config = require('../config');

class AiAssistantService {
    /**
     * Schedule an interview by calling Streaming service POST /schedule-interview (ref: backend_ai-main).
     * @param {Object} data Interview details (candidateId, email, positionId, questionSetId, clientId, etc.)
     * @returns {Promise<Object>} Response from Streaming service
     */
    static async scheduleInterview(data) {
        const streamingUrl = (config.streamingServiceUrl || config.aiServiceUrl || '').replace(/\/$/, '');
        if (!streamingUrl) {
            throw new Error('STREAMING_SERVICE_URL (or AI_SERVICE_URL) not configured');
        }
        const url = `${streamingUrl}/schedule-interview`;
        try {
            const response = await axios.post(url, data, {
                timeout: 30000,
                headers: { 'Content-Type': 'application/json' }
            });
            return response.data;
        } catch (error) {
            const msg = error.response?.data?.detail || error.response?.data?.message || error.message;
            console.error('AiAssistantService.scheduleInterview: Streaming call failed:', msg);
            throw new Error(msg || 'Streaming schedule-interview failed');
        }
    }
}

module.exports = AiAssistantService;
