const { v4: uuidv4 } = require('uuid');
const bcrypt = require('bcryptjs');
const fs = require('fs');
const path = require('path');
const config = require('../config');
const db = require('../config/db');
const schemaUtils = require('../utils/schemaUtils');
const sqlUtils = require('../utils/sqlUtils');
const emailService = require('./emailService');

const COLLEGE_SCHEMA_SQL_PATH = path.join(__dirname, '../../schemas/college_schema.sql');
const ATS_SCHEMA_SQL_PATH = path.join(__dirname, '../../schemas/ats_schema.sql');

const createAdminWithDB = async (adminData) => {
    const {
        email,
        password,
        firstName,
        lastName,
        phoneNumber,
        clientName,
        validTill: _validTill, // unused now during creation
        roleId: providedRoleId
    } = adminData;

    // 1. Generate unique client DB name
    const schemaName = schemaUtils.generateSchemaName(clientName);

    if (!schemaUtils.isValidSchemaName(schemaName)) {
        throw new Error(`Invalid schema name generated: ${schemaName}`);
    }

    console.log(`[AdminService] Generated schemaName: ${schemaName} for client: ${clientName}`);

    // 2. Check if user already exists in auth_db (explicit auth_db so we never hit candidates_db)
    const existingUsers = await db.authQuery(
        'SELECT id FROM auth_db.users WHERE email = ? AND deleted_at IS NULL',
        [email]
    );

    if (existingUsers.length > 0) {
        throw new Error('Email already exists');
    }

    // 3. Get actual Platform Org ID and ADMIN roleId dynamically
    const orgRows = await db.authQuery("SELECT id FROM auth_db.organizations WHERE name = 'KareerGrowth' LIMIT 1");
    if (orgRows.length === 0) throw new Error('Platform organization (KareerGrowth) not found');
    const kareerGrowthOrgId = orgRows[0].id;

    let roleId = providedRoleId;
    if (!roleId) {
        const adminRoles = await db.authQuery(
            `SELECT id FROM auth_db.roles WHERE code = 'ADMIN' AND organization_id = ?`,
            [kareerGrowthOrgId]
        );

        if (adminRoles.length === 0) {
            throw new Error('ADMIN role not found in auth_db');
        }
        roleId = adminRoles[0].id;
    }

    // 4. Generate UNIQUE organization_id for this new admin
    const uniqueOrgId = uuidv4();
    console.log(`[AdminService] Generated unique organizationId: ${uniqueOrgId} for admin: ${email}`);

    // 5. Create organization row so FK (fk_users_org) is satisfied — organizations.id must exist before inserting user
    const orgName = schemaName || `Org-${uniqueOrgId.slice(0, 8)}`;
    await db.authQuery(
        `INSERT INTO auth_db.organizations (id, name, description, subscription_tier, is_active, created_at, updated_at)
         VALUES (?, ?, ?, 'BASIC', 1, NOW(), NOW())`,
        [uniqueOrgId, orgName, clientName || null]
    );

    // Determine is_college flag based on role
    const roleRows = await db.authQuery('SELECT code FROM auth_db.roles WHERE id = ?', [roleId]);
    const roleCode = (roleRows[0]?.code || '').toUpperCase();
    const isCollege = roleCode === 'ATS' ? 0 : 1;

    // 6. Hash password
    const passwordHash = await bcrypt.hash(password, 12);

    const userId = uuidv4();
    await db.authQuery(
        `INSERT INTO auth_db.users (
            id, organization_id, email, username, password_hash, first_name, last_name,
            phone_number, email_verified, enabled, is_active, is_admin, role_id,
            client, is_college,
            created_at, updated_at, login_attempts_count
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW(), NOW(), ?)`,
        [
            userId,
            uniqueOrgId, // UNIQUE organizationId for each admin
            email,
            email, // username = email
            passwordHash,
            firstName || null,
            lastName || null,
            phoneNumber || null,
            true, // email_verified
            true, // enabled
            true, // is_active
            true, // is_admin
            roleId,
            schemaName, // client = the database name
            isCollege,
            0 // login_attempts_count
        ]
    );

    console.log(`[AdminService] Admin user created in auth_db: userId=${userId}, organizationId=${uniqueOrgId}, client=${schemaName}, roleId=${roleId}, isCollege=${isCollege}`);

    // Send welcome email via Zepto with login credentials and Admin login URL
    const adminLoginUrl = (config.adminLoginUrl || '').trim() || 'your admin portal';
    const welcomeSubject = 'Welcome to KareerGrowth – your admin account is ready';
    const welcomeBody = [
        `<p>Hi ${firstName || 'there'},</p>`,
        '<p>Your admin account has been created. Use the details below to log in:</p>',
        '<table style="border-collapse: collapse; margin: 16px 0;">',
        `<tr><td style="padding: 6px 12px 6px 0; font-weight: bold;">Email / Username:</td><td style="padding: 6px 0;">${email}</td></tr>`,
        `<tr><td style="padding: 6px 12px 6px 0; font-weight: bold;">Password:</td><td style="padding: 6px 0;">${password || '(the password you set during registration)'}</td></tr>`,
        '</table>',
        '<p><strong>Login page:</strong> <a href="' + adminLoginUrl + '">' + adminLoginUrl + '</a></p>',
        '<p>If you have any questions, contact your administrator.</p>'
    ].join('');
    const welcomeResult = await emailService.sendEmail(email, welcomeSubject, welcomeBody);
    if (!welcomeResult.sent) {
        console.warn('[AdminService] New admin welcome email not sent:', welcomeResult.error);
    }

    return {
        userId,
        organizationId: uniqueOrgId,
        email,
        firstName,
        lastName,
        schemaName,
        clientName,
        roleId
    };
};

