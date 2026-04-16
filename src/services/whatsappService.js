const axios = require('axios');
const config = require('../config');
const buildHttpsAgent = require('../utils/buildHttpsAgent');

/**
 * Fetch WhatsApp configuration from Superadmin backend.
 * @returns {Promise<Object|null>}
 */
const getWhatsappConfig = async () => {
    const baseUrl = (config.authServiceUrl || process.env.AUTH_SERVICE_URL || '').replace(/\/$/, '');
    const token = config.service?.internalToken || process.env.INTERNAL_SERVICE_TOKEN;
    if (!baseUrl) {
        console.warn('[whatsappService] AUTH_SERVICE_URL not set; cannot fetch WhatsApp config');
        return null;
    }
    try {
        const httpsAgent = buildHttpsAgent(baseUrl);
        const res = await axios.get(`${baseUrl}/superadmin/settings/whatsapp`, {
            timeout: 8000,
            headers: token ? { 'X-Service-Token': token } : {},
            httpsAgent
        });
        if (res.data?.success && res.data?.data) return res.data.data;
        return null;
    } catch (err) {
        console.warn('[whatsappService] Failed to fetch WhatsApp config:', err.message);
        return null;
    }
};

/**
 * Send a WhatsApp message using a template.
 * @param {string} to - Recipient phone number (with country code)
 * @param {Array<string>} bodyValues - Values to populate in the template
 * @returns {Promise<{ sent: boolean, error?: string }>}
 */
const sendWhatsAppMessage = async (to, bodyValues) => {
    const whatsappConfig = await getWhatsappConfig();
    if (!whatsappConfig || !whatsappConfig.enabled) {
        return { sent: false, error: 'WhatsApp not enabled or config unavailable' };
    }

    const { apiUrl, apiKey, templateName, fromNumber, languageCode } = whatsappConfig;

    if (!apiUrl || !apiKey || !to) {
        return { sent: false, error: 'Missing apiUrl, apiKey, or recipient number' };
    }

    // Clean phone number: remove +, spaces, and ensure it has a country code if possible
    let cleanedTo = to.replace(/[\s\+]/g, '');
    if (!cleanedTo.startsWith('91') && cleanedTo.length === 10) {
        cleanedTo = '91' + cleanedTo; // Default to India if 10 digits
    }

    // Payload structure based on Reference WhatsAppUtil.java
    const payload = {
        countryCode: cleanedTo.substring(0, 2) === '91' ? '91' : '', // Placeholder logic
        phoneNumber: cleanedTo,
        type: "Template",
        template: {
            name: templateName,
            languageCode: languageCode || 'en',
            bodyValues: bodyValues,
            buttonValues: {
                "0": bodyValues
            }
        }
    };

    try {
        await axios.post(
            apiUrl,
            payload,
            {
                timeout: 15000,
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': apiKey
                }
            }
        );
        return { sent: true };
    } catch (err) {
        const msg = err.response?.data?.message || err.response?.data?.error || err.message;
        console.warn('[whatsappService] WhatsApp send failed:', msg);
        return { sent: false, error: msg };
    }
};

module.exports = { getWhatsappConfig, sendWhatsAppMessage };
