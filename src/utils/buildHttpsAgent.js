const fs = require('fs');
const https = require('https');

function isLocalHttpsHost(hostname) {
  return hostname === 'localhost'
    || hostname === '127.0.0.1'
    || /^192\.168\.\d{1,3}\.\d{1,3}$/.test(hostname)
    || /^10\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(hostname)
    || /^172\.(1[6-9]|2\d|3[0-1])\.\d{1,3}\.\d{1,3}$/.test(hostname);
}

function buildHttpsAgent(baseUrl) {
  try {
    const target = new URL(baseUrl);
    if (target.protocol !== 'https:') return undefined;

    if (process.env.NODE_ENV !== 'production' && isLocalHttpsHost(target.hostname)) {
      return new https.Agent({ rejectUnauthorized: false });
    }

    const certPath = process.env.NODE_EXTRA_CA_CERTS || process.env.SSL_CERT_PATH;
    if (certPath && fs.existsSync(certPath)) {
      return new https.Agent({ ca: fs.readFileSync(certPath) });
    }
  } catch (_) {
    return undefined;
  }

  return undefined;
}

module.exports = buildHttpsAgent;