const provisionAdminSchema = async (adminId) => {
    if (!adminId) throw new Error('Admin ID is required for provisioning');

    // 1. Get the admin's details from auth_db including role
    const adminRows = await db.authQuery(
        `SELECT u.client as schemaName, u.organization_id as orgId, r.code as roleCode 
         FROM auth_db.users u 
         LEFT JOIN auth_db.roles r ON u.role_id = r.id 
         WHERE u.id = ? AND u.is_admin = 1`,
        [adminId]
    );

    if (adminRows.length === 0) {
        throw new Error('Admin not found in auth_db');
    }

    const { schemaName, orgId, roleCode } = adminRows[0];
    if (!schemaName) {
        throw new Error('Client schema name not found for this admin');
    }

    console.log(`[AdminService] Provisioning schema for ${adminId}: ${schemaName}, Role: ${roleCode}`);

    // 2. Determine which schema file to use based on role
    let schemaFilePath;
    const normalizedRole = (roleCode || '').toUpperCase();
    
    if (normalizedRole === 'ATS') {
        schemaFilePath = ATS_SCHEMA_SQL_PATH;
        console.log(`[AdminService] Using ATS schema (Jobs-based)`);
    } else {
        // Default to ADMIN/College schema (Positions-based)
        schemaFilePath = COLLEGE_SCHEMA_SQL_PATH;
        console.log(`[AdminService] Using College schema (Positions-based)`);
    }

    // 3. Create client DB
    await db.createDatabase(schemaName);
    console.log(`[AdminService] Database created: ${schemaName}`);

    // 4. Initialize client DB with appropriate schema
    if (fs.existsSync(schemaFilePath)) {
        const rawSql = fs.readFileSync(schemaFilePath, 'utf8');
        const cleanedSql = sqlUtils.stripComments(rawSql);
        const statements = sqlUtils.splitStatements(cleanedSql);

        await db.executeSchema(schemaName, statements);
        console.log(`[AdminService] Schema initialized for: ${schemaName} using ${roleCode === 'ATS' ? 'ATS' : 'College'} schema`);
    } else {
        console.warn(`[AdminService] Schema file not found: ${schemaFilePath}`);
        throw new Error(`Schema file not found for role ${roleCode}`);
    }

    // 5. Insert initial credits record with is_active=true
    const creditsId = uuidv4();
    const creditsTable = 'credits'; // Same table name for both ATS and College roles
    const config = require('../config');
    const creditsPool = require('mysql2/promise').createPool({
        host: config.database.host,
        port: config.database.port,
        user: config.database.user,
        password: config.database.password,
        database: schemaName,
        waitForConnections: true,
        connectionLimit: 1,
        charset: 'utf8mb4',
        timezone: '+00:00'
    });

    try {
        const conn = await creditsPool.getConnection();
        const idBuffer = Buffer.from(creditsId.replace(/-/g, ''), 'hex');

        // orgId handling (making sure it's correct buffer)
        const orgIdStr = typeof orgId === 'string' ? orgId : (Buffer.isBuffer(orgId) ? orgId.toString('hex') : '');
        const orgIdBuffer = Buffer.from(orgIdStr.replace(/-/g, ''), 'hex');

        // Insert into role-specific credits table
        if (roleCode === 'ATS') {
            await conn.execute(
                `INSERT INTO ${creditsTable} (
                    id, organization_id, total_interview_credits, utilized_interview_credits,
                    total_position_credits, utilized_position_credits,
                    total_screening_credits, utilized_screening_credits,
                    screening_credits_min, screening_credits_cost_per_price,
                    is_active,
                    created_at, updated_at
                ) VALUES (?, ?, 0, 0, 0, 0, 0, 0, 0, 0.00, 1, NOW(), NOW())`,
                [idBuffer, orgIdBuffer]
            );
        } else {
            await conn.execute(
                `INSERT INTO ${creditsTable} (
                    id, organization_id, total_interview_credits, utilized_interview_credits,
                    total_position_credits, utilized_position_credits,
                    is_active,
                    created_at, updated_at
                ) VALUES (?, ?, 0, 0, 0, 0, 1, NOW(), NOW())`,
                [idBuffer, orgIdBuffer]
            );
        }

        conn.release();
        console.log(`[AdminService] Initial records created in ${schemaName}`);
    } finally {
        await creditsPool.end();
    }

    return {
        success: true,
        message: 'Schema provisioned successfully',
        schemaName,
        roleCode,
        creditsId
    };
};

