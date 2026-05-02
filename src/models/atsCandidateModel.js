const { v4: uuidv4 } = require('uuid');
const db = require('../config/db');

class AtsCandidateModel {
  /**
   * Initializes schemas across global candidates_db and tenant-specific database.
   * ats_candidates (Master Profile) stays in candidates_db.
   * candidates_applied (Applications) and ats_job_stages (Metadata) move to tenantDb.
   */
  static async ensureAtsCandidatesTable(tenantDb) {
    const globalDatabase = 'candidates_db';
    
    // 1. Global Cleanup (candidates_db) - Move these out of tenant admin loops
    try {
        await db.query(`DROP TABLE IF EXISTS \`${globalDatabase}\`.\`ats_private_link\``);
        await db.query(`DROP TABLE IF EXISTS \`${globalDatabase}\`.\`ats_position_candidates\``);
        await db.query(`DROP TABLE IF EXISTS \`${globalDatabase}\`.\`email_templates\``);
        await db.query(`DROP TABLE IF EXISTS \`${globalDatabase}\`.\`ats_job_stages\``);
    } catch (cleanupErr) {
        console.warn('[AtsCandidateModel] Global cleanup warning:', cleanupErr.message);
    }

    // 2. Persona-Specific Cleanup & Initialization
    let isCollege = false;
    if (tenantDb) {
        try {
            // Check organization persona from auth_db
            const orgRows = await db.authQuery('SELECT metadata FROM organizations WHERE LOWER(name) = ?', [tenantDb.replace('college_', '')]);
            if (orgRows && orgRows.length > 0) {
                const metadata = orgRows[0].metadata;
                isCollege = metadata && metadata.isCollege === true;
            }

            if (isCollege) {
                // College Persona: Keep it clean, no ATS-specific tables
                console.log(`[AtsCandidateModel] College Persona detected for ${tenantDb}. Cleaning up ATS tables.`);
                await db.query(`DROP TABLE IF EXISTS \`${tenantDb}\`.\`candidates_job\``);
                await db.query(`DROP TABLE IF EXISTS \`${tenantDb}\`.\`candidates_applied\``);
                await db.query(`DROP TABLE IF EXISTS \`${tenantDb}\`.\`ats_position_candidates\``);
                await db.query(`DROP TABLE IF EXISTS \`${tenantDb}\`.\`ats_job_stages\``);
                // Note: keeping email_templates as colleges may use them for other modules
                return; // Stop here for College admins
            } else {
                // ATS Persona: Explicit cleanup of unwanted tables before initialization
                await db.query(`DROP TABLE IF EXISTS \`${tenantDb}\`.\`ats_position_candidates\``);
                const tableCheck = await db.query(`SHOW TABLES FROM \`${tenantDb}\` LIKE 'candidates_applied'`);
                if (tableCheck.length > 0) {
                    await db.query(`RENAME TABLE \`${tenantDb}\`.\`candidates_applied\` TO \`${tenantDb}\`.\`candidates_job\``);
                }
            }
        } catch (personaErr) {
            console.warn('[AtsCandidateModel] Persona check warning:', personaErr.message);
        }
    }

    // 3. Ensure global candidates_db and Master Profile table exists
    
    const createMasterProfileTable = `
      CREATE TABLE IF NOT EXISTS \`${globalDatabase}\`.\`ats_candidates\` (
        \`id\` BINARY(16) NOT NULL,
        \`organization_id\` BINARY(16) NOT NULL,
        \`name\` VARCHAR(255) NOT NULL,
        \`email\` VARCHAR(255) NOT NULL,
        \`mobile_number\` VARCHAR(20) DEFAULT NULL,
        \`candidate_code\` VARCHAR(50) DEFAULT NULL,
        \`current_location\` VARCHAR(255) DEFAULT NULL,
        \`current_organization\` VARCHAR(255) DEFAULT NULL,
        \`total_experience\` VARCHAR(50) DEFAULT NULL,
        \`current_ctc\` DECIMAL(15,2) DEFAULT NULL,
        \`expected_ctc\` DECIMAL(15,2) DEFAULT NULL,
        \`notice_period\` VARCHAR(50) DEFAULT NULL,
        \`linkedin_link\` TEXT DEFAULT NULL,
        \`extracted_json\` JSON DEFAULT NULL,
        \`skills\` JSON DEFAULT NULL,
        \`status\` ENUM('ACTIVE', 'INACTIVE', 'BLACKLISTED') DEFAULT 'ACTIVE',
        \`created_at\` TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        \`updated_at\` TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        PRIMARY KEY (\`id\`),
        UNIQUE KEY \`uk_ats_org_email\` (\`organization_id\`, \`email\`),
        UNIQUE KEY \`uk_ats_org_mobile\` (\`organization_id\`, \`mobile_number\`)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
    `;
    await db.query(createMasterProfileTable);

    if (!tenantDb) return;

    // 2. Ensure tenant-specific Recruitment Stages table exists
    const createStagesTable = `
      CREATE TABLE IF NOT EXISTS \`${tenantDb}\`.\`ats_job_stages\` (
        \`id\` INT NOT NULL AUTO_INCREMENT,
        \`stage_id\` VARCHAR(50) NOT NULL,
        \`title\` VARCHAR(100) NOT NULL,
        \`description\` TEXT,
        \`icon\` VARCHAR(50) DEFAULT 'User',
        \`color\` VARCHAR(100) DEFAULT 'bg-slate-50',
        \`sort_order\` INT DEFAULT 0,
        \`is_fixed\` TINYINT(1) DEFAULT 0,
        PRIMARY KEY (\`id\`),
        UNIQUE KEY \`uk_stage_id\` (\`stage_id\`)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
    `;
    await db.query(createStagesTable);

    // 3. Seed default stages into tenantDb if empty
    const stagesCount = await db.query(`SELECT COUNT(*) as cnt FROM \`${tenantDb}\`.\`ats_job_stages\``);
    if (stagesCount[0].cnt === 0) {
        const defaultStages = [
            ['active_candidates', 'Active', 'Potential candidates for this job', 'User', 'bg-slate-50 border-slate-200 text-slate-500', 0, 1],
            ['invitations', 'Invited', 'Candidates who have been invited to this job', 'Mail', 'bg-indigo-50 border-indigo-100 text-indigo-500', 1, 0],
            ['ai_test', 'KareerGrowth Assessment', 'Candidates undergoing AI screening', 'Bot', 'bg-purple-50 border-purple-100 text-purple-500', 2, 0],
            ['recommended', 'Recommended', 'Profiles strongly recommended by AI', 'CheckCircle', 'bg-emerald-50 border-emerald-100 text-emerald-500', 3, 0],
            ['not_recommended', 'Not Recommended', 'Profiles flagged as not suitable', 'XCircle', 'bg-rose-50 border-rose-100 text-rose-500', 4, 0],
            ['cautious', 'Cautiously Recommended', 'Profiles requiring human review', 'Activity', 'bg-amber-50 border-amber-100 text-amber-500', 5, 0],
            ['rejected', 'Rejected', 'Candidates rejected after review', 'UserX', 'bg-rose-100 border-rose-200 text-rose-600', 6, 0],
            ['resume_rejected', 'Resume Rejected', 'Candidates whose resumes did not match', 'FileX', 'bg-slate-100 border-slate-200 text-slate-600', 7, 0],
            ['scheduled', 'Schedule Interview', 'Candidates scheduled for human interview', 'Calendar', 'bg-blue-50 border-blue-100 text-blue-500', 8, 0],
            ['hr_round', 'HR Round', 'Candidates selected for HR review', 'UserCheck', 'bg-amber-50 border-amber-100 text-amber-500', 9, 0],
            ['shortlisted', 'Shortlisted', 'Candidates finalized for offer', 'Award', 'bg-emerald-50 border-emerald-100 text-emerald-500', 10, 0],
            ['offer', 'Offer letter sent', 'Candidates who have been sent an offer letter', 'Send', 'bg-sky-50 border-sky-100 text-sky-500', 11, 0]
        ];
        for (const stage of defaultStages) {
            await db.query(
                `INSERT IGNORE INTO \`${tenantDb}\`.\`ats_job_stages\` (stage_id, title, description, icon, color, sort_order, is_fixed) VALUES (?, ?, ?, ?, ?, ?, ?)`,
                stage
            );
        }
    }

    // 4. Ensure tenant-specific Linking Table exists (Application & Assessment Data)
    const createApplicationsTable = `
      CREATE TABLE IF NOT EXISTS \`${tenantDb}\`.\`candidates_job\` (
        \`id\` BINARY(16) NOT NULL,
        \`candidate_id\` BINARY(16) NOT NULL,
        \`job_id\` BINARY(16) NOT NULL,
        \`stage\` VARCHAR(50) DEFAULT 'active_candidates',
        \`resume_url\` TEXT DEFAULT NULL,
        \`resume_filename\` VARCHAR(255) DEFAULT NULL,
        \`resume_score\` INT DEFAULT 0,
        \`source\` ENUM('RESUME', 'MANUAL') DEFAULT 'MANUAL',
        \`internal_notes\` TEXT DEFAULT NULL,
        \`invitation_token\` VARCHAR(255) DEFAULT NULL,
        \`expires_at\` TIMESTAMP NULL DEFAULT NULL,
        \`invited_at\` TIMESTAMP NULL DEFAULT NULL,
        
        -- Assessment specific columns merged from ats_position_candidates
        \`job_title\` VARCHAR(255) DEFAULT NULL,
        \`job_code\` VARCHAR(100) DEFAULT NULL,
        \`candidate_name\` VARCHAR(255) DEFAULT NULL,
        \`assessment_status\` VARCHAR(50) DEFAULT 'Invited',
        \`recommendation\` VARCHAR(50) DEFAULT 'PENDING',
        \`question_set_id\` BINARY(16) DEFAULT NULL,
        \`link_active_at\` DATETIME DEFAULT NULL,
        \`link_expires_at\` DATETIME DEFAULT NULL,
        \`invitation_sent_at\` DATETIME DEFAULT NULL,
        
        \`created_at\` TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        \`updated_at\` TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        PRIMARY KEY (\`id\`),
        UNIQUE KEY \`uk_candidate_job\` (\`candidate_id\`, \`job_id\`),
        INDEX \`idx_cj_stage\` (\`stage\`),
        INDEX \`idx_cj_assessment_status\` (\`assessment_status\`)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
    `;
    await db.query(createApplicationsTable);

    // 5. Ensure email_templates table exists in tenant DB
    const createEmailTemplatesTable = `
      CREATE TABLE IF NOT EXISTS \`${tenantDb}\`.\`email_templates\` (
        \`id\` VARCHAR(36) NOT NULL,
        \`organization_id\` VARCHAR(36) NOT NULL,
        \`name\` VARCHAR(255) NOT NULL,
        \`to_field\` VARCHAR(255) DEFAULT NULL,
        \`subject\` VARCHAR(255) DEFAULT NULL,
        \`body\` TEXT DEFAULT NULL,
        \`cc\` VARCHAR(255) DEFAULT NULL,
        \`created_at\` TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        \`updated_at\` TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        PRIMARY KEY (\`id\`),
        INDEX \`idx_et_org\` (\`organization_id\`)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
    `;
    await db.query(createEmailTemplatesTable);
  }

