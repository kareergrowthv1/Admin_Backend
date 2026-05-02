/**
 * Service to interact with the Streaming service for scheduling interviews (private link).
 * Same flow as ref backend_ai-main: schedule-interview API lives on Streaming; AdminBackend proxies to it.
 */
const axios = require('axios');
const config = require('../config');
const buildHttpsAgent = require('../utils/buildHttpsAgent');
const { getGoogleMeetConfig, getGoogleMeetCredentials, saveGoogleMeetConfig } = require('./googleMeetService');
const { sendEmail } = require('./emailService');

function normalizeErrorMessage(payload, fallback) {
    const toText = (value) => {
        if (typeof value === 'string' && value.trim()) return value.trim();
        if (Array.isArray(value)) {
            const lines = value.map((item) => toText(item)).filter(Boolean);
            return lines.length > 0 ? lines.join('; ') : '';
        }
        if (value && typeof value === 'object') {
            const direct = toText(value.message) || toText(value.detail) || toText(value.msg) || toText(value.error);
            if (direct) return direct;
            try {
                return JSON.stringify(value);
            } catch {
                return '';
            }
        }
        return '';
    };

    if (typeof payload === 'string' && payload.trim()) return payload;
    if (Array.isArray(payload)) {
        const messages = payload
            .map((item) => item?.msg || item?.message || (typeof item === 'string' ? item : ''))
            .filter(Boolean);
        if (messages.length > 0) return messages.join('; ');
        return JSON.stringify(payload);
    }
    if (payload && typeof payload === 'object') {
        const text = toText(payload);
        if (text) return text;
        return JSON.stringify(payload);
    }
    return toText(fallback) || 'Streaming schedule-interview failed';
}

class AiAssistantService {
    static asString(value) {
        if (value === null || value === undefined) return '';
        return String(value).trim();
    }

    static buildStreamingSchedulePayload(data = {}, googleMeetConfig = null) {
        const payload = {
            candidateId: AiAssistantService.asString(data.candidateId || data.candidate_id),
            email: AiAssistantService.asString(data.email).toLowerCase(),
            positionId: AiAssistantService.asString(data.positionId || data.jobId || data.job_id),
            questionSetId: AiAssistantService.asString(data.questionSetId || data.question_set_id || 'NA'),
            clientId: AiAssistantService.asString(data.clientId || data.organizationId || data.organization_id || 'NA'),
            interviewPlatform: AiAssistantService.asString(data.interviewPlatform || 'GOOGLE_MEET') || 'GOOGLE_MEET',
            linkActiveAt: AiAssistantService.asString(data.linkActiveAt),
            linkExpiresAt: AiAssistantService.asString(data.linkExpiresAt),
            createdBy: AiAssistantService.asString(data.createdBy) || null,
            sendInviteBy: AiAssistantService.asString(data.sendInviteBy || 'EMAIL') || 'EMAIL',
            candidateName: AiAssistantService.asString(data.candidateName),
            companyName: AiAssistantService.asString(data.companyName || 'Company'),
            organizationId: AiAssistantService.asString(data.organizationId) || null,
            positionName: AiAssistantService.asString(data.positionName || data.positionTitle || 'Interview'),
            verificationCode: AiAssistantService.asString(data.verificationCode) || null
        };

        const required = [
            'candidateId',
            'email',
            'positionId',
            'linkActiveAt',
            'linkExpiresAt',
            'candidateName',
            'companyName',
            'positionName'
        ];

        const missing = required.filter((key) => !payload[key]);
        if (missing.length > 0) {
            throw new Error(`Missing required schedule fields: ${missing.join(', ')}`);
        }

        const panelOwners = AiAssistantService.extractEmailOwners(
            data?.panelSelection || data?.panelMembers || data?.panelUsers || data?.interviewerEmails || data?.ownerEmails
        );
        const loggedInOwner = AiAssistantService.extractEmailOwners(data?.createdByEmail || data?.loggedInUserEmail);
        const dynamicOwners = [...new Set([
            ...(googleMeetConfig?.defaultOwnerEmails || []),
            ...((googleMeetConfig?.notifyPanelSelection !== false) ? panelOwners : []),
            ...((googleMeetConfig?.includeLoggedInUser !== false) ? loggedInOwner : [])
        ])];

        payload.googleMeet = {
            enabled: googleMeetConfig?.enabled === true,
            clientId: AiAssistantService.asString(googleMeetConfig?.clientId),
            clientSecret: AiAssistantService.asString(googleMeetConfig?.clientSecret),
            refreshToken: AiAssistantService.asString(googleMeetConfig?.refreshToken),
            calendarId: AiAssistantService.asString(googleMeetConfig?.calendarId || 'primary') || 'primary',
            owners: dynamicOwners,
            includeLoggedInUser: googleMeetConfig?.includeLoggedInUser !== false,
            notifyPanelSelection: googleMeetConfig?.notifyPanelSelection !== false
        };

        return { payload, dynamicOwners };
    }