const getCredits = async (tenantDb, organizationId, user) => {
    console.log(`[AdminService.getCredits] DEBUG: userId=${organizationId}, passedTenantDb=${tenantDb}, userClient=${user?.client}, userIsCollege=${user?.isCollege}`);
    if (!organizationId) return null;

    let resolvedTenantDb = user?.client || tenantDb;
    let roleCode = null;
    let userExpiryInfo = { expiryDate: null };

    // 1. Resolve Tenant DB and Role
    if (!resolvedTenantDb || resolvedTenantDb === 'auth_db' || resolvedTenantDb === 'superadmin_db') {
        console.log(`[AdminService.getCredits] Tenant not resolved from props, looking up in auth_db for userId=${organizationId}`);
        const userRows = await db.authQuery(
            `SELECT u.client, r.code as role_code, u.expiry_date, u.is_college
             FROM auth_db.users u
             LEFT JOIN auth_db.roles r ON u.role_id = r.id
             WHERE u.id = ? AND u.is_active = 1 LIMIT 1`,
            [organizationId]
        );
        
        if (userRows[0]) {
            resolvedTenantDb = userRows[0].client;
            roleCode = userRows[0].role_code;
            userExpiryInfo = { expiryDate: userRows[0].expiry_date };
            console.log(`[AdminService.getCredits] Resolved from fallback: client=${resolvedTenantDb}, role=${roleCode}`);
        }
    } else {
        // If already have resolvedTenantDb, still need roleCode for proper data structure
        const userIsCollege = (user?.isCollege === true || user?.isCollege === 1 || user?.isCollege === '1');
        roleCode = userIsCollege ? 'ADMIN' : 'ATS';
        console.log(`[AdminService.getCredits] Using existing resolution: client=${resolvedTenantDb}, inferred role=${roleCode}`);
    }

    if (!resolvedTenantDb || resolvedTenantDb === 'auth_db' || resolvedTenantDb === 'superadmin_db') {
        console.error(`[AdminService.getCredits] CRITICAL: Could not resolve tenant schema for userId=${organizationId}`);
        return null;
    }

    // 2. Query Tenant DB
    try {
        // Check screening columns
        const columnCheck = await db.query(
            `SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS 
             WHERE TABLE_SCHEMA = ? AND TABLE_NAME = 'credits' AND COLUMN_NAME = 'total_screening_credits'`,
            [resolvedTenantDb]
        );
        const hasScreeningColumns = columnCheck.length > 0;

        // Query credits (Allowing is_active=0 as a fallback if no active records exist)
        const sqlQuery = `SELECT 
                total_interview_credits as totalInterviews,
                utilized_interview_credits as utilizedInterviews,
                total_position_credits as totalPositions,
                utilized_position_credits as utilizedPositions,
                ${hasScreeningColumns ? 'total_screening_credits' : '0'} as totalScreening,
                ${hasScreeningColumns ? 'utilized_screening_credits' : '0'} as utilizedScreening,
                valid_till as validTill,
                is_active as isActive
             FROM \`${resolvedTenantDb}\`.credits 
             ORDER BY is_active DESC, created_at DESC LIMIT 1`;

        const rows = await db.query(sqlQuery, []);
        console.log(`[AdminService.getCredits] Query executed on ${resolvedTenantDb}. Found ${rows.length} records.`);

        let credits = rows[0];
        if (!credits) {
            console.warn(`[AdminService.getCredits] No record found in credits table for ${resolvedTenantDb}. Returning default.`);
            credits = {
                totalInterviews: 0, utilizedInterviews: 0,
                totalPositions: 0, utilizedPositions: 0,
                totalScreening: 0, utilizedScreening: 0,
                validTill: new Date(new Date().setFullYear(new Date().getFullYear() + 1)),
                isActive: 1
            };
        }

        const isAts = (roleCode === 'ATS' || hasScreeningColumns);
        
        // Return structured data
        const base = {
            totalInterviews: credits.totalInterviews || 0,
            utilizedInterviews: credits.utilizedInterviews || 0,
            remainingInterviews: (credits.totalInterviews || 0) - (credits.utilizedInterviews || 0),
            totalPositions: credits.totalPositions || 0,
            utilizedPositions: credits.utilizedPositions || 0,
            remainingPositions: (credits.totalPositions || 0) - (credits.utilizedPositions || 0),
            validTill: credits.validTill,
            expiryDate: userExpiryInfo.expiryDate,
            isActive: credits.isActive
        };

        if (isAts) {
            base.totalScreening = credits.totalScreening || 0;
            base.utilizedScreening = credits.utilizedScreening || 0;
            base.remainingScreening = (credits.totalScreening || 0) - (credits.utilizedScreening || 0);
        }

        console.log(`[AdminService.getCredits] Returning success for ${resolvedTenantDb}`);
        return base;

    } catch (err) {
        console.error(`[AdminService.getCredits] Database error on ${resolvedTenantDb}:`, err.message);
        // Fallback to empty object instead of null to prevent dashboard crash
        return {
            totalInterviews: 0, utilizedInterviews: 0, remainingInterviews: 0,
            totalPositions: 0, utilizedPositions: 0, remainingPositions: 0,
            isActive: 0, error: err.message
        };
    }
};