  /**
   * Seeds default email templates for a tenant organization.
   */
  static async seedDefaultTemplates(tenantDb, organizationId) {
    if (!tenantDb) return;

    // 1. Ensure table exists first
    const createEmailTemplatesTable = `
      CREATE TABLE IF NOT EXISTS \`${tenantDb}\`.\`email_templates\` (
        \`id\` VARCHAR(36) NOT NULL,
        \`organization_id\` VARCHAR(36) NOT NULL,
        \`name\` VARCHAR(255) NOT NULL,
        \`to_field\` VARCHAR(255) DEFAULT NULL,
        \`subject\` VARCHAR(255) DEFAULT NULL,
        \`body\` TEXT DEFAULT NULL,
        \`cc\` VARCHAR(255) DEFAULT NULL,
        \`created_at\` TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        \`updated_at\` TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        PRIMARY KEY (\`id\`),
        INDEX \`idx_et_org\` (\`organization_id\`)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
    `;
    await db.query(createEmailTemplatesTable);

    const templates = [
      {
        id: uuidv4(),
        name: 'Public Link Invitation',
        subject: 'Assessment Invitation: {Position_title}',
        body: 'Hi {candidate_name},\n\nYou have been invited to apply for the position: {Position_title} at {company_name}.\n\nPlease register and complete the assessment using the link below:\n{public_link}\n\nBest regards,\n{company_name} Recruitment Team'
      }
    ];

    for (const t of templates) {
      const check = await db.query(
        `SELECT id FROM \`${tenantDb}\`.email_templates WHERE name = ? AND organization_id = ? LIMIT 1`,
        [t.name, organizationId]
      );

      if (check.length === 0) {
        await db.query(
          `INSERT INTO \`${tenantDb}\`.email_templates (id, organization_id, name, subject, body) VALUES (?, ?, ?, ?, ?)`,
          [t.id, organizationId, t.name, t.subject, t.body]
        );
        console.log(`[AtsCandidateModel] Seeded default template "${t.name}" for org ${organizationId}`);
      }
    }
  }

