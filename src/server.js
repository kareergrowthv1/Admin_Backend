const app = require('./app');
const config = require('./config');
const db = require('./config/db');
const fs = require('fs');
const path = require('path');
const https = require('https');
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
    )`,
    `CREATE TABLE IF NOT EXISTS candidate_ai_mock_rounds (
        candidate_id VARCHAR(36) NOT NULL,
        round_number INT NOT NULL,
        status VARCHAR(20) NOT NULL,
        score INT DEFAULT 0,
        last_feedback TEXT,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        PRIMARY KEY (candidate_id, round_number)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
    `CREATE TABLE IF NOT EXISTS candidate_course_points (
        candidate_id VARCHAR(36) NOT NULL,
        course_id VARCHAR(36) NOT NULL,
        module_progress JSON,
        overall_percentage INT DEFAULT 0,
        points INT DEFAULT 0,
        metadata JSON,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        PRIMARY KEY (candidate_id, course_id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`
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

        // Incremental column migrations for college_candidates (ensures existing tables get new columns)
        const addColumnIfMissing = async (table, column, definition) => {
            const [cols] = await pool.query(
                `SELECT COUNT(*) as cnt FROM INFORMATION_SCHEMA.COLUMNS 
                 WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ? AND COLUMN_NAME = ?`,
                [CANDIDATES_DB, table, column]
            );
            if (cols[0].cnt === 0) {
                console.log(`[Startup] Adding missing column ${column} to ${table}...`);
                await pool.query(`ALTER TABLE \`${CANDIDATES_DB}\`.\`${table}\` ADD COLUMN \`${column}\` ${definition}`);
            }
        };

        await addColumnIfMissing('college_candidates', 'current_role', "VARCHAR(255) DEFAULT 'Software Developer'");
        await addColumnIfMissing('college_candidates', 'academic_year', "VARCHAR(100) DEFAULT 'Final Year'");
        await addColumnIfMissing('college_candidates', 'registration_paid', "TINYINT(1) DEFAULT 0");
        await addColumnIfMissing('college_candidates', 'plan_id', "VARCHAR(36)");
        await addColumnIfMissing('college_candidates', 'subscription_expiry', "DATETIME");
        await addColumnIfMissing('college_candidates', 'dept_id', "VARCHAR(36)");
        await addColumnIfMissing('college_candidates', 'branch_id', "VARCHAR(36)");
        await addColumnIfMissing('college_candidates', 'department_name', "VARCHAR(255)");
        await addColumnIfMissing('college_candidates', 'skills', "JSON"); // skills is used in CandidateBackend
        await addColumnIfMissing('college_candidates', 'year_of_passing', "INT");
        
        // migrations for public_link
        await addColumnIfMissing('public_link', 'tenant_id', "VARCHAR(255) AFTER question_set_id");
        await addColumnIfMissing('public_link', 'question_section_id', "BINARY(16) AFTER question_set_id");

        console.log('[Startup] candidates_db created and tables/columns ensured (college_candidates, etc.)');
    } finally {
        await pool.end();
    }
};

const startServer = async () => {
    await initCandidatesDatabase();
    await db.initializePool();

    const AtsCandidateModel = require('./models/atsCandidateModel');
    await AtsCandidateModel.ensureAtsCandidatesTable().catch(console.error);

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
        
        // Run once on startup to process any links that expired while server was down
        scheduler.runLinkExpiryNow();
    });

    // Optional HTTPS listener for LAN sharing / secure browser access.
    const sslKeyPath = process.env.SSL_KEY_PATH;
    const sslCertPath = process.env.SSL_CERT_PATH;
    const sslPort = Number(process.env.SSL_PORT || 0);
    if (sslKeyPath && sslCertPath && sslPort > 0 && fs.existsSync(sslKeyPath) && fs.existsSync(sslCertPath)) {
        const tlsOptions = {
            key: fs.readFileSync(sslKeyPath),
            cert: fs.readFileSync(sslCertPath),
        };
        https.createServer(tlsOptions, app).listen(sslPort, '0.0.0.0', () => {
            console.log(`Admin Backend HTTPS running on port ${sslPort}`);
        });
    }
};

startServer();
