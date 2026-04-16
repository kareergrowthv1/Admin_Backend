/**
 * Service to interact with the Streaming service for scheduling interviews (private link).
 * Same flow as ref backend_ai-main: schedule-interview API lives on Streaming; AdminBackend proxies to it.
 */
const axios = require('axios');
const config = require('../config');
const buildHttpsAgent = require('../utils/buildHttpsAgent');

function normalizeErrorMessage(payload, fallback) {
    if (typeof payload === 'string' && payload.trim()) return payload;
    if (Array.isArray(payload)) {
        const messages = payload
            .map((item) => item?.msg || item?.message || (typeof item === 'string' ? item : ''))
            .filter(Boolean);
        if (messages.length > 0) return messages.join('; ');
        return JSON.stringify(payload);
    }
    if (payload && typeof payload === 'object') {
        return payload.message || payload.detail || JSON.stringify(payload);
    }
    return fallback;
}

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
            const httpsAgent = buildHttpsAgent(streamingUrl);
            const response = await axios.post(url, data, {
                timeout: 30000,
                headers: { 'Content-Type': 'application/json' },
                httpsAgent
            });
            return response.data;
        } catch (error) {
            const msg = normalizeErrorMessage(
                error.response?.data?.detail || error.response?.data?.message,
                error.message || 'Streaming schedule-interview failed'
            );
            console.error('AiAssistantService.scheduleInterview: Streaming call failed:', msg);
            const wrapped = new Error(msg || 'Streaming schedule-interview failed');
            wrapped.status = error.response?.status || 500;
            throw wrapped;
        }
    }
}

module.exports = AiAssistantService;