  // Helper to convert UUID string to BINARY(16) Buffer
  static uuidToBinary(uuid) {
    if (!uuid) return null;
    if (Buffer.isBuffer(uuid)) return uuid;
    const hex = uuid.toString().replace(/-/g, '');
    if (hex.length !== 32) return null;
    return Buffer.from(hex, 'hex');
  }

  // Helper to convert BINARY(16) Buffer to UUID string
  static binaryToUuid(buf) {
    if (!buf || !Buffer.isBuffer(buf)) return null;
    const hex = buf.toString('hex');
    if (hex.length !== 32) return null;
    return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`;
  }

  /**
   * Create a private link in the shared candidates_db.private_link table.
   * Maps job identifiers to position identifiers for consistency with college module.
   */
  static async createPrivateLink(linkData) {
    const linkId = uuidv4();
    const idBinary = this.uuidToBinary(linkId);
    const candidateIdBinary = this.uuidToBinary(linkData.candidateId);
    // client_id in private_link is VARCHAR(255), not BINARY(16)
    const clientId = linkData.clientId; 
    const jobIdBinary = this.uuidToBinary(linkData.jobId);
    const questionSetIdBinary = this.uuidToBinary(linkData.questionSetId);
    const createdByBinary = this.uuidToBinary(linkData.createdBy);

    const query = `
      INSERT INTO \`candidates_db\`.\`private_link\` 
      (id, candidate_id, candidate_name, client_id, company_name, email, position_id, position_name, 
       question_set_id, interview_platform, link, verification_code, link_active_at, link_expires_at, 
       interview_taken, is_active, created_by)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `;

    const values = [
      idBinary,
      candidateIdBinary,
      linkData.candidateName,
      clientId,
      linkData.companyName,
      linkData.email,
      jobIdBinary, // Stored in position_id col
      linkData.jobTitle, // Stored in position_name col
      questionSetIdBinary,
      linkData.interviewPlatform || 'BROWSER',
      linkData.link,
      linkData.verificationCode,
      linkData.linkActiveAt || new Date(),
      linkData.linkExpiresAt,
      0, // interview_taken (BIT(1) in schema, 0/1 works)
      1, // is_active (BIT(1) in schema, 0/1 works)
      createdByBinary
    ];

    await db.query(query, values);
    return { linkId };
  }

