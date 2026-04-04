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
const sendEmail = async (to, subject, htmlBody, cc) => {
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

    const payload = {
        from: { address: fromEmail, name: fromName },
        to: [{ email_address: { address: to } }],
        subject,
        htmlbody: htmlBody || ''
    };

    if (cc) {
        const ccAddresses = cc.split(',').map(email => ({
            email_address: { address: email.trim() }
        })).filter(item => item.email_address.address);
        
        if (ccAddresses.length > 0) {
            payload.cc = ccAddresses;
        }
    }

    try {
        await axios.post(
            apiUrl,
            payload,
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

/**
 * Send invitation email to new candidate added by College Admin.
 * @param {string} to - Candidate email
 * @param {string} candidateName - Candidate name
 * @param {string} adminName - Admin who added the candidate
 * @param {string} tempPassword - Generated password
 * @param {string} loginUrl - Candidate portal URL
 */
const sendCandidateInvitationEmail = async (to, candidateName, adminName, tempPassword, loginUrl) => {
    const subject = `Invitation to join KareerGrowth from ${adminName}`;
    const htmlBody = `
        <div style="font-family: Arial, sans-serif; line-height: 1.6; color: #333; max-width: 600px; margin: 0 auto; border: 1px solid #eee; padding: 20px; border-radius: 10px;">
            <h2 style="color: #2e7d32;">Hello ${candidateName}!</h2>
            <p><strong>${adminName}</strong> from your college has invited you to join the <strong>KareerGrowth</strong> platform.</p>
            <p>You can now access your tasks, track your attendance, and more.</p>
            
            <div style="background-color: #f9f9f9; padding: 15px; border-radius: 5px; margin: 20px 0;">
                <p style="margin: 0;"><strong>Your Login Credentials:</strong></p>
                <p style="margin: 10px 0 0 0;">Email: <span style="color: #2e7d32;">${to}</span></p>
                <p style="margin: 5px 0 0 0;">Password: <span style="color: #2e7d32;">${tempPassword}</span></p>
            </div>
            
            <p>Login here: <a href="${loginUrl}" style="color: #2e7d32; font-weight: bold;">${loginUrl}</a></p>
            
            <p style="margin-top: 30px; font-size: 0.9em; color: #777;">
                If you have any questions, please contact your college administrator.<br>
                Best regards,<br>
                Team KareerGrowth
            </p>
        </div>
    `;
    return await sendEmail(to, subject, htmlBody);
};

module.exports = { getEmailConfig, sendEmail, sendCandidateInvitationEmail };
