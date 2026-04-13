require('dotenv').config();

const config = {
	env: process.env.NODE_ENV,
	port: parseInt(process.env.PORT, 10),
	logLevel: process.env.LOG_LEVEL,
	frontendUrl: process.env.FRONTEND_URL || 'http://localhost:3000',

	database: {
		host: process.env.DB_HOST,
		port: parseInt(process.env.DB_PORT, 10),
		user: process.env.DB_USER,
		password: process.env.DB_PASSWORD,
		name: process.env.DB_NAME,
		poolSize: parseInt(process.env.DB_POOL_SIZE, 10)
	},
	authDatabase: {
		host: process.env.DB_HOST,
		port: parseInt(process.env.DB_PORT, 10),
		user: process.env.DB_USER,
		password: process.env.DB_PASSWORD,
		name: process.env.AUTH_DB_NAME,
		poolSize: parseInt(process.env.DB_POOL_SIZE, 10)
	},

	service: {
		internalToken: process.env.INTERNAL_SERVICE_TOKEN,
		serviceName: process.env.SERVICE_NAME
	},

	// Auth (SuperadminBackend): for proxying GET /auth/users/:id and GET /superadmin/settings/email
	authServiceUrl: process.env.AUTH_SERVICE_URL,

	// Candidate test portal base URL for invite emails (CANDIDATE_TEST_PORTAL_URL or CANDIDATE_LINK_BASE_URL)
	candidateTestPortalUrl: process.env.CANDIDATE_TEST_PORTAL_URL || process.env.CANDIDATE_LINK_BASE_URL || '',

	// Admin portal login URL for new-admin welcome email (ADMIN_LOGIN_URL or FRONTEND_URL + /login)
	adminLoginUrl: process.env.ADMIN_LOGIN_URL || (process.env.FRONTEND_URL ? `${process.env.FRONTEND_URL.replace(/\/$/, '')}/login` : ''),

	// Streaming service: resume score API (POST /resume-ats/calculate-score) — do not use AdminBackend for scoring
	streamingServiceUrl: process.env.STREAMING_SERVICE_URL,
	aiServiceUrl: process.env.AI_SERVICE_URL,
	candidateServiceUrl: process.env.CANDIDATE_SERVICE_URL,

	// File storage: all under qwikhire-prod-storage / folder 6464-0160-2190-198-79266 / Resume | JD
	storage: {
		basePath: process.env.STORAGE_BASE_PATH || undefined,
		folderId: process.env.STORAGE_FOLDER_ID || '6464-0160-2190-198-79266'
	}
};

module.exports = config;