  static async getPrivateLink(candidateId, jobId) {
    const candidateIdBinary = this.uuidToBinary(candidateId);
    const jobIdBinary = this.uuidToBinary(jobId);

    const query = `
      SELECT id, candidate_id, candidate_name, client_id, company_name, email, position_id, position_name,
             question_set_id, interview_platform, link, verification_code, link_active_at, link_expires_at,
             interview_taken, is_active, created_at, updated_at
      FROM \`candidates_db\`.\`private_link\`
      WHERE candidate_id = ? AND position_id = ? AND is_active = 1
      ORDER BY created_at DESC LIMIT 1
    `;
    const rows = await db.query(query, [candidateIdBinary, jobIdBinary]);
    if (!rows || rows.length === 0) return null;
    
    const r = rows[0];
    return {
      id: this.binaryToUuid(r.id),
      candidateId: this.binaryToUuid(r.candidate_id),
      candidateName: r.candidate_name,
      clientId: r.client_id,
      companyName: r.company_name,
      email: r.email,
      jobId: this.binaryToUuid(r.position_id),
      jobTitle: r.position_name,
      questionSetId: this.binaryToUuid(r.question_set_id),
      interviewPlatform: r.interview_platform,
      link: r.link,
      verificationCode: r.verification_code,
      linkActiveAt: r.link_active_at,
      linkExpiresAt: r.link_expires_at,
      interviewTaken: Boolean(r.interview_taken),
      isActive: Boolean(r.is_active),
      createdAt: r.created_at,
      updatedAt: r.updated_at
    };
  }

