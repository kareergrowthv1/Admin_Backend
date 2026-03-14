/**
 * Email sending via Zepto Mail. Config is fetched dynamically from Superadmin GET /superadmin/settings/email.
 * No hardcoded API keys or fromName – all from DB (fromName e.g. KareerGrowth).
 * Used for: Forgot password OTP, New admin welcome, Candidate test invite.
 */
const axios = require('axios');
const config = require('../config');

const getEmailConfig = async () => {
    const baseUrl = (config.authServiceUrl || process.env.AUTH_SERVICE_URL || '').replace(/\/$/, '');
    const token = config.service?.internalToken || process.env.INTERNAL_SERVICE_TOKEN;
    if (!baseUrl) {
        console.warn('[emailService] AUTH_SERVICE_URL not set; cannot fetch email config');
        return null;
    }
    try {
        const res = await axios.get(`${baseUrl}/superadmin/settings/email`, {
            timeout: 8000,
            headers: token ? { 'X-Service-Token': token } : {}
        });
        if (res.data?.success && res.data?.data) return res.data.data;
        return null;
    } catch (err) {
        console.warn('[emailService] Failed to fetch email config:', err.message);
        return null;
    }
};

/**
 * Send one email via Zepto Mail using config from Superadmin (GET API). No hardcoding.
 * @param {string} to - Recipient email
 * @param {string} subject - Subject line
 * @param {string} htmlBody - HTML body
 * @returns {Promise<{ sent: boolean, error?: string }>}
 */
const sendEmail = async (to, subject, htmlBody) => {
    const emailConfig = await getEmailConfig();
    if (!emailConfig || !emailConfig.enabled) {
        return { sent: false, error: 'Email not enabled or config unavailable' };
    }
    const apiUrl = (emailConfig.apiUrl || 'https://api.zeptomail.in/v1.1/email').trim();
    const apiKey = (emailConfig.apiKey || '').trim();
    const fromEmail = (emailConfig.fromEmail || '').trim();
    const fromName = (emailConfig.fromName || 'KareerGrowth').trim();
    if (!apiKey || !fromEmail || !to) {
        return { sent: false, error: 'Missing apiKey, fromEmail, or to' };
    }
    try {
        await axios.post(
            apiUrl,
            {
                from: { address: fromEmail, name: fromName },
                to: [{ email_address: { address: to } }],
                subject,
                htmlbody: htmlBody || ''
            },
            {
                timeout: 15000,
                headers: {
                    'Content-Type': 'application/json',
                    Authorization: `Zoho-enczapikey ${apiKey}`
                }
            }
        );
        return { sent: true };
    } catch (err) {
        const msg = err.response?.data?.message || err.response?.data?.error || err.message;
        console.warn('[emailService] Zepto send failed:', msg);
        return { sent: false, error: msg };
    }
};

module.exports = { getEmailConfig, sendEmail };