    static extractMeetingLink(responseData) {
        const data = responseData?.data || {};
        return (
            data.meetingLink ||
            data.meetLink ||
            data.googleMeetLink ||
            data.joinUrl ||
            responseData?.meetingLink ||
            ''
        );
    }

    static toDisplayDate(value) {
        if (!value) return '';
        try {
            const d = new Date(value);
            if (Number.isNaN(d.getTime())) return String(value);
            return d.toLocaleString('en-IN', {
                year: 'numeric',
                month: 'short',
                day: '2-digit',
                hour: '2-digit',
                minute: '2-digit'
            });
        } catch {
            return String(value);
        }
    }

    static async sendScheduleEmails({ payload, responseData, ownerEmails = [] }) {
        const candidateEmail = AiAssistantService.asString(payload.email).toLowerCase();
        if (!candidateEmail) return;

        const start = AiAssistantService.toDisplayDate(payload.linkActiveAt);
        const end = AiAssistantService.toDisplayDate(payload.linkExpiresAt);
        const meetingLink = AiAssistantService.extractMeetingLink(responseData);
        if (!meetingLink) {
            throw new Error('Google Meet link was not created, so email was not sent');
        }
        const subject = `You Have Proceeded To The Next Round - ${payload.positionName}`;

        const lines = [
            `Dear ${payload.candidateName || 'Candidate'},`,
            '',
            `Congratulations! You have been proceeded to the next round for the ${payload.positionName} position at ${payload.companyName}.`,
            '',
            'Your interview details are below:',
            `Date and Time: ${start} to ${end}`,
            `Interview Platform: ${payload.interviewPlatform}`,
            `Meeting Link: ${meetingLink}`,
            '',
            'Please join a few minutes before the scheduled time and keep this link safe.',
            '',
            'Regards,',
            `${payload.companyName} Recruitment Team`
        ];
        const textBody = lines.join('\n');

        const everyone = [...new Set([candidateEmail, ...ownerEmails.map((v) => String(v || '').trim().toLowerCase()).filter(Boolean)])];
        await Promise.all(everyone.map(async (recipient) => {
            const result = await sendEmail(recipient, subject, '', '', undefined, { textBody });
            if (!result?.sent) {
                throw new Error(result?.error || `Failed to send interview email to ${recipient}`);
            }
        }));
    }

    static extractEmailOwners(input) {
        if (!input) return [];

        const candidateEmails = [];

        const pushMaybeEmail = (value) => {
            const s = String(value || '').trim().toLowerCase();
            if (s && s.includes('@')) candidateEmails.push(s);
        };

        const walk = (value) => {
            if (!value) return;
            if (Array.isArray(value)) {
                value.forEach(walk);
                return;
            }
            if (typeof value === 'string') {
                value.split(',').forEach(pushMaybeEmail);
                return;
            }
            if (typeof value === 'object') {
                pushMaybeEmail(value.email);
                pushMaybeEmail(value.userEmail);
                pushMaybeEmail(value.ownerEmail);
                pushMaybeEmail(value.value);
                return;
            }
            pushMaybeEmail(value);
        };

        walk(input);
        return [...new Set(candidateEmails)];
    }