const getCreditHistory = async (tenantDb, organizationId) => {
    if (!organizationId) return [];

    let resolvedTenantDb = tenantDb;
    if (!resolvedTenantDb || resolvedTenantDb === 'auth_db' || resolvedTenantDb === 'superadmin_db') {
        const userRows = await db.authQuery(
            `SELECT client FROM auth_db.users WHERE id = ? AND client IS NOT NULL AND is_admin = 1 LIMIT 1`,
            [organizationId]
        );
        if (userRows[0]?.client) {
            resolvedTenantDb = userRows[0].client;
        }
    }

    if (!resolvedTenantDb || resolvedTenantDb === 'auth_db' || resolvedTenantDb === 'superadmin_db') {
        return [];
    }

    // Check if screening columns exist (ATS) or not (College)
    const columnCheck = await db.query(
        `SELECT COLUMN_NAME 
         FROM INFORMATION_SCHEMA.COLUMNS 
         WHERE TABLE_SCHEMA = ? AND TABLE_NAME = 'credits' AND COLUMN_NAME = 'total_screening_credits'`,
        [resolvedTenantDb]
    );
    const hasScreeningColumns = columnCheck.length > 0;

    // Fetch from tenant DB — credits are tenant-wide
    const rows = await db.query(
        `SELECT 
            total_interview_credits as totalInterviews,
            utilized_interview_credits as utilizedInterviews,
            total_position_credits as totalPositions,
            utilized_position_credits as utilizedPositions,
            ${hasScreeningColumns ? 'total_screening_credits' : '0'} as totalScreening,
            ${hasScreeningColumns ? 'utilized_screening_credits' : '0'} as utilizedScreening,
            valid_till as validTill,
            is_active as isActive,
            created_at as createdAt
         FROM \`${resolvedTenantDb}\`.credits 
         ORDER BY created_at DESC`,
        []
    );
    return rows;
};

const requestPasswordReset = async (email) => {
    if (!email) throw new Error('Email is required');

    // 1. Verify user exists in auth_db
    const userRows = await db.authQuery(
        'SELECT id FROM auth_db.users WHERE email = ? AND deleted_at IS NULL',
        [email]
    );

    if (userRows.length === 0) {
        throw new Error('User not found');
    }

    // 2. Create password_reset_codes table if not exists (in auth_db)
    await db.authQuery(`
        CREATE TABLE IF NOT EXISTS auth_db.password_reset_codes (
            email VARCHAR(255) NOT NULL,
            code VARCHAR(10) NOT NULL,
            expires_at TIMESTAMP NOT NULL,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            INDEX idx_prc_email (email),
            INDEX idx_prc_expires (expires_at)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);

    // 3. Generate 6-digit OTP
    const otp = Math.floor(100000 + Math.random() * 900000).toString();

    // 4. Clean up old codes for this email
    await db.authQuery('DELETE FROM auth_db.password_reset_codes WHERE email = ?', [email]);

    // 5. Insert new OTP (15 mins expiry using DB time)
    await db.authQuery(
        'INSERT INTO auth_db.password_reset_codes (email, code, expires_at) VALUES (?, ?, DATE_ADD(NOW(), INTERVAL 15 MINUTE))',
        [email, otp]
    );

    // 6. Send OTP via Zepto Mail (config from Superadmin GET /superadmin/settings/email)
    const subject = 'Reset your password – KareerGrowth';
    const htmlBody = `<p>Your password reset code is: <strong>${otp}</strong></p><p>It is valid for 15 minutes. If you did not request this, please ignore this email.</p>`;
    const emailResult = await emailService.sendEmail(email, subject, htmlBody);
    if (!emailResult.sent) {
        console.warn('[AdminService] Forgot password email not sent:', emailResult.error);
    }

    console.log(`[AdminService] OTP generated for ${email}, email sent: ${emailResult.sent}`);
    return { success: true, otp };
};

const resetPassword = async (email, otp, newPassword) => {
    if (!email || !otp || !newPassword) {
        throw new Error('Email, OTP, and new password are required');
    }

    // 1. Verify OTP
    const rows = await db.authQuery(
        'SELECT * FROM auth_db.password_reset_codes WHERE email = ? AND code = ? AND expires_at > NOW()',
        [email, otp]
    );

    if (rows.length === 0) {
        throw new Error('Invalid or expired OTP');
    }

    // 2. Hash new password
    const passwordHash = await bcrypt.hash(newPassword, 12);

    // 3. Update user password in auth_db
    await db.authQuery(
        'UPDATE auth_db.users SET password_hash = ?, updated_at = NOW() WHERE email = ? AND deleted_at IS NULL',
        [passwordHash, email]
    );

    // 4. Delete used OTP
    await db.authQuery('DELETE FROM auth_db.password_reset_codes WHERE email = ?', [email]);

    console.log(`[AdminService] Password reset successful for ${email}`);
    return { success: true, message: 'Password reset successful' };
};

const getCollegeDetails = async (tenantDb, organizationId) => {
    if (!tenantDb || !organizationId) throw new Error('Tenant DB and Organization ID are required');
    const orgIdBuffer = Buffer.from(organizationId.replace(/-/g, ''), 'hex');
    // Check if college_details table exists
    const tableRows = await db.query(
        'SELECT TABLE_NAME FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ?',
        [tenantDb, 'college_details']
    );

    if (tableRows.length === 0) {
        console.warn(`[AdminService.getCollegeDetails] Table 'college_details' does not exist in ${tenantDb}`);
        return null;
    }

    const rows = await db.query(
        `SELECT HEX(id) as id, HEX(organization_id) as organizationId, 
                college_name as collegeName, college_email as collegeEmail,
                address, country, state, city, pincode, university,
                website_url as websiteUrl, about_us as aboutUs,
                created_at as createdAt, updated_at as updatedAt
         FROM \`${tenantDb}\`.college_details 
         WHERE organization_id = ? OR HEX(organization_id) = ? LIMIT 1`,
        [orgIdBuffer, organizationId.replace(/-/g, '').toUpperCase()]
    );

    if (rows.length === 0) return null;

    return rows[0];
};

