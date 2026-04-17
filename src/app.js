const express = require('express');
const cors = require('cors');
const morgan = require('morgan');
const cookieParser = require('cookie-parser');
const swaggerUi = require('swagger-ui-express');
const config = require('./config');
const swaggerDocument = require('./docs/swagger');
const errorMiddleware = require('./middlewares/error.middleware');
const adminRoutes = require('./routes/admins');
const candidateRoutes = require('./routes/candidates');
const positionCandidateRoutes = require('./routes/positionCandidates');
const scoreResumeRoutes = require('./routes/scoreResume');
const aiAssistantRoutes = require('./routes/aiAssistant');
const extractRoutes = require('./routes/extract');
const authProxyRoutes = require('./routes/authProxy');
const internalRoutes = require('./routes/internal');
const privateLinksRoutes = require('./routes/privateLinks');
const assessmentSummaryRoutes = require('./routes/assessmentSummaries');
const attendanceRoutes = require('./routes/attendance');
const tasksRoutes = require('./routes/tasks');

const app = express();

// CORS: from .env (comma-separated CORS_ORIGINS); fallback for dev when empty
const DEFAULT_CORS_ORIGINS = [
  'http://localhost:4000', 'http://localhost:4001', 'http://localhost:4002', 'http://localhost:4003',
  'http://localhost:5173', 'http://localhost:5174',
  'https://localhost:4000', 'https://localhost:4001', 'https://localhost:4002', 'https://localhost:4003',
  'https://localhost:5173', 'https://localhost:5174',
  'http://127.0.0.1:4000', 'http://127.0.0.1:4001', 'http://127.0.0.1:4002', 'http://127.0.0.1:4003',
  'http://127.0.0.1:5173', 'http://127.0.0.1:5174',
  'https://127.0.0.1:4000', 'https://127.0.0.1:4001', 'https://127.0.0.1:4002', 'https://127.0.0.1:4003',
  'https://127.0.0.1:5173', 'https://127.0.0.1:5174',
];
const corsOrigins = (process.env.CORS_ORIGINS || '').split(',').map(o => o.trim()).filter(Boolean);
const originList = corsOrigins.length > 0 ? corsOrigins : DEFAULT_CORS_ORIGINS;

function isLocalDevOrigin(origin) {
  try {
    const u = new URL(origin);
    const port = Number(u.port || (u.protocol === 'https:' ? 443 : 80));
    const isFrontendPort = [4000, 4001, 4002, 4003, 5173, 5174].includes(port);
    if (!isFrontendPort) return false;

    const host = u.hostname;
    const isLocalHost = host === 'localhost' || host === '127.0.0.1';
    const isLanHost =
      /^192\.168\.\d{1,3}\.\d{1,3}$/.test(host) ||
      /^10\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(host) ||
      /^172\.(1[6-9]|2\d|3[0-1])\.\d{1,3}\.\d{1,3}$/.test(host);

    return isLocalHost || isLanHost;
  } catch (_) {
    return false;
  }
}

app.use(cors({
  origin: (origin, cb) => {
    if (!origin) return cb(null, true);
    if (originList.includes(origin) || isLocalDevOrigin(origin)) return cb(null, true);
    return cb(null, false);
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: [
    'Content-Type', 'Authorization', 'Accept', 'X-Requested-With',
    'X-Tenant-Id', 'X-User-Id', 'X-User-OrgId', 'X-User-Cl', 'X-User-Email', 'X-User-Roles',
    'X-Service-Token', 'X-Service-Name', 'X-XSRF-Token', 'X-CSRF-TOKEN',
  ],
  exposedHeaders: ['X-Token-Refreshed', 'X-Logged-Out'],
}));
app.use(morgan('dev'));
app.use(express.json());
app.use(cookieParser());

// Swagger Documentation
const swaggerUiOptions = {
    customCss: `
        .swagger-ui .topbar { background-color: #2e7d32; }
        .swagger-ui .info .title { color: #2e7d32; }
        .swagger-ui .btn.authorize { background-color: #2e7d32; border-color: #2e7d32; }
        .swagger-ui .btn.authorize svg { fill: #fff; }
    `,
    customSiteTitle: 'Admin Backend API Documentation',
    swaggerOptions: {
        operationsSorter: (a, b) => {
            const order = { post: 0, get: 1, put: 2, patch: 3, delete: 4 };
            const methodA = a.get('method');
            const methodB = b.get('method');
            return (order[methodA] ?? 99) - (order[methodB] ?? 99);
        }
    }
};

app.use('/api-docs', swaggerUi.serve, swaggerUi.setup(swaggerDocument, swaggerUiOptions));
app.get('/api-docs.json', (req, res) => {
    res.setHeader('Content-Type', 'application/json');
    res.send(swaggerDocument);
});

// Health check
app.get('/health', (req, res) => {
  res.status(200).json({ status: 'Admin Backend is healthy' });
});

// Mount score-resume first so POST /position-candidates/score-resume always matches (calls Streaming AI, saves score)
app.use('/position-candidates', scoreResumeRoutes);
// All AI (skills, JD) is in Streaming; frontend calls Streaming directly with Bearer token
app.use('/admins', adminRoutes);
// Mount assessment-summaries before /candidates so GET /candidates/assessment-summaries is not caught by candidates' /:id (auth required)
app.use('/candidates/assessment-summaries', assessmentSummaryRoutes);
app.use('/candidates', candidateRoutes);
app.use('/position-candidates', positionCandidateRoutes);
app.use('/ai-assistant', aiAssistantRoutes);
app.use('/extract', extractRoutes);
app.use('/auth', authProxyRoutes);
app.use('/internal', internalRoutes);
app.use('/private-links', privateLinksRoutes);
app.use('/attendance', attendanceRoutes);
app.use('/tasks', tasksRoutes);

app.use(errorMiddleware);

module.exports = app;