  static async createAtsPositionCandidate(tenantDb, data) {
    const id = uuidv4();
    const idBinary = this.uuidToBinary(id);
    const candidateIdBinary = this.uuidToBinary(data.candidateId);
    const jobIdBinary = this.uuidToBinary(data.jobId);
    const organizationIdBinary = this.uuidToBinary(data.organizationId);
    const questionSetIdBinary = this.uuidToBinary(data.questionSetId);

    const query = `
      INSERT INTO \`${tenantDb}\`.\`ats_position_candidates\` 
      (id, candidate_id, job_id, organization_id, job_title, job_code, candidate_name, 
       status, recommendation, question_set_id, link_active_at, link_expires_at, invitation_sent_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON DUPLICATE KEY UPDATE 
        job_title = VALUES(job_title),
        job_code = VALUES(job_code),
        candidate_name = VALUES(candidate_name),
        status = VALUES(status),
        recommendation = VALUES(recommendation),
        question_set_id = VALUES(question_set_id),
        link_active_at = VALUES(link_active_at),
        link_expires_at = VALUES(link_expires_at),
        invitation_sent_at = VALUES(invitation_sent_at),
        updated_at = CURRENT_TIMESTAMP
    `;

    const values = [
      idBinary, candidateIdBinary, jobIdBinary, organizationIdBinary, 
      data.jobTitle, data.jobCode, data.candidateName,
      data.status || 'Invited', data.recommendation || 'PENDING', 
      questionSetIdBinary, data.linkActiveAt, data.linkExpiresAt, data.invitationSentAt || new Date()
    ];

    await db.query(query, values);
    return id;
  }

  static async getJobStages(tenantDb, organizationId) {
    if (!tenantDb) return [];
    await this.ensureAtsCandidatesTable(tenantDb);
    return await db.query(`SELECT * FROM \`${tenantDb}\`.\`ats_job_stages\` ORDER BY sort_order ASC`);
  }

  static async createJobStage(tenantDb, stageData) {
    if (!tenantDb) throw new Error('tenantDb is required');
    await this.ensureAtsCandidatesTable(tenantDb);

    const { stageId, title, description, icon, color } = stageData;
    const nextSortRows = await db.query(
      `SELECT COALESCE(MAX(sort_order), -1) + 1 as next_sort FROM \`${tenantDb}\`.\`ats_job_stages\``
    );
    const nextSort = Number(nextSortRows?.[0]?.next_sort || 0);

    await db.query(
      `INSERT INTO \`${tenantDb}\`.\`ats_job_stages\`
        (stage_id, title, description, icon, color, sort_order, is_fixed)
       VALUES (?, ?, ?, ?, ?, ?, 0)`,
      [stageId, title, description || '', icon || 'Activity', color || 'bg-slate-50 border-slate-200 text-slate-500', nextSort]
    );

    const createdRows = await db.query(
      `SELECT * FROM \`${tenantDb}\`.\`ats_job_stages\` WHERE stage_id = ? LIMIT 1`,
      [stageId]
    );
    return createdRows?.[0] || null;
  }