const updateCollegeDetails = async (tenantDb, organizationId, details) => {
    if (!tenantDb || !organizationId) throw new Error('Tenant DB and Organization ID are required');
    const orgIdBuffer = Buffer.from(organizationId.replace(/-/g, ''), 'hex');

    const {
        collegeName, collegeEmail,
        address, country, state, city, pincode,
        university, websiteUrl, aboutUs
    } = details;

    const idBuffer = Buffer.from(uuidv4().replace(/-/g, ''), 'hex');
    await db.query(
        `INSERT INTO \`${tenantDb}\`.college_details (
            id, organization_id, college_name, college_email, address, 
            country, state, city, pincode, university, website_url, about_us
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON DUPLICATE KEY UPDATE 
            college_name = VALUES(college_name),
            college_email = VALUES(college_email),
            address = VALUES(address),
            country = VALUES(country),
            state = VALUES(state),
            city = VALUES(city),
            pincode = VALUES(pincode),
            university = VALUES(university),
            website_url = VALUES(website_url),
            about_us = VALUES(about_us),
            updated_at = NOW()`,
        [
            idBuffer, orgIdBuffer,
            collegeName, collegeEmail, address,
            country, state, city, pincode,
            university, websiteUrl, aboutUs
        ]
    );
    return { success: true };
};

const getCompanyDetails = async (tenantDb, organizationId) => {
    if (!tenantDb || !organizationId) throw new Error('Tenant DB and Organization ID are required');
    const orgIdBuffer = Buffer.from(organizationId.replace(/-/g, ''), 'hex');
    // Check if company_details table exists
    const tableRows = await db.query(
        'SELECT TABLE_NAME FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ?',
        [tenantDb, 'company_details']
    );

    if (tableRows.length === 0) {
        console.warn(`[AdminService.getCompanyDetails] Table 'company_details' does not exist in ${tenantDb}`);
        return null;
    }

    const rows = await db.query(
        `SELECT HEX(id) as id, HEX(organization_id) as organizationId, 
                company_name as companyName, company_email as companyEmail,
                address, country, state, city, pincode, industry_type as industryType,
                founded_year as foundedYear, website_url as websiteUrl, 
                linkedin_url as linkedinUrl, instagram_url as instagramUrl,
                facebook_url as facebookUrl, about_us as aboutUs,
                created_at as createdAt, updated_at as updatedAt
         FROM \`${tenantDb}\`.company_details 
         WHERE organization_id = ? OR HEX(organization_id) = ? LIMIT 1`,
        [orgIdBuffer, organizationId.replace(/-/g, '').toUpperCase()]
    );

    if (rows.length === 0) return null;

    return rows[0];
};

const updateCompanyDetails = async (tenantDb, organizationId, details) => {
    if (!tenantDb || !organizationId) throw new Error('Tenant DB and Organization ID are required');
    const orgIdBuffer = Buffer.from(organizationId.replace(/-/g, ''), 'hex');

    const {
        companyName, companyEmail,
        address, country, state, city, pincode,
        industryType, foundedYear, websiteUrl,
        linkedinUrl, instagramUrl, facebookUrl, aboutUs
    } = details;

    const idBuffer = Buffer.from(uuidv4().replace(/-/g, ''), 'hex');
    await db.query(
        `INSERT INTO \`${tenantDb}\`.company_details (
            id, organization_id, company_name, company_email, address, 
            country, state, city, pincode, industry_type, founded_year, 
            website_url, linkedin_url, instagram_url, facebook_url, about_us
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON DUPLICATE KEY UPDATE 
            company_name = VALUES(company_name),
            company_email = VALUES(company_email),
            address = VALUES(address),
            country = VALUES(country),
            state = VALUES(state),
            city = VALUES(city),
            pincode = VALUES(pincode),
            industry_type = VALUES(industry_type),
            founded_year = VALUES(founded_year),
            website_url = VALUES(website_url),
            linkedin_url = VALUES(linkedin_url),
            instagram_url = VALUES(instagram_url),
            facebook_url = VALUES(facebook_url),
            about_us = VALUES(about_us),
            updated_at = NOW()`,
        [
            idBuffer, orgIdBuffer,
            companyName, companyEmail, address,
            country, state, city, pincode,
            industryType, foundedYear, websiteUrl,
            linkedinUrl, instagramUrl, facebookUrl, aboutUs
        ]
    );
    return { success: true };
};