    /**
     * Schedule an interview by calling Streaming service POST /schedule-interview (ref: backend_ai-main).
     * @param {Object} data Interview details (candidateId, email, positionId, questionSetId, clientId, etc.)
     * @returns {Promise<Object>} Response from Streaming service
     */
    static async scheduleInterview(data, authContext = {}) {
        const streamingUrl = (config.streamingServiceUrl || config.aiServiceUrl || '').replace(/\/$/, '');
        if (!streamingUrl) {
            throw new Error('STREAMING_SERVICE_URL (or AI_SERVICE_URL) not configured');
        }
        const url = `${streamingUrl}/schedule-interview`;
        try {
            // Step 1: fetch credentials-only payload from settings for scheduling.
            const googleMeetCredentials = await getGoogleMeetCredentials(authContext);
            const dynamicRefreshToken = AiAssistantService.asString(authContext?.googleRefreshToken);
            const effectiveRefreshToken = dynamicRefreshToken || AiAssistantService.asString(googleMeetCredentials?.refreshToken);
            if (googleMeetCredentials?.enabled && (!googleMeetCredentials?.clientId || !googleMeetCredentials?.clientSecret || !effectiveRefreshToken)) {
                throw new Error('Google Meet is enabled but required credentials (clientId, clientSecret, refreshToken) are missing in settings');
            }

            // Step 2: fetch full scheduling settings (owners/panel flags) and attach credentials.
            const googleMeetConfig = {
                ...(await getGoogleMeetConfig(authContext)),
                ...googleMeetCredentials,
                refreshToken: effectiveRefreshToken
            };

            const { payload, dynamicOwners } = AiAssistantService.buildStreamingSchedulePayload(data, googleMeetConfig);

            const httpsAgent = buildHttpsAgent(streamingUrl);
            const response = await axios.post(url, payload, {
                timeout: 30000,
                headers: { 'Content-Type': 'application/json' },
                httpsAgent
            });

            const rotatedRefreshToken = AiAssistantService.asString(response?.data?.data?.rotatedRefreshToken);
            if (rotatedRefreshToken) {
                try {
                    await saveGoogleMeetConfig({ refreshToken: rotatedRefreshToken }, authContext);
                } catch (persistErr) {
                    console.warn('AiAssistantService.scheduleInterview: failed to persist rotated refresh token:', persistErr.message || persistErr);
                }
            }

            const meetingLink = AiAssistantService.extractMeetingLink(response.data);
            if (!meetingLink) {
                throw new Error('Google Meet link was not created by the scheduling service');
            }

            let emailWarning = '';
            try {
                await AiAssistantService.sendScheduleEmails({
                    payload,
                    responseData: response.data,
                    ownerEmails: dynamicOwners
                });
            } catch (emailErr) {
                emailWarning = normalizeErrorMessage(
                    emailErr,
                    emailErr?.message || 'Interview scheduled, but failed to send email notifications'
                );
                console.warn('AiAssistantService.scheduleInterview: email notification failed:', emailWarning);
            }

            if (emailWarning) {
                return {
                    ...(response.data || {}),
                    success: true,
                    emailSent: false,
                    warning: `Interview scheduled successfully, but email notifications failed: ${emailWarning}`
                };
            }

            return {
                ...(response.data || {}),
                success: true,
                emailSent: true
            };
        } catch (error) {
            const responsePayload = error?.response?.data;
            const msg = normalizeErrorMessage(
                responsePayload?.detail || responsePayload?.message || responsePayload,
                error.message || 'Streaming schedule-interview failed'
            );
            let safeMsg = (typeof msg === 'string' && msg.trim() && msg.trim() !== '[object Object]')
                ? msg.trim()
                : normalizeErrorMessage(responsePayload, 'Streaming schedule-interview failed');

            if (!safeMsg || safeMsg === 'Streaming schedule-interview failed') {
                const status = error?.response?.status;
                const statusText = AiAssistantService.asString(error?.response?.statusText);
                const code = AiAssistantService.asString(error?.code);
                if (status) {
                    safeMsg = `Streaming schedule-interview failed with status ${status}${statusText ? ` (${statusText})` : ''}`;
                } else if (code) {
                    safeMsg = `Unable to reach Streaming service (${code}) at ${url}`;
                } else {
                    safeMsg = `Streaming schedule-interview failed while calling ${url}`;
                }
            }
            console.error('AiAssistantService.scheduleInterview: Streaming call failed:', safeMsg);
            const wrapped = new Error(safeMsg || 'Streaming schedule-interview failed');
            wrapped.status = error.response?.status || 500;
            throw wrapped;
        }
    }
}

module.exports = AiAssistantService;