  static async createCandidate(tenantDb, organizationId, candidateData) {
    const globalDatabase = 'candidates_db';
    await this.ensureAtsCandidatesTable(tenantDb);
    
    const {
      name, email, mobileNumber, jobId, stage = 'active_candidates',
      resumeUrl, resumeFilename, resumeScore, source, internalNotes,
      currentLocation, currentOrganization, totalExperience,
      currentCtc, expectedCtc, noticePeriod, linkedinLink, skills,
      extractedJson
    } = candidateData;

    const orgIdClean = organizationId.replace(/-/g, '');
    const jobIdClean = jobId ? jobId.replace(/-/g, '') : null;

    // 1. Upsert Global Candidate Profile
    let candidateId;
    const [existing] = await db.query(
      `SELECT LOWER(BIN_TO_UUID(id)) as id FROM \`${globalDatabase}\`.\`ats_candidates\` 
       WHERE organization_id = UNHEX(?) AND (
         (email = ? AND email != '' AND email IS NOT NULL) OR 
         (mobile_number = ? AND mobile_number != '' AND mobile_number IS NOT NULL)
       )`,
      [orgIdClean, email, mobileNumber]
    );

    if (existing) {
      candidateId = existing.id;
      // Update basic info in global profile but KEEP the same candidateCode
      await db.query(
        `UPDATE \`${globalDatabase}\`.\`ats_candidates\` SET 
          name = ?, current_location = ?, current_organization = ?, 
          total_experience = ?, current_ctc = ?, expected_ctc = ?, 
          notice_period = ?, linkedin_link = ?, skills = ?, extracted_json = ?
         WHERE id = UNHEX(?)`,
        [name, currentLocation, currentOrganization, totalExperience, currentCtc, expectedCtc, noticePeriod, linkedinLink, JSON.stringify(skills || []), JSON.stringify(extractedJson || null), candidateId.replace(/-/g, '')]
      );
    } else {
      candidateId = uuidv4().replace(/-/g, '');
      const prefix = name.substring(0, 3).toUpperCase();
      const [countRow] = await db.query(
        `SELECT COUNT(*) as count FROM \`${globalDatabase}\`.\`ats_candidates\` WHERE organization_id = UNHEX(?) AND candidate_code LIKE ?`,
        [orgIdClean, `${prefix}%`]
      );
      const code = `${prefix}${String(countRow.count + 1).padStart(3, '0')}`;

      await db.query(
        `INSERT INTO \`${globalDatabase}\`.\`ats_candidates\` (
          id, organization_id, name, email, mobile_number, candidate_code,
          current_location, current_organization, total_experience,
          current_ctc, expected_ctc, notice_period, linkedin_link, skills, extracted_json
        ) VALUES (UNHEX(?), UNHEX(?), ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [candidateId, orgIdClean, name, email, mobileNumber, code, currentLocation, currentOrganization, totalExperience, currentCtc, expectedCtc, noticePeriod, linkedinLink, JSON.stringify(skills || []), JSON.stringify(extractedJson || null)]
      );
    }

    // 2. Create/Update Tenant-Specific Application Record
    if (jobIdClean) {
        const appId = uuidv4().replace(/-/g, '');
        const appQuery = `
            INSERT INTO \`${tenantDb}\`.\`candidates_job\` (
              id, candidate_id, job_id, stage, resume_url, resume_filename, resume_score, source, internal_notes, invited_at
            ) VALUES (UNHEX(?), UNHEX(?), UNHEX(?), ?, ?, ?, ?, ?, ?, NOW())
            ON DUPLICATE KEY UPDATE 
              resume_url = VALUES(resume_url),
              resume_filename = VALUES(resume_filename),
              resume_score = VALUES(resume_score),
              updated_at = NOW()
        `;
        await db.query(appQuery, [appId, candidateId.replace(/-/g, ''), jobIdClean, stage, resumeUrl, resumeFilename, resumeScore || 0, source || 'MANUAL', internalNotes || '']);
    }

    return candidateId;
  }

  static async getCandidates(tenantDb, organizationId, jobId = null, stage = null, limit = 10, offset = 0, search = null, candidateId = null) {
    const globalDatabase = 'candidates_db';
    await this.ensureAtsCandidatesTable(tenantDb);
    
    // Check which column exists in question_sets: job_id or position_id
    const columnCheck = await db.query(
        `SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS 
         WHERE TABLE_SCHEMA = ? AND TABLE_NAME = 'question_sets' AND COLUMN_NAME IN ('job_id', 'position_id')`,
        [tenantDb]
    );
    const existingColumns = columnCheck.map(c => c.COLUMN_NAME);
    const qsIdColumn = existingColumns.includes('job_id') ? 'job_id' : 'position_id';

    let whereClause = `WHERE c.organization_id = UNHEX(?)`;
    const params = [organizationId.replace(/-/g, '')];

    if (jobId) {
        whereClause += ` AND ja.job_id = UNHEX(?)`;
        params.push(jobId.replace(/-/g, ''));
    }

    if (candidateId) {
        whereClause += ` AND c.id = UNHEX(?)`;
        params.push(candidateId.replace(/-/g, ''));
    }

    if (stage && stage !== 'ALL') {
        whereClause += ` AND ja.stage = ?`;
        params.push(stage);
    }

    if (search) {
        whereClause += ` AND (c.name LIKE ? OR c.email LIKE ? OR c.candidate_code LIKE ?)`;
        const searchParam = `%${search}%`;
        params.push(searchParam, searchParam, searchParam);
    }

    // LIST QUERY (One row per job application)
    const listQuery = `
        SELECT 
        LOWER(BIN_TO_UUID(ja.id)) as id,
        LOWER(BIN_TO_UUID(c.id)) as candidateId,
        LOWER(BIN_TO_UUID(c.organization_id)) as organizationId,
        LOWER(BIN_TO_UUID(ja.job_id)) as jobId,
        ja.stage, c.name, c.email, c.mobile_number as mobileNumber,
        c.candidate_code as candidateCode,
        c.current_location as currentLocation,
        c.current_organization as currentOrganization,
        c.total_experience as totalExperience,
        ja.resume_score as resumeScore,
        ja.resume_filename as resumeFilename,
        ja.resume_url as resumeStoragePath,
        c.skills, c.status,
        p.job_title as jobTitle,
        p.code as jobCode,
        ja.invited_at as invitedAt,
        ja.created_at as createdAt, ja.updated_at as updatedAt,
        (SELECT HEX(id) FROM \`${tenantDb}\`.question_sets WHERE ${qsIdColumn} = ja.job_id AND is_active = 1 LIMIT 1) as questionSetId
        FROM \`${globalDatabase}\`.\`ats_candidates\` c
        JOIN \`${tenantDb}\`.\`candidates_job\` ja ON c.id = ja.candidate_id
        LEFT JOIN \`${tenantDb}\`.\`jobs\` p ON ja.job_id = p.id
        ${whereClause}
        ORDER BY ja.created_at DESC
        LIMIT ? OFFSET ?
    `;

    const candidates = await db.query(listQuery, [...params, parseInt(limit), parseInt(offset)]);

    const countQuery = `
      SELECT COUNT(*) as total 
      FROM \`${globalDatabase}\`.\`ats_candidates\` c
      JOIN \`${tenantDb}\`.\`candidates_job\` ja ON c.id = ja.candidate_id
      ${whereClause}
    `;
    const totalResult = await db.query(countQuery, params);

    return { candidates, total: totalResult[0].total || 0 };
  }

  static async getStatusCounts(tenantDb, organizationId, jobId = null) {
    const globalDatabase = 'candidates_db';
    await this.ensureAtsCandidatesTable(tenantDb);
    
    // 1. Get ALL stages for seeding
    const stages = await this.getJobStages(tenantDb, organizationId);
    const counts = { ALL: 0, active_candidates: 0, invitations: 0 };
    stages.forEach(s => { counts[s.stage_id] = 0; });

    let whereClause = `WHERE c.organization_id = UNHEX(?)`;
    const params = [organizationId.replace(/-/g, '')];

    if (jobId) {
        whereClause += ` AND ja.job_id = UNHEX(?)`;
        params.push(jobId.replace(/-/g, ''));
    }

    // 2. Query counts from tenant-specific linking table
    const countQuery = `
        SELECT ja.stage, COUNT(*) as count 
        FROM \`${tenantDb}\`.\`candidates_job\` ja
        JOIN \`${globalDatabase}\`.\`ats_candidates\` c ON ja.candidate_id = c.id
        ${whereClause}
        GROUP BY ja.stage
    `;
    const rows = await db.query(countQuery, params);

    let total = 0;
    rows.forEach(row => {
        counts[row.stage] = row.count;
        total += row.count;
    });
    counts.ALL = total;

    return counts;
  }

  static async updateCandidateStage(tenantDb, applicationId, stage) {
    await this.ensureAtsCandidatesTable(tenantDb);
    const idClean = applicationId.replace(/-/g, '');
    let query = `UPDATE \`${tenantDb}\`.\`candidates_job\` SET stage = ? WHERE id = UNHEX(?)`;
    if (stage === 'invitations') {
        query = `UPDATE \`${tenantDb}\`.\`candidates_job\` SET stage = ?, invited_at = NOW() WHERE id = UNHEX(?)`;
    }
    console.log(`[AtsCandidateModel] SQL: ${query} params:`, [stage, idClean]);
    const result = await db.query(query, [stage, idClean]);
    console.log(`[AtsCandidateModel] Raw DB Result:`, JSON.stringify(result));
    const affected = (result && result.affectedRows !== undefined) ? result.affectedRows : (result[0] && result[0].affectedRows);
    console.log(`[AtsCandidateModel] Derived AffectedRows: ${affected}`);
    return affected > 0;
  }

  static async getCandidateForInvitation(tenantDb, applicationId) {
    const globalDatabase = 'candidates_db';
    await this.ensureAtsCandidatesTable(tenantDb);
    
    // Check which column exists: job_id or position_id
    const cols = await db.query(
        `SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS 
         WHERE TABLE_SCHEMA = ? AND TABLE_NAME = 'candidates_job' AND COLUMN_NAME IN ('job_id', 'position_id')`,
        [tenantDb]
    );
    const existingColumns = cols.map(c => c.COLUMN_NAME);
    const idColumn = existingColumns.includes('job_id') ? 'job_id' : 'position_id';
    const idClean = applicationId.replace(/-/g, '');
    const idWithDashes = [
        idClean.slice(0, 8),
        idClean.slice(8, 12),
        idClean.slice(12, 16),
        idClean.slice(16, 20),
        idClean.slice(20)
    ].join('-');

    const query = `
      SELECT 
        LOWER(BIN_TO_UUID(ja.id)) as id,
        LOWER(BIN_TO_UUID(c.id)) as candidateId,
        LOWER(BIN_TO_UUID(c.organization_id)) as organization_id,
        LOWER(BIN_TO_UUID(ja.${idColumn})) as job_id,
        LOWER(BIN_TO_UUID(ja.${idColumn})) as position_id,
        ja.stage, c.name, c.email, c.mobile_number, ja.invitation_token, ja.expires_at
      FROM \`${tenantDb}\`.\`candidates_job\` ja
      JOIN \`${globalDatabase}\`.\`ats_candidates\` c ON ja.candidate_id = c.id
      WHERE ja.id = UNHEX(?)
    `;
    const results = await db.query(query, [idClean]);
    const rows = Array.isArray(results[0]) ? results[0] : results;
    return rows && rows.length > 0 ? rows[0] : null;
  }

  static async updateInvitationToken(tenantDb, applicationId, token, expiresAt = null) {
    await this.ensureAtsCandidatesTable(tenantDb);
    const idClean = applicationId.replace(/-/g, '');
    const query = `UPDATE \`${tenantDb}\`.\`candidates_job\` SET invitation_token = ?, expires_at = ? WHERE id = UNHEX(?)`;
    const result = await db.query(query, [token, expiresAt, idClean]);
    return result.affectedRows > 0;
  }

  static async updateAssessmentData(tenantDb, applicationId, data) {
    const idClean = applicationId.replace(/-/g, '');
    const sets = [];
    const values = [];

    if (data.jobTitle !== undefined) { sets.push('job_title = ?'); values.push(data.jobTitle); }
    if (data.jobCode !== undefined) { sets.push('job_code = ?'); values.push(data.jobCode); }
    if (data.candidateName !== undefined) { sets.push('candidate_name = ?'); values.push(data.candidateName); }
    if (data.assessmentStatus !== undefined) { sets.push('assessment_status = ?'); values.push(data.assessmentStatus); }
    if (data.recommendation !== undefined) { sets.push('recommendation = ?'); values.push(data.recommendation); }
    if (data.questionSetId !== undefined) {
        sets.push('question_set_id = UNHEX(?)');
        values.push(data.questionSetId.replace(/-/g, ''));
    }
    if (data.linkActiveAt !== undefined) { sets.push('link_active_at = ?'); values.push(data.linkActiveAt); }
    if (data.linkExpiresAt !== undefined) { sets.push('link_expires_at = ?'); values.push(data.linkExpiresAt); }
    if (data.invitationSentAt !== undefined) { sets.push('invitation_sent_at = ?'); values.push(data.invitationSentAt); }

    if (sets.length === 0) return true;

    values.push(idClean);
    const query = `UPDATE \`${tenantDb}\`.\`candidates_job\` SET ${sets.join(', ')} WHERE id = UNHEX(?)`;
    const result = await db.query(query, values);
    return result.affectedRows > 0;
  }

  static async deleteCandidate(tenantDb, applicationId) {
    await this.ensureAtsCandidatesTable(tenantDb);
    const idClean = applicationId.replace(/-/g, '');
    const query = `DELETE FROM \`${tenantDb}\`.\`candidates_job\` WHERE id = UNHEX(?)`;
    const result = await db.query(query, [idClean]);
    return result.affectedRows > 0;
  }

  static async createPrivateLink(data) {
    const globalDatabase = 'candidates_db';
    const query = `
      INSERT INTO \`${globalDatabase}\`.\`private_link\` (
        id, candidate_id, candidate_name, client_id, company_name, email, position_id, 
        position_name, question_set_id, interview_platform, link, 
        verification_code, link_active_at, link_expires_at, created_by
      ) VALUES (
        UNHEX(?), UNHEX(?), ?, ?, ?, ?, UNHEX(?), 
        ?, UNHEX(?), ?, ?, 
        ?, ?, ?, UNHEX(?)
      )
      ON DUPLICATE KEY UPDATE
        link_expires_at = VALUES(link_expires_at),
        verification_code = VALUES(verification_code),
        updated_at = NOW()
    `;
    const params = [
        data.id.replace(/-/g, ''), // Use the ID generated in service
        data.candidateId.replace(/-/g, ''),
        data.candidateName,
        data.clientId, // This is VARCHAR(255) in schema, NO UNHEX
        data.companyName,
        data.email,
        data.jobId.replace(/-/g, ''),
        data.jobTitle,
        data.questionSetId.replace(/-/g, ''),
        data.interviewPlatform || 'BROWSER',
        data.link,
        data.verificationCode,
        data.linkActiveAt,
        data.linkExpiresAt,
        data.createdBy ? data.createdBy.replace(/-/g, '') : null
    ];
    await db.query(query, params);
    return true;
  }
}

module.exports = AtsCandidateModel;