const DEFAULT_AI_SCORING = {
    resume: {
        weightage: { skills: 30, experience: 25, education: 20, certifications: 15, projects: 10 },
        rejection: { notSelected: 50 }
    },
    screening: { recommended: 70, cautiouslyRecommended: 50, notRecommended: 0 },
    assessment: { recommended: 70, cautiouslyRecommended: 50, notRecommended: 0 }
};

const getAiScoringSettings = async (tenantDb, organizationId) => {
    if (!tenantDb || !organizationId) throw new Error('Tenant DB and Organization ID are required');
    const tableRows = await db.query(
        'SELECT TABLE_NAME FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ?',
        [tenantDb, 'ai_scoring_settings']
    );
    if (tableRows.length === 0) return DEFAULT_AI_SCORING;
    const rows = await db.query(
        `SELECT ai_scoring_enabled as aiScoringEnabled,
                weightage_skills as weightageSkills, weightage_experience as weightageExperience,
                weightage_education as weightageEducation, weightage_certifications as weightageCertifications,
                weightage_projects as weightageProjects,
                threshold_selected as thresholdSelected, threshold_not_selected as thresholdNotSelected,
                threshold_rejected as thresholdRejected,
                threshold_recommended as thresholdRecommended, threshold_cautiously_recommended as thresholdCautiouslyRecommended,
                threshold_not_recommended as thresholdNotRecommended
         FROM \`${tenantDb}\`.ai_scoring_settings WHERE organization_id = ? LIMIT 1`,
        [organizationId]
    );
    if (rows.length === 0) return DEFAULT_AI_SCORING;
    const r = rows[0];
    return {
        resume: {
            weightage: {
                skills: r.weightageSkills ?? 30,
                experience: r.weightageExperience ?? 25,
                education: r.weightageEducation ?? 20,
                certifications: r.weightageCertifications ?? 15,
                projects: r.weightageProjects ?? 10
            },
            rejection: {
                notSelected: r.thresholdNotSelected ?? 50
            }
        },
        screening: {
            recommended: r.thresholdRecommended ?? 70,
            cautiouslyRecommended: r.thresholdCautiouslyRecommended ?? 50,
            notRecommended: r.thresholdNotRecommended ?? 0
        },
        assessment: {
            recommended: r.thresholdRecommended ?? 70,
            cautiouslyRecommended: r.thresholdCautiouslyRecommended ?? 50,
            notRecommended: r.thresholdNotRecommended ?? 0
        }
    };
};

