const app = require('./app');
const config = require('./config');
const db = require('./config/db');
const fs = require('fs');
const path = require('path');
const sqlUtils = require('./utils/sqlUtils');

const CANDIDATES_DB = 'candidates_db';
const CANDIDATES_SCHEMA_SQL_PATH = path.join(__dirname, '../schemas/candidates_schema.sql');

const FALLBACK_TABLES = [
    `CREATE TABLE IF NOT EXISTS \`${CANDIDATES_DB}\`.college_candidates (
        candidate_id VARCHAR(36) PRIMARY KEY,
        organization_id VARCHAR(36) NOT NULL,
        candidate_code VARCHAR(50) UNIQUE,
        register_no VARCHAR(100),
        candidate_name VARCHAR(255) NOT NULL,
        department VARCHAR(255),
        semester INT,
        year_of_passing INT,
        email VARCHAR(255) NOT NULL,
        mobile_number VARCHAR(20),
        location VARCHAR(255),
        address TEXT,
        birthdate DATE,
        resume_filename VARCHAR(255),
        resume_url VARCHAR(500),
        interview_notes TEXT,
        internal_notes TEXT,
        notes_by VARCHAR(255),
        notes_date DATE,
        status VARCHAR(50) DEFAULT 'All',
        candidate_created_by VARCHAR(36),
        candidate_created_at DATETIME,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        current_role VARCHAR(255) DEFAULT 'Software Developer',
        academic_year VARCHAR(100) DEFAULT 'Final Year',
        registration_paid TINYINT(1) DEFAULT 0,
        plan_id VARCHAR(36),
        subscription_expiry DATETIME,
        dept_id VARCHAR(36),
        branch_id VARCHAR(36),
        department_name VARCHAR(255),
        INDEX idx_organization_id (organization_id),
        INDEX idx_status (status),
        INDEX idx_candidate_email (email),
        INDEX idx_candidate_code (candidate_code),
        INDEX idx_created_by (candidate_created_by),
        UNIQUE KEY uk_email_org (email, organization_id)
    )`
];

const initCandidatesDatabase = async () => {
    await db.createDatabase(CANDIDATES_DB);

    if (fs.existsSync(CANDIDATES_SCHEMA_SQL_PATH)) {
        const rawSql = fs.readFileSync(CANDIDATES_SCHEMA_SQL_PATH, 'utf8');
        const cleanedSql = sqlUtils.stripComments(rawSql);
        const statements = sqlUtils.splitStatements(cleanedSql).filter(s => {
            const u = s.trim().toUpperCase();
            return u && !u.startsWith('SELECT ') && !u.startsWith('USE ');
        });
        if (statements.length) {
            await db.executeSchema(CANDIDATES_DB, statements);
        }
    }

    const mysql = require('mysql2/promise');
    const pool = mysql.createPool({
        host: config.database.host,
        port: config.database.port,
        user: config.database.user,
        password: config.database.password,
        database: CANDIDATES_DB,
        waitForConnections: true,
        connectionLimit: 1
    });
    try {
        for (const stmt of FALLBACK_TABLES) {
            await pool.query(stmt);
        }
        console.log('[Startup] candidates_db created and tables ensured (college_candidates, etc.)');
    } finally {
        await pool.end();
    }
};

const startServer = async () => {
    await initCandidatesDatabase();
    await db.initializePool();

    const fileStorageUtil = require('./utils/fileStorageUtil');
    await fileStorageUtil.initStorage();
    if (fileStorageUtil.USE_LOCAL_STORAGE) {
        console.log('[Startup] Storage initialized: local (uploads/' + fileStorageUtil.STORAGE_FOLDER_ID + '/Resume, /JD)');
    } else {
        console.log('[Startup] Storage initialized: GCS gs://' + (process.env.GCS_BUCKET || 'qwikhire-prod-storage') + '/' + fileStorageUtil.STORAGE_FOLDER_ID + '/Resume, /JD');
    }

    const scheduler = require('./utils/scheduler');

    app.listen(config.port, () => {
        console.log(`Admin Backend running on port ${config.port}`);
        // Start scheduled tasks
        scheduler.startPositionExpiryJob();
        scheduler.startLinkExpiryJob();
    });
};

startServer();
