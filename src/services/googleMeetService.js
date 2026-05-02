const axios = require('axios');
const config = require('../config');
const buildHttpsAgent = require('../utils/buildHttpsAgent');

const getUniqueGoogleMeetConfigUrls = (baseUrl) => {
    const raw = String(baseUrl || '').replace(/\/$/, '');
    if (!raw) return [];

    const normalized = raw.replace(/\/superadmin$/i, '');
    const candidates = [
        `${raw}/superadmin/settings/google-meet`,
        `${normalized}/superadmin/settings/google-meet`,
    ];

    return [...new Set(candidates.filter(Boolean))];
};

const parseOwnerEmails = (list) => {
    if (!Array.isArray(list)) return [];
    return list.map((v) => String(v || '').trim().toLowerCase()).filter(Boolean);
};

const parsePanelMembers = (list) => {
    if (!Array.isArray(list)) return [];
    return list
        .map((item) => ({
            name: String(item?.name || '').trim(),
            email: String(item?.email || '').trim().toLowerCase(),
            role: String(item?.role || '').trim(),
            skills: String(item?.skills || '').trim(),
            experience: String(item?.experience || '').trim(),
            isPrimary: item?.isPrimary === true
        }))
        .filter((item) => item.email);
};

const normalizeGoogleMeetPayload = (payload = {}) => {
    const panelMembers = parsePanelMembers(payload.panelMembers);
    const ownerEmails = parseOwnerEmails(payload.defaultOwnerEmails);
    const mergedOwners = [...new Set([...ownerEmails, ...panelMembers.map((m) => m.email)])];

    return {
        enabled: payload.enabled === true,
        clientId: String(payload.clientId || '').trim(),
        clientSecret: String(payload.clientSecret || '').trim(),
        refreshToken: String(payload.refreshToken || '').trim(),
        calendarId: String(payload.calendarId || 'primary').trim() || 'primary',
        defaultOwnerEmails: mergedOwners,
        panelMembers,
        includeLoggedInUser: payload.includeLoggedInUser !== false,
        notifyPanelSelection: payload.notifyPanelSelection !== false
    };
};

const toCredentialsOnly = (payload = {}) => ({
    enabled: payload.enabled === true,
    clientId: String(payload.clientId || '').trim(),
    clientSecret: String(payload.clientSecret || '').trim(),
    refreshToken: String(payload.refreshToken || '').trim(),
    calendarId: String(payload.calendarId || 'primary').trim() || 'primary'
});

const getServiceContext = () => {
    const baseUrl = (config.authServiceUrl || process.env.AUTH_SERVICE_URL || '').replace(/\/$/, '');
    const token = config.service?.internalToken || process.env.INTERNAL_SERVICE_TOKEN;
    return { baseUrl, token };
};

const getGoogleMeetConfig = async (authContext = {}) => {
    const { baseUrl, token } = getServiceContext();
    if (!baseUrl) {
        console.warn('[googleMeetService] AUTH_SERVICE_URL not set; cannot fetch Google Meet config');
        return null;
    }

    const httpsAgent = buildHttpsAgent(baseUrl);
    const authorization = String(authContext?.authorization || '').trim();
    const cookie = String(authContext?.cookie || '').trim();
    const headers = {
        ...(token ? { 'X-Service-Token': token } : {}),
        'X-User-Role': 'SUPERADMIN',
        ...(authorization ? { Authorization: authorization } : {}),
        ...(cookie ? { Cookie: cookie } : {})
    };
    const urls = getUniqueGoogleMeetConfigUrls(baseUrl);

    for (const url of urls) {
        try {
            const res = await axios.get(url, {
                timeout: 8000,
                headers,
                httpsAgent
            });
            if (res.data?.success && res.data?.data) {
                return normalizeGoogleMeetPayload(res.data.data);
            }
        } catch (err) {
            const status = err.response?.status;
            if (status && status !== 404) {
                console.warn(`[googleMeetService] Google Meet config fetch failed at ${url}:`, err.message);
            }
        }
    }

    return null;
};

const getGoogleMeetCredentials = async (authContext = {}) => {
    const fullConfig = await getGoogleMeetConfig(authContext);
    return toCredentialsOnly(fullConfig || {});
};

const saveGoogleMeetConfig = async (payload = {}, authContext = {}) => {
    const { baseUrl, token } = getServiceContext();
    if (!baseUrl) {
        throw new Error('AUTH_SERVICE_URL not set; cannot save Google Meet config');
    }

    const existing = await getGoogleMeetConfig(authContext);
    const mergedPayload = {
        ...(existing || {}),
        ...(payload || {}),
        // Never let empty incoming values wipe secrets/config inadvertently.
        clientId: String(payload?.clientId ?? '').trim() || String(existing?.clientId || '').trim(),
        clientSecret: String(payload?.clientSecret ?? '').trim() || String(existing?.clientSecret || '').trim(),
        refreshToken: String(payload?.refreshToken ?? '').trim() || String(existing?.refreshToken || '').trim(),
        calendarId: String(payload?.calendarId ?? '').trim() || String(existing?.calendarId || 'primary').trim() || 'primary'
    };

    const urls = getUniqueGoogleMeetConfigUrls(baseUrl);
    const httpsAgent = buildHttpsAgent(baseUrl);
    const data = normalizeGoogleMeetPayload(mergedPayload);

    let lastError = null;
    for (const url of urls) {
        try {
            const res = await axios.put(url, data, {
                timeout: 10000,
                headers: {
                    ...(token ? { 'X-Service-Token': token } : {}),
                    'X-User-Role': 'SUPERADMIN',
                    'Content-Type': 'application/json'
                },
                httpsAgent
            });
            if (res.data?.success) {
                return normalizeGoogleMeetPayload(res.data?.data || data);
            }
        } catch (err) {
            lastError = err;
            const status = err.response?.status;
            if (status && status !== 404) {
                console.warn(`[googleMeetService] Google Meet config save failed at ${url}:`, err.message);
            }
        }
    }

    const msg = lastError?.response?.data?.message || lastError?.message || 'Failed to save Google Meet config';
    throw new Error(msg);
};

module.exports = { getGoogleMeetConfig, getGoogleMeetCredentials, saveGoogleMeetConfig };