const updateAiScoringSettings = async (tenantDb, organizationId, data) => {
    if (!tenantDb || !organizationId) throw new Error('Tenant DB and Organization ID are required');
    const tableRows = await db.query(
        'SELECT TABLE_NAME FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ?',
        [tenantDb, 'ai_scoring_settings']
    );
    if (tableRows.length === 0) {
        await db.query(`
            CREATE TABLE IF NOT EXISTS \`${tenantDb}\`.ai_scoring_settings (
                id BINARY(16) NOT NULL PRIMARY KEY,
                organization_id VARCHAR(36) NOT NULL,
                ai_scoring_enabled TINYINT(1) NOT NULL DEFAULT 1,
                weightage_skills INT NOT NULL DEFAULT 30, weightage_experience INT NOT NULL DEFAULT 25,
                weightage_education INT NOT NULL DEFAULT 20, weightage_certifications INT NOT NULL DEFAULT 15,
                weightage_projects INT NOT NULL DEFAULT 10,
                threshold_selected INT NOT NULL DEFAULT 50, threshold_not_selected INT NOT NULL DEFAULT 50,
                threshold_rejected INT NOT NULL DEFAULT 50,
                threshold_recommended INT NOT NULL DEFAULT 70, threshold_cautiously_recommended INT NOT NULL DEFAULT 50,
                threshold_not_recommended INT NOT NULL DEFAULT 0,
                created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
                UNIQUE KEY uk_ai_scoring_org (organization_id)
            )
        `);
    }
    const idBuffer = Buffer.from(uuidv4().replace(/-/g, ''), 'hex');
    const w = data.resume?.weightage ?? {};
    const rj = data.resume?.rejection ?? {};
    const scr = data.screening ?? {};
    const ast = data.assessment ?? {};
    const enabled = 1;
    const sk = w.skills ?? 30;
    const ex = w.experience ?? 25;
    const ed = w.education ?? 20;
    const cert = w.certifications ?? 15;
    const proj = w.projects ?? 10;
    const nsel = rj.notSelected ?? 50;
    const sel = nsel;
    const rej = nsel;
    const rec = scr.recommended ?? ast.recommended ?? 70;
    const crec = scr.cautiouslyRecommended ?? ast.cautiouslyRecommended ?? 50;
    const nrec = scr.notRecommended ?? ast.notRecommended ?? 0;
    await db.query(
        `INSERT INTO \`${tenantDb}\`.ai_scoring_settings (
            id, organization_id, ai_scoring_enabled,
            weightage_skills, weightage_experience, weightage_education, weightage_certifications, weightage_projects,
            threshold_selected, threshold_not_selected, threshold_rejected,
            threshold_recommended, threshold_cautiously_recommended, threshold_not_recommended
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON DUPLICATE KEY UPDATE
            ai_scoring_enabled = VALUES(ai_scoring_enabled),
            weightage_skills = VALUES(weightage_skills), weightage_experience = VALUES(weightage_experience),
            weightage_education = VALUES(weightage_education), weightage_certifications = VALUES(weightage_certifications),
            weightage_projects = VALUES(weightage_projects),
            threshold_selected = VALUES(threshold_selected), threshold_not_selected = VALUES(threshold_not_selected),
            threshold_rejected = VALUES(threshold_rejected),
            threshold_recommended = VALUES(threshold_recommended), threshold_cautiously_recommended = VALUES(threshold_cautiously_recommended),
            threshold_not_recommended = VALUES(threshold_not_recommended),
            updated_at = NOW()`,
        [idBuffer, organizationId, enabled, sk, ex, ed, cert, proj, sel, nsel, rej, rec, crec, nrec]
    );
    return { success: true };
};

const DEFAULT_CROSS_QUESTION = { crossQuestionCountGeneral: 2, crossQuestionCountPosition: 2 };

const getCrossQuestionSettings = async (tenantDb, organizationId) => {
    if (!tenantDb || !organizationId) throw new Error('Tenant DB and Organization ID are required');
    const [tableRows] = await db.query(
        'SELECT TABLE_NAME FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ?',
        [tenantDb, 'cross_question_settings']
    ).catch(() => [[]]);
    if (!tableRows || tableRows.length === 0) return DEFAULT_CROSS_QUESTION;
    const rows = await db.query(
        `SELECT cross_question_count_general AS crossQuestionCountGeneral,
                cross_question_count_position AS crossQuestionCountPosition
         FROM \`${tenantDb}\`.cross_question_settings WHERE organization_id = ? LIMIT 1`,
        [organizationId]
    );
    if (rows.length === 0) return DEFAULT_CROSS_QUESTION;
    const r = rows[0];
    const general = Math.min(4, Math.max(1, Number(r.crossQuestionCountGeneral) || 2));
    const position = Math.min(4, Math.max(1, Number(r.crossQuestionCountPosition) || 2));
    return { crossQuestionCountGeneral: general, crossQuestionCountPosition: position };
};

const updateCrossQuestionSettings = async (tenantDb, organizationId, data) => {
    if (!tenantDb || !organizationId) throw new Error('Tenant DB and Organization ID are required');
    const general = Math.min(4, Math.max(1, Number(data.crossQuestionCountGeneral) || 2));
    const position = Math.min(4, Math.max(1, Number(data.crossQuestionCountPosition) || 2));
    await db.query(
        'SELECT TABLE_NAME FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ?',
        [tenantDb, 'cross_question_settings']
    ).then(async (tableRows) => {
        if (!tableRows || tableRows.length === 0) {
            await db.query(`
                CREATE TABLE IF NOT EXISTS \`${tenantDb}\`.cross_question_settings (
                    id BINARY(16) NOT NULL PRIMARY KEY,
                    organization_id VARCHAR(36) NOT NULL,
                    cross_question_count_general TINYINT NOT NULL DEFAULT 2,
                    cross_question_count_position TINYINT NOT NULL DEFAULT 2,
                    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
                    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
                    UNIQUE KEY uk_cross_question_org (organization_id)
                ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
            `);
        }
    });
    const idBuffer = Buffer.from(uuidv4().replace(/-/g, ''), 'hex');
    await db.query(
        `INSERT INTO \`${tenantDb}\`.cross_question_settings (id, organization_id, cross_question_count_general, cross_question_count_position)
         VALUES (?, ?, ?, ?)
         ON DUPLICATE KEY UPDATE
            cross_question_count_general = VALUES(cross_question_count_general),
            cross_question_count_position = VALUES(cross_question_count_position),
            updated_at = NOW()`,
        [idBuffer, organizationId, general, position]
    );
    return { success: true };
};

const getOrganizationInfo = async (organizationId) => {
    if (!organizationId) throw new Error('Organization ID is required');
    const rows = await db.authQuery(
        'SELECT id, name, metadata, is_active as isActive FROM organizations WHERE id = ? LIMIT 1',
        [organizationId]
    );

    if (rows.length === 0) return null;
    
    const org = rows[0];

    // Attempt to find schemaName from users table since it's missing in organizations
    let userRows = await db.authQuery(
        'SELECT client FROM users WHERE (organization_id = ? OR id = ?) AND client IS NOT NULL LIMIT 1',
        [organizationId, organizationId]
    );
    
    // Binary fallback for schemaName
    if (userRows.length === 0 && organizationId.length >= 32) {
        try {
            const cleanId = organizationId.replace(/-/g, '');
            if (cleanId.length === 32) {
                const buffer = Buffer.from(cleanId, 'hex');
                userRows = await db.authQuery(
                    'SELECT client FROM users WHERE organization_id = ? AND client IS NOT NULL LIMIT 1',
                    [buffer]
                );
            }
        } catch (e) {}
    }
    const schemaName = userRows.length > 0 ? userRows[0].client : null;
    
    // Parse metadata to see if it's a college or company if possible, 
    // but the main goal is to return the name and basic status.
    let isCollege = null;
    try {
        const metadata = typeof org.metadata === 'string' ? JSON.parse(org.metadata) : org.metadata;
        if (metadata && metadata.isCollege !== undefined) {
            isCollege = !!metadata.isCollege;
        }
    } catch (e) {}

    // Smart Inference: if isCollege is null but we have a schema, check the schema
    if (isCollege === null && schemaName) {
        try {
            const tables = await db.query(
                "SELECT TABLE_NAME FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_SCHEMA = ? AND TABLE_NAME IN ('college_details', 'company_details', 'COLLEGE_DETAILS', 'COMPANY_DETAILS')",
                [schemaName]
            );
            const tableNames = (tables || []).map(t => t.TABLE_NAME.toLowerCase());
            
            if (tableNames.includes('college_details') && !tableNames.includes('company_details')) {
                isCollege = true;
            } else if (tableNames.includes('company_details')) {
                isCollege = false;
            } else if (tableNames.includes('college_details')) {
                 isCollege = true;
            }
            
            // Persist back to metadata for performance next time
            try {
                const currentMetadata = (typeof org.metadata === 'string' ? JSON.parse(org.metadata) : org.metadata) || {};
                const updatedMetadata = { ...currentMetadata, isCollege };
                await db.authQuery(
                    "UPDATE organizations SET metadata = ? WHERE id = ?",
                    [JSON.stringify(updatedMetadata), organizationId]
                );
                console.log(`[AdminService] Inferred isCollege=${isCollege} for Org=${organizationId} and updated metadata.`);
            } catch (updateErr) {
                console.error(`[AdminService] Failed to persist inferred isCollege for ${organizationId}:`, updateErr.message);
            }
        } catch (schemaErr) {
            console.warn(`[AdminService] Could not check schema ${schemaName} for isCollege inference:`, schemaErr.message);
        }
    }

    return {
        id: org.id,
        name: org.name,
        schemaName: schemaName,
        isActive: !!org.isActive,
        isCollege: isCollege
    };
};

const utilizeInterviewCredit = async (tenantDb, organizationId) => {
    if (!tenantDb || !organizationId) throw new Error('Tenant DB and Organization ID are required');
    await db.query(
        `UPDATE \`${tenantDb}\`.credits 
         SET utilized_interview_credits = utilized_interview_credits + 1,
             updated_at = NOW()
         WHERE is_active = 1 OR id IS NOT NULL 
         ORDER BY is_active DESC, created_at DESC LIMIT 1`
    );
};

const utilizeScreeningCredit = async (tenantDb, organizationId) => {
    if (!tenantDb || !organizationId) throw new Error('Tenant DB and Organization ID are required');
    await db.query(
        `UPDATE \`${tenantDb}\`.credits 
         SET utilized_screening_credits = utilized_screening_credits + 1,
             updated_at = NOW()
         WHERE is_active = 1 OR id IS NOT NULL 
         ORDER BY is_active DESC, created_at DESC LIMIT 1`
     );
 };

const utilizePositionCredit = async (tenantDb, organizationId) => {
    if (!tenantDb || !organizationId) throw new Error('Tenant DB and Organization ID are required');
    await db.query(
        `UPDATE \`${tenantDb}\`.credits 
         SET utilized_position_credits = utilized_position_credits + 1,
             updated_at = NOW()
         WHERE is_active = 1 OR id IS NOT NULL 
         ORDER BY is_active DESC, created_at DESC LIMIT 1`
    );
};

module.exports = {
    createAdminWithDB,
    provisionAdminSchema,
    getCredits,
    getCreditHistory,
    requestPasswordReset,
    resetPassword,
    getCollegeDetails,
    updateCollegeDetails,
    getCompanyDetails,
    updateCompanyDetails,
    getAiScoringSettings,
    updateAiScoringSettings,
    getCrossQuestionSettings,
    updateCrossQuestionSettings,
    getOrganizationInfo,
    utilizeInterviewCredit,
    utilizeScreeningCredit,
    utilizePositionCredit
};
