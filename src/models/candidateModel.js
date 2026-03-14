const db = require('../config/db');
const { v4: uuidv4 } = require('uuid');
const { CANDIDATE_STATUSES, LINK_TYPES, ASSESSMENT_ROUNDS } = require('./candidateConstants');

const getNextCandidateCode = async (database) => {
  const rows = await db.query(
    `SELECT candidate_code FROM ${database}.college_candidates
     WHERE candidate_code REGEXP '^CAN[0-9]{4,}$'
     ORDER BY CAST(SUBSTRING(candidate_code, 4) AS UNSIGNED) DESC
     LIMIT 1`,
    []
  );

  const maxCode = rows[0]?.candidate_code;
  let maxSeq = 0;
  if (maxCode) {
    maxSeq = parseInt(maxCode.substring(3));
  }

  const nextSeq = maxSeq + 1;
  return `CAN${String(nextSeq).padStart(4, '0')}`;
};

class CandidateModel {
  // Create a new candidate
  static async createCandidate(candidateData, database = 'candidates_db') {
    const candidateId = uuidv4();
    const createdAt = new Date();

    const skillsJson = Array.isArray(candidateData.skills) ? JSON.stringify(candidateData.skills) : (typeof candidateData.skills === 'string' ? candidateData.skills : '[]');
    const query = `
        INSERT INTO ${database}.college_candidates (
          candidate_id, organization_id, candidate_code, register_no,
          candidate_name, department, semester,
          email, mobile_number, location, address, birthdate,
          resume_filename, resume_url,
          interview_notes, internal_notes, notes_by, notes_date,
          status, skills, candidate_created_by, candidate_created_at, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `;

    let candidateCode = candidateData.candidate_code;
    const canMatch = candidateCode && String(candidateCode).trim().match(/^CAN(\d+)$/i);
    if (canMatch) {
      candidateCode = `CAN${String(parseInt(canMatch[1], 10)).padStart(4, '0')}`;
    } else {
      candidateCode = null;
    }
    let inserted = false;
    let attempts = 0;

    while (!inserted && attempts < 3) {
      if (!candidateCode) {
        candidateCode = await getNextCandidateCode(database);
      }

      const values = [
        candidateId,
        candidateData.organization_id,
        candidateCode,
        candidateData.register_no,
        candidateData.candidate_name,
        candidateData.department,
        candidateData.semester,
        candidateData.email,
        candidateData.mobile_number,
        candidateData.location,
        candidateData.address,
        candidateData.birthdate,
        candidateData.resume_filename,
        candidateData.resume_url,
        candidateData.interview_notes,
        candidateData.internal_notes,
        candidateData.notes_by,
        candidateData.notes_date,
        candidateData.status || CANDIDATE_STATUSES.ALL,
        skillsJson,
        candidateData.candidate_created_by,
        candidateData.candidate_created_at || createdAt,
        createdAt,
        createdAt
      ];

      try {
        await db.query(query, values);
        inserted = true;
      } catch (error) {
        if (error && error.code === 'ER_DUP_ENTRY') {
          // If the duplicate is on candidate_code, we retry with a new code
          // BUT if it's on the email+org unique key, we should NOT retry and instead throw a specific error
          if (error.message.includes('uk_email_org') || error.message.includes('college_candidates.email')) {
            throw new Error(`Candidate with email ${candidateData.email} already exists in this organization`);
          }

          candidateCode = null;
          attempts += 1;
          continue;
        }
        throw error;
      }
    }

    if (!inserted) {
      throw new Error('Failed to generate unique candidate code after multiple attempts');
    }

    return candidateId;
  }

  // Get candidate by ID (college_candidates stored in candidates_db)
  static async getCandidateById(candidateId, organizationId, database = 'candidates_db') {
    const query = `
      SELECT * FROM \`${database}\`.college_candidates
      WHERE candidate_id = ? AND organization_id = ?
      LIMIT 1
    `;
    const rows = await db.query(query, [candidateId, organizationId]);
    return rows.length > 0 ? rows[0] : null;
  }

  // Get all candidates with filters and pagination
  static async getAllCandidates(filters, database = 'candidates_db') {
    const {
      organizationId,
      page = 0,
      pageSize = 10,
      status,
      statuses = [],
      searchTerm,
      createdBy,
      sortBy = 'created_at',
      sortOrder = 'DESC',
      dateFrom,
      dateTo
    } = filters;

    const allowedSortFields = [
      'created_at',
      'updated_at',
      'candidate_name',
      'email',
      'candidate_code',
      'status',
      'department',
      'semester'
    ];
    const safeSortBy = allowedSortFields.includes(sortBy) ? sortBy : 'created_at';
    const safeSortOrder = (sortOrder || '').toUpperCase() === 'ASC' ? 'ASC' : 'DESC';

    let query = `SELECT * FROM ${database}.college_candidates WHERE organization_id = ?`;
    const params = [organizationId];

    // Status filter
    if (status) {
      query += ` AND status = ?`;
      params.push(status);
    } else if (statuses && statuses.length > 0) {
      const placeholders = statuses.map(() => '?').join(',');
      query += ` AND status IN (${placeholders})`;
      params.push(...statuses);
    }

    // Created by filter
    if (createdBy) {
      query += ` AND candidate_created_by = ?`;
      params.push(createdBy);
    }

    // Search filter (name, email, code)
    if (searchTerm) {
      query += ` AND (candidate_name LIKE ? OR email LIKE ? OR candidate_code LIKE ? OR register_no LIKE ?)`;
      const searchPattern = `%${searchTerm}%`;
      params.push(searchPattern, searchPattern, searchPattern, searchPattern);
    }

    // Date range filter
    if (dateFrom) {
      query += ` AND created_at >= ?`;
      params.push(dateFrom);
    }
    if (dateTo) {
      query += ` AND created_at <= ?`;
      params.push(dateTo);
    }

    // Count total records
    // Count total records - build WHERE clause for count
    let countQuery = `SELECT COUNT(*) as total FROM ${database}.college_candidates WHERE organization_id = ?`;
    const countParams = [organizationId];

    if (status) {
      countQuery += ` AND status = ?`;
      countParams.push(status);
    } else if (statuses && statuses.length > 0) {
      const placeholders = statuses.map(() => '?').join(',');
      countQuery += ` AND status IN (${placeholders})`;
      countParams.push(...statuses);
    }

    if (createdBy) {
      countQuery += ` AND candidate_created_by = ?`;
      countParams.push(createdBy);
    }

    if (searchTerm) {
      countQuery += ` AND (candidate_name LIKE ? OR email LIKE ? OR candidate_code LIKE ? OR register_no LIKE ?)`;
      const searchPattern = `%${searchTerm}%`;
      countParams.push(searchPattern, searchPattern, searchPattern, searchPattern);
    }

    if (dateFrom) {
      countQuery += ` AND created_at >= ?`;
      countParams.push(dateFrom);
    }
    if (dateTo) {
      countQuery += ` AND created_at <= ?`;
      countParams.push(dateTo);
    }

    // Sorting and pagination
    query += ` ORDER BY ${safeSortBy} ${safeSortOrder} LIMIT ? OFFSET ?`;
    params.push(pageSize, page * pageSize);

    const countRows = await db.query(countQuery, countParams);
    const total = countRows[0]?.total || 0;
    const rows = await db.query(query, params);
    const data = rows.map((row) => {
      const skills = row.skills;
      let parsed = [];
      if (Array.isArray(skills)) parsed = skills;
      else if (typeof skills === 'string') { try { const p = JSON.parse(skills); parsed = Array.isArray(p) ? p : []; } catch (_) { parsed = []; } }
      return { ...row, skills: parsed };
    });

    return {
      data,
      pagination: {
        page,
        pageSize,
        total,
        totalPages: Math.ceil(total / pageSize),
        hasNextPage: page < Math.ceil(total / pageSize) - 1,
        hasPreviousPage: page > 0
      }
    };
  }

  // Get student (college_candidates) counts by status for organization: All, Pending, Active, Inactive
  static async getStudentCounts(organizationId, database = 'candidates_db') {
    if (!organizationId) throw new Error('organization_id is required');
    const rows = await db.query(
      `SELECT LOWER(COALESCE(NULLIF(TRIM(status), ''), 'all')) AS status, COUNT(*) AS count
       FROM \`${database}\`.college_candidates WHERE organization_id = ? GROUP BY LOWER(COALESCE(NULLIF(TRIM(status), ''), 'all'))`,
      [organizationId]
    );
    const list = Array.isArray(rows) ? rows : [];
    const total = list.reduce((sum, r) => sum + (r.count || 0), 0);
    const byStatus = {};
    list.forEach((r) => {
      const key = ((r.status || 'all') + '').toLowerCase();
      byStatus[key] = r.count || 0;
    });
    return {
      All: total,
      Pending: byStatus.pending ?? 0,
      Active: byStatus.active ?? 0,
      Inactive: byStatus.inactive ?? 0,
      Rejected: byStatus.rejected ?? 0
    };
  }

  // Get all candidates joined with their position and question set data
  static async getAllLinkedCandidates(filters, tenantDb) {
    if (!tenantDb) {
      throw new Error('Tenant database is required for linked candidate retrieval');
    }

    const {
      organizationId,
      page = 0,
      pageSize = 10,
      status,
      statuses = [],
      searchTerm,
      createdBy,
      sortBy = 'created_at',
      sortOrder = 'DESC',
      dateFrom,
      dateTo
    } = filters;

    const tableCheck = await db.query(
      `SELECT TABLE_NAME FROM INFORMATION_SCHEMA.TABLES 
       WHERE TABLE_SCHEMA = ? AND TABLE_NAME IN ('position_candidates', 'candidate_positions')`,
      [tenantDb]
    );
    const existingTables = (tableCheck || []).map((t) => t.TABLE_NAME);

    const usePositionCandidates = existingTables.includes('position_candidates');
    const useCandidatePositions = existingTables.includes('candidate_positions');

    const safeSortOrder = (sortOrder || '').toUpperCase() === 'ASC' ? 'ASC' : 'DESC';

    if (usePositionCandidates) {
      return CandidateModel._getAllLinkedFromPositionCandidates(
        filters,
        tenantDb,
        { page, pageSize, status, statuses, searchTerm, createdBy, sortBy, sortOrder: safeSortOrder, dateFrom, dateTo }
      );
    }

    if (useCandidatePositions) {
      return CandidateModel._getAllLinkedFromCandidatePositions(
        filters,
        tenantDb,
        { page, pageSize, status, statuses, searchTerm, createdBy, sortBy, sortOrder: safeSortOrder, dateFrom, dateTo }
      );
    }

    throw new Error(`Neither position_candidates nor candidate_positions table found in database ${tenantDb}`);
  }

  static async _getAllLinkedFromPositionCandidates(filters, tenantDb, opts) {
    const { organizationId, page = 0, pageSize = 10, status, statuses = [], searchTerm, createdBy, dateFrom, dateTo } = filters;
    const { sortBy, sortOrder } = opts;

    const hasCandidatesTable = await db.query(
      `SELECT 1 FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_SCHEMA = ? AND TABLE_NAME = 'candidates'`,
      [tenantDb]
    ).then((r) => r && r.length > 0).catch(() => false);

    const sortFieldMapping = {
      'created_at': 'pc.created_at',
      'candidateCreatedAt': 'pc.created_at',
      'updated_at': 'pc.updated_at',
      'updatedAt': 'pc.updated_at',
      'candidate_name': hasCandidatesTable ? 'COALESCE(cc.candidate_name, tc.name)' : 'c.candidate_name',
      'candidateName': hasCandidatesTable ? 'COALESCE(cc.candidate_name, tc.name)' : 'c.candidate_name',
      'candidate_code': hasCandidatesTable ? 'COALESCE(cc.candidate_code, tc.code)' : 'c.candidate_code',
      'candidateCode': hasCandidatesTable ? 'COALESCE(cc.candidate_code, tc.code)' : 'c.candidate_code',
      'status': 'pc.recommendation',
      'recommendationStatus': 'pc.recommendation',
      'resume_score': 'pc.resume_match_score',
      'resumeMatchScore': 'pc.resume_match_score'
    };
    const safeSortBy = sortFieldMapping[sortBy] || 'pc.created_at';

    let baseWhere = 'WHERE 1=1';
    const baseParams = [];

    if (status && String(status).toUpperCase() !== 'ALL') {
      baseWhere += ' AND pc.recommendation = ?';
      baseParams.push(status);
    } else if (statuses && statuses.length > 0) {
      const valid = statuses.filter(s => s && String(s).toUpperCase() !== 'ALL');
      if (valid.length > 0) {
        baseWhere += ` AND pc.recommendation IN (${valid.map(() => '?').join(',')})`;
        baseParams.push(...valid);
      }
    }

    const candidatesDb = 'candidates_db';
    if (createdBy) {
      baseWhere += hasCandidatesTable ? ' AND (cc.candidate_created_by = ? OR tc.created_by = ?)' : ' AND c.candidate_created_by = ?';
      baseParams.push(createdBy);
      if (hasCandidatesTable) baseParams.push(createdBy);
    }

    const searchCols = hasCandidatesTable
      ? '(COALESCE(cc.candidate_name, tc.name) LIKE ? OR COALESCE(cc.email, tc.email) LIKE ? OR COALESCE(cc.candidate_code, tc.code) LIKE ? OR p.title LIKE ?)'
      : '(c.candidate_name LIKE ? OR c.email LIKE ? OR c.candidate_code LIKE ? OR p.title LIKE ?)';
    if (searchTerm) {
      baseWhere += ` AND ${searchCols}`;
      const searchPattern = `%${searchTerm}%`;
      baseParams.push(searchPattern, searchPattern, searchPattern, searchPattern);
    }

    if (dateFrom) {
      baseWhere += ' AND pc.created_at >= ?';
      baseParams.push(dateFrom);
    }
    if (dateTo) {
      baseWhere += ' AND pc.created_at <= ?';
      baseParams.push(dateTo);
    }

    const candidateSelect = hasCandidatesTable
      ? `CASE WHEN COALESCE(cc.candidate_code, tc.code) REGEXP '^CAN[0-9]' THEN COALESCE(cc.candidate_code, tc.code) WHEN COALESCE(cc.candidate_code, tc.code) LIKE '#%' THEN COALESCE(cc.candidate_code, tc.code) ELSE CONCAT('#', IFNULL(COALESCE(cc.candidate_code, tc.code), '')) END as candidateCode,
        COALESCE(cc.candidate_name, tc.name) as candidateName,
        COALESCE(cc.candidate_created_at, cc.created_at, tc.created_at, pc.created_at) as candidateCreatedAt,
        COALESCE(cc.email, tc.email) as candidateEmail,
        COALESCE(cc.mobile_number, tc.mobile_number) as candidateMobileNumber,
        COALESCE(cc.resume_filename, tc.resume_filename) as resumeFilename,
        COALESCE(REPLACE(cc.resume_url, '/uploads/resumes/', ''), cc.resume_url, tc.resume_storage_path) as resumeStoragePath`
      : `CASE WHEN c.candidate_code REGEXP '^CAN[0-9]' THEN c.candidate_code WHEN c.candidate_code LIKE '#%' THEN c.candidate_code ELSE CONCAT('#', IFNULL(c.candidate_code, '')) END as candidateCode,
        c.candidate_name as candidateName,
        COALESCE(c.candidate_created_at, c.created_at, pc.created_at) as candidateCreatedAt,
        c.email as candidateEmail,
        c.mobile_number as candidateMobileNumber,
        c.resume_filename as resumeFilename,
        COALESCE(REPLACE(c.resume_url, '/uploads/resumes/', ''), c.resume_url) as resumeStoragePath`;

    const candidateJoin = hasCandidatesTable
      ? `LEFT JOIN \`${tenantDb}\`.candidates tc ON tc.id = pc.candidate_id
       LEFT JOIN \`${candidatesDb}\`.college_candidates cc ON (LOWER(BIN_TO_UUID(pc.candidate_id)) = cc.candidate_id OR (LOWER(BIN_TO_UUID(pc.candidate_id, 1)) = cc.candidate_id) OR (REPLACE(cc.candidate_id, '-', '') = REPLACE(LOWER(BIN_TO_UUID(pc.candidate_id)), '-', '')))`
      : `LEFT JOIN \`${candidatesDb}\`.college_candidates c ON (LOWER(BIN_TO_UUID(pc.candidate_id)) = c.candidate_id OR LOWER(BIN_TO_UUID(pc.candidate_id, 1)) = c.candidate_id OR REPLACE(c.candidate_id, '-', '') = REPLACE(LOWER(BIN_TO_UUID(pc.candidate_id)), '-', ''))`;

    const selectQuery = `
      SELECT 
        LOWER(BIN_TO_UUID(pc.id)) as positionCandidateId,
        LOWER(BIN_TO_UUID(pc.candidate_id)) as candidateId,
        LOWER(BIN_TO_UUID(pc.position_id)) as positionId,
        ${candidateSelect},
        p.title as positionTitle,
        p.domain_type as domainType,
        p.minimum_experience as minimumExperience,
        p.maximum_experience as maximumExperience,
        pc.link_active_at as linkActiveAt,
        pc.link_expires_at as linkExpiresAt,
        pc.interview_completed_at as interviewCompletedAt,
        pc.resume_match_score as resumeMatchScore,
        pc.recommendation as recommendationStatus,
        pc.recording_link as recordingLink,
        LOWER(BIN_TO_UUID(pc.question_set_id)) as questionSetId,
        qs.total_duration as questionSetDuration,
        qs.question_set_code as questionSetCode,
        qs.question_set_code as questionSetTitle,
        LOWER(BIN_TO_UUID(pc.interview_scheduled_by)) as candidateCreatedBy,
        pc.created_at as updatedAt
      FROM \`${tenantDb}\`.position_candidates pc
      ${candidateJoin}
      LEFT JOIN \`${tenantDb}\`.positions p ON p.id = pc.position_id
      LEFT JOIN \`${tenantDb}\`.question_sets qs ON qs.id = pc.question_set_id
      ${baseWhere}
      ORDER BY ${safeSortBy} ${sortOrder}
      LIMIT ? OFFSET ?
    `;

    const countQuery = `
      SELECT COUNT(*) as total 
      FROM \`${tenantDb}\`.position_candidates pc
      ${candidateJoin}
      LEFT JOIN \`${tenantDb}\`.positions p ON p.id = pc.position_id
      ${baseWhere}
    `;

    const countRows = await db.query(countQuery, baseParams);
    const total = countRows[0]?.total || 0;
    const selectParams = [...baseParams, parseInt(pageSize, 10), parseInt(page * pageSize, 10)];
    const rows = await db.query(selectQuery, selectParams);

    return {
      data: rows,
      pagination: {
        page,
        pageSize,
        total,
        totalPages: Math.ceil(total / pageSize),
        hasNextPage: page < Math.ceil(total / pageSize) - 1,
        hasPreviousPage: page > 0
      }
    };
  }

  static async _getAllLinkedFromCandidatePositions(filters, tenantDb, opts) {
    const { organizationId, page = 0, pageSize = 10, status, statuses = [], searchTerm, createdBy, dateFrom, dateTo } = filters;
    const { sortBy, sortOrder } = opts;

    const sortFieldMapping = {
      'created_at': 'cp.created_at',
      'candidateCreatedAt': 'cp.created_at',
      'updated_at': 'cp.updated_at',
      'updatedAt': 'cp.updated_at',
      'candidate_name': 'cp.candidate_name',
      'candidateName': 'cp.candidate_name',
      'job_title': 'cp.job_title',
      'jobTitle': 'cp.job_title',
      'candidate_code': 'cp.candidate_code',
      'candidateCode': 'cp.candidate_code',
      'status': 'cp.status',
      'recommendationStatus': 'cp.status',
      'resume_score': 'cp.resume_score',
      'resumeMatchScore': 'cp.resume_score'
    };
    const safeSortBy = sortFieldMapping[sortBy] || 'cp.created_at';

    let baseWhere = 'WHERE cp.organization_id = ?';
    const baseParams = [organizationId];

    if (status && String(status).toUpperCase() !== 'ALL') {
      baseWhere += ' AND cp.status = ?';
      baseParams.push(status);
    } else if (statuses && statuses.length > 0) {
      const valid = statuses.filter(s => s && String(s).toUpperCase() !== 'ALL');
      if (valid.length > 0) {
        baseWhere += ` AND cp.status IN (${valid.map(() => '?').join(',')})`;
        baseParams.push(...valid);
      }
    }

    if (createdBy) {
      baseWhere += ' AND cp.created_by = ?';
      baseParams.push(createdBy);
    }

    if (searchTerm) {
      baseWhere += ' AND (COALESCE(cp.candidate_name, c.candidate_name) LIKE ? OR c.email LIKE ? OR COALESCE(cp.candidate_code, c.candidate_code) LIKE ? OR cp.job_title LIKE ? OR p.title LIKE ?)';
      const searchPattern = `%${searchTerm}%`;
      baseParams.push(searchPattern, searchPattern, searchPattern, searchPattern, searchPattern);
    }

    if (dateFrom) {
      baseWhere += ' AND cp.created_at >= ?';
      baseParams.push(dateFrom);
    }
    if (dateTo) {
      baseWhere += ' AND cp.created_at <= ?';
      baseParams.push(dateTo);
    }

    const candidatesDb = 'candidates_db';
    const selectQuery = `
      SELECT 
        cp.position_candidate_id as positionCandidateId,
        cp.candidate_id as candidateId,
        cp.position_id as positionId,
        cp.organization_id as organizationId,
        CASE WHEN COALESCE(cp.candidate_code, c.candidate_code) REGEXP '^CAN[0-9]' THEN COALESCE(cp.candidate_code, c.candidate_code) WHEN COALESCE(cp.candidate_code, c.candidate_code) LIKE '#%' THEN COALESCE(cp.candidate_code, c.candidate_code) ELSE CONCAT('#', IFNULL(COALESCE(cp.candidate_code, c.candidate_code), '')) END as candidateCode,
        COALESCE(cp.candidate_name, c.candidate_name) as candidateName,
        COALESCE(cp.job_title, p.title) as jobTitle,
        COALESCE(cp.domain_type, p.domain_type) as domainType,
        COALESCE(cp.position_code, p.code) as positionCode,
        cp.invited_date as linkActiveAt,
        cp.link_expires_at as linkExpiresAt,
        cp.interview_completed_at as interviewCompletedAt,
        cp.resume_score as resumeMatchScore,
        COALESCE(cp.recommendation_status, cp.status) as recommendationStatus,
        NULL as recordingLink,
        cp.question_set_id as questionSetId,
        COALESCE(cp.question_set_duration, qs.total_duration) as questionSetDuration,
        cp.interview_notes as interviewNotes,
        cp.internal_notes as internalNotes,
        cp.notes_by as notesBy,
        cp.notes_date as notesDate,
        cp.workflow_stage as workflowStage,
        cp.invitation_sent_at as invitationSentAt,
        cp.minimum_experience as minimumExperience,
        cp.maximum_experience as maximumExperience,
        COALESCE(cp.created_by, c.candidate_created_by) as candidateCreatedBy,
        COALESCE(c.candidate_created_at, c.created_at, cp.created_at) as candidateCreatedAt,
        cp.updated_at as updatedAt,
        c.email as candidateEmail,
        c.mobile_number as candidateMobileNumber,
        c.register_no as registerNo,
        c.resume_filename as resumeFilename,
        COALESCE(REPLACE(c.resume_url, '/uploads/resumes/', ''), c.resume_url) as resumeStoragePath,
        p.title as positionTitle,
        qs.question_set_code as questionSetCode,
        qs.question_set_code as questionSetTitle
      FROM \`${tenantDb}\`.candidate_positions cp
      LEFT JOIN \`${candidatesDb}\`.college_candidates c ON (LOWER(TRIM(c.candidate_id)) = LOWER(TRIM(cp.candidate_id)) OR REPLACE(c.candidate_id, '-', '') = REPLACE(cp.candidate_id, '-', ''))
      LEFT JOIN \`${tenantDb}\`.positions p ON (p.id = UNHEX(REPLACE(LOWER(TRIM(cp.position_id)), '-', '')) OR BIN_TO_UUID(p.id) = cp.position_id)
      LEFT JOIN \`${tenantDb}\`.question_sets qs ON (qs.id = UNHEX(REPLACE(LOWER(TRIM(cp.question_set_id)), '-', '')) OR BIN_TO_UUID(qs.id) = cp.question_set_id)
      ${baseWhere}
      ORDER BY ${safeSortBy} ${sortOrder}
      LIMIT ? OFFSET ?
    `;

    const countQuery = `
      SELECT COUNT(*) as total 
      FROM \`${tenantDb}\`.candidate_positions cp
      LEFT JOIN \`${candidatesDb}\`.college_candidates c ON (LOWER(TRIM(c.candidate_id)) = LOWER(TRIM(cp.candidate_id)) OR REPLACE(c.candidate_id, '-', '') = REPLACE(cp.candidate_id, '-', ''))
      LEFT JOIN \`${tenantDb}\`.positions p ON (p.id = UNHEX(REPLACE(LOWER(TRIM(cp.position_id)), '-', '')) OR BIN_TO_UUID(p.id) = cp.position_id)
      LEFT JOIN \`${tenantDb}\`.question_sets qs ON (qs.id = UNHEX(REPLACE(LOWER(TRIM(cp.question_set_id)), '-', '')) OR BIN_TO_UUID(qs.id) = cp.question_set_id)
      ${baseWhere}
    `;

    const countRows = await db.query(countQuery, baseParams);
    const total = countRows[0]?.total || 0;
    const selectParams = [...baseParams, parseInt(pageSize, 10), parseInt(page * pageSize, 10)];
    const rows = await db.query(selectQuery, selectParams);

    return {
      data: rows,
      pagination: {
        page,
        pageSize,
        total,
        totalPages: Math.ceil(total / pageSize),
        hasNextPage: page < Math.ceil(total / pageSize) - 1,
        hasPreviousPage: page > 0
      }
    };
  }

  // Get candidate-position link counts by status (not college_candidates). Requires tenantDb.
  static async getStatusCounts(filters, tenantDb) {
    const {
      organizationId,
      searchTerm,
      createdBy,
      dateFrom,
      dateTo
    } = filters || {};

    if (!tenantDb) {
      throw new Error('Tenant database is required for link-based status counts');
    }

    const tableCheck = await db.query(
      `SELECT TABLE_NAME FROM INFORMATION_SCHEMA.TABLES 
       WHERE TABLE_SCHEMA = ? AND TABLE_NAME IN ('position_candidates', 'candidate_positions')`,
      [tenantDb]
    );
    const existingTables = (tableCheck || []).map((t) => t.TABLE_NAME);
    const usePositionCandidates = existingTables.includes('position_candidates');
    const useCandidatePositions = existingTables.includes('candidate_positions');

    const counts = {};
    Object.values(CANDIDATE_STATUSES).forEach(status => {
      counts[status] = 0;
    });

    if (useCandidatePositions) {
      if (!organizationId) {
        throw new Error('organization_id is required for link-based status counts');
      }
      const candidatesDb = 'candidates_db';
      let baseWhere = 'WHERE cp.organization_id = ?';
      const baseParams = [organizationId];

      if (createdBy) {
        baseWhere += ' AND cp.created_by = ?';
        baseParams.push(createdBy);
      }
      if (searchTerm) {
        baseWhere += ` AND (COALESCE(cp.candidate_name, c.candidate_name) LIKE ? OR c.email LIKE ? OR COALESCE(cp.candidate_code, c.candidate_code) LIKE ? OR cp.job_title LIKE ? OR p.title LIKE ?)`;
        const searchPattern = `%${searchTerm}%`;
        baseParams.push(searchPattern, searchPattern, searchPattern, searchPattern, searchPattern);
      }
      if (dateFrom) {
        baseWhere += ' AND cp.created_at >= ?';
        baseParams.push(dateFrom);
      }
      if (dateTo) {
        baseWhere += ' AND cp.created_at <= ?';
        baseParams.push(dateTo);
      }

      const groupBy = 'COALESCE(cp.recommendation_status, cp.status)';
      const countByStatusQuery = `
        SELECT ${groupBy} as status, COUNT(*) as count
        FROM \`${tenantDb}\`.candidate_positions cp
        LEFT JOIN \`${candidatesDb}\`.college_candidates c ON (LOWER(TRIM(c.candidate_id)) = LOWER(TRIM(cp.candidate_id)) OR REPLACE(c.candidate_id, '-', '') = REPLACE(cp.candidate_id, '-', ''))
        LEFT JOIN \`${tenantDb}\`.positions p ON (p.id = UNHEX(REPLACE(LOWER(TRIM(cp.position_id)), '-', '')) OR BIN_TO_UUID(p.id) = cp.position_id)
        ${baseWhere}
        GROUP BY ${groupBy}
      `;
      const totalQuery = `
        SELECT COUNT(*) as total
        FROM \`${tenantDb}\`.candidate_positions cp
        LEFT JOIN \`${candidatesDb}\`.college_candidates c ON (LOWER(TRIM(c.candidate_id)) = LOWER(TRIM(cp.candidate_id)) OR REPLACE(c.candidate_id, '-', '') = REPLACE(cp.candidate_id, '-', ''))
        LEFT JOIN \`${tenantDb}\`.positions p ON (p.id = UNHEX(REPLACE(LOWER(TRIM(cp.position_id)), '-', '')) OR BIN_TO_UUID(p.id) = cp.position_id)
        ${baseWhere}
      `;

      const [rows, totalRows] = await Promise.all([
        db.query(countByStatusQuery, baseParams),
        db.query(totalQuery, baseParams)
      ]);
      let total = parseInt(totalRows[0]?.total, 10) || 0;
      (rows || []).forEach((row) => {
        const raw = (row.status && String(row.status).trim()) || 'ALL';
        const status = raw.toUpperCase();
        const count = parseInt(row.count, 10) || 0;
        if (Object.prototype.hasOwnProperty.call(counts, status)) {
          counts[status] = count;
        } else {
          counts[status] = count;
        }
      });
      counts.All = total;
      return counts;
    }

    if (usePositionCandidates) {
      const candidatesDb = 'candidates_db';
      const hasCandidatesTable = await db.query(
        `SELECT 1 FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_SCHEMA = ? AND TABLE_NAME = 'candidates'`,
        [tenantDb]
      ).then((r) => r && r.length > 0).catch(() => false);

      let baseWhere = 'WHERE 1=1';
      const baseParams = [];

      if (createdBy) {
        baseWhere += hasCandidatesTable ? ' AND (cc.candidate_created_by = ? OR tc.created_by = ?)' : ' AND c.candidate_created_by = ?';
        baseParams.push(createdBy);
        if (hasCandidatesTable) baseParams.push(createdBy);
      }
      const searchCols = hasCandidatesTable
        ? '(COALESCE(cc.candidate_name, tc.name) LIKE ? OR COALESCE(cc.email, tc.email) LIKE ? OR COALESCE(cc.candidate_code, tc.code) LIKE ? OR p.title LIKE ?)'
        : '(c.candidate_name LIKE ? OR c.email LIKE ? OR c.candidate_code LIKE ? OR p.title LIKE ?)';
      if (searchTerm) {
        baseWhere += ` AND ${searchCols}`;
        const searchPattern = `%${searchTerm}%`;
        baseParams.push(searchPattern, searchPattern, searchPattern, searchPattern);
      }
      if (dateFrom) {
        baseWhere += ' AND pc.created_at >= ?';
        baseParams.push(dateFrom);
      }
      if (dateTo) {
        baseWhere += ' AND pc.created_at <= ?';
        baseParams.push(dateTo);
      }

      const candidateJoin = hasCandidatesTable
        ? `LEFT JOIN \`${tenantDb}\`.candidates tc ON tc.id = pc.candidate_id
          LEFT JOIN \`${candidatesDb}\`.college_candidates cc ON (LOWER(BIN_TO_UUID(pc.candidate_id)) = cc.candidate_id OR (LOWER(BIN_TO_UUID(pc.candidate_id, 1)) = cc.candidate_id) OR (REPLACE(cc.candidate_id, '-', '') = REPLACE(LOWER(BIN_TO_UUID(pc.candidate_id)), '-', '')))`
        : `LEFT JOIN \`${candidatesDb}\`.college_candidates c ON (LOWER(BIN_TO_UUID(pc.candidate_id)) = c.candidate_id OR LOWER(BIN_TO_UUID(pc.candidate_id, 1)) = c.candidate_id OR REPLACE(c.candidate_id, '-', '') = REPLACE(LOWER(BIN_TO_UUID(pc.candidate_id)), '-', ''))`;

      const countByStatusQuery = `
        SELECT pc.recommendation as status, COUNT(*) as count
        FROM \`${tenantDb}\`.position_candidates pc
        ${candidateJoin}
        LEFT JOIN \`${tenantDb}\`.positions p ON p.id = pc.position_id
        ${baseWhere}
        GROUP BY pc.recommendation
      `;
      const totalQuery = `
        SELECT COUNT(*) as total
        FROM \`${tenantDb}\`.position_candidates pc
        ${candidateJoin}
        LEFT JOIN \`${tenantDb}\`.positions p ON p.id = pc.position_id
        ${baseWhere}
      `;

      const [rows, totalRows] = await Promise.all([
        db.query(countByStatusQuery, baseParams),
        db.query(totalQuery, baseParams)
      ]);
      let total = parseInt(totalRows[0]?.total, 10) || 0;
      (rows || []).forEach((row) => {
        const raw = (row.status && String(row.status).trim()) || 'ALL';
        const status = raw.toUpperCase();
        const count = parseInt(row.count, 10) || 0;
        if (Object.prototype.hasOwnProperty.call(counts, status)) {
          counts[status] = count;
        } else {
          counts[status] = count;
        }
      });
      counts.All = total;
      return counts;
    }

    throw new Error(`Neither position_candidates nor candidate_positions found in database ${tenantDb}`);
  }

  // Update candidate
  static async updateCandidate(candidateId, organizationId, updateData, database = 'candidates_db') {
    const updatedAt = new Date();
    const allowedFields = [
      'candidate_name', 'department', 'semester',
      'email', 'mobile_number', 'location', 'address', 'birthdate',
      'resume_filename', 'resume_url',
      'interview_notes', 'internal_notes', 'notes_by', 'notes_date', 'status',
      'candidate_code', 'register_no', 'skills'
    ];

    const updateFields = [];
    const values = [];

    for (const field of allowedFields) {
      if (field in updateData) {
        updateFields.push(`${field} = ?`);
        let val = updateData[field];
        if (field === 'skills' && Array.isArray(val)) val = JSON.stringify(val);
        else if (field === 'skills' && typeof val === 'string' && val !== '') {
          try { JSON.parse(val); } catch (_) { val = '[]'; }
        }
        values.push(val);
      }
    }

    if (updateFields.length === 0) {
      throw new Error('No valid fields to update');
    }

    updateFields.push('updated_at = ?');
    values.push(updatedAt);

    values.push(candidateId, organizationId);

    const query = `
      UPDATE ${database}.college_candidates 
      SET ${updateFields.join(', ')} 
      WHERE candidate_id = ? AND organization_id = ?
    `;

    const result = await db.query(query, values);
    return result.affectedRows > 0;
  }

  // Update internal notes
  static async updateInternalNotes(candidateId, organizationId, notes, notesBy, database = 'candidates_db') {
    const query = `
      UPDATE ${database}.college_candidates 
      SET internal_notes = ?, notes_by = ?, notes_date = NOW(), updated_at = NOW()
      WHERE candidate_id = ? AND organization_id = ?
    `;

    const result = await db.query(query, [notes, notesBy || null, candidateId, organizationId]);
    return result.affectedRows > 0;
  }

  // Update candidate status
  static async updateCandidateStatus(candidateId, organizationId, newStatus, changedBy, remarks, database = 'candidates_db') {
    // First, get current status
    const getCandidateQuery = `SELECT status FROM ${database}.college_candidates WHERE candidate_id = ? AND organization_id = ?`;
    const candidateRows = await db.query(getCandidateQuery, [candidateId, organizationId]);
    const candidate = candidateRows[0];

    if (!candidate) {
      throw new Error('Candidate not found');
    }

    const oldStatus = candidate.status;

    // Update candidate status
    const updateQuery = `
      UPDATE ${database}.college_candidates 
      SET status = ?, updated_at = NOW()
      WHERE candidate_id = ? AND organization_id = ?
    `;
    const result = await db.query(updateQuery, [newStatus, candidateId, organizationId]);

    // Log status change (optional: table may not exist yet)
    if (result.affectedRows > 0) {
      try {
        const statusHistoryId = uuidv4();
        const historyQuery = `
          INSERT INTO ${database}.candidate_status_history 
          (status_history_id, candidate_id, organization_id, old_status, new_status, changed_by, remarks, changed_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, NOW())
        `;
        await db.query(historyQuery, [
          statusHistoryId,
          candidateId,
          organizationId,
          oldStatus,
          newStatus,
          changedBy || null,
          remarks || null
        ]);
      } catch (err) {
        if (err.code !== 'ER_NO_SUCH_TABLE' && !err.message?.includes('doesn\'t exist')) {
          throw err;
        }
        // Table missing; status was still updated
      }
    }

    return result.affectedRows > 0;
  }

  // Delete candidate
  static async deleteCandidate(candidateId, organizationId, database = 'candidates_db') {
    const query = `
      DELETE FROM ${database}.college_candidates 
      WHERE candidate_id = ? AND organization_id = ?
    `;

    const result = await db.query(query, [candidateId, organizationId]);
    return result.affectedRows > 0;
  }

  // Check if email exists
  static async emailExists(email, organizationId, database = 'candidates_db') {
    const query = `
      SELECT COUNT(*) as count FROM ${database}.college_candidates 
      WHERE email = ? AND organization_id = ?
    `;

    const countRows = await db.query(query, [email, organizationId]);
    const count = countRows[0]?.count || 0;
    return count > 0;
  }

  // Get candidate by email
  static async getCandidateByEmail(email, organizationId, database = 'candidates_db') {
    const query = `
      SELECT * FROM ${database}.college_candidates 
      WHERE email = ? AND organization_id = ?
      LIMIT 1
    `;

    const rows = await db.query(query, [email, organizationId]);
    return rows.length > 0 ? rows[0] : null;
  }

  // Get candidate by email or mobile for portal (prefill). If organizationId provided, filter by org; else find by email/phone across all orgs.
  static async getCandidateByEmailOrPhone(organizationId, email, mobile, database = 'candidates_db') {
    const normMobile = mobile && String(mobile).replace(/\D/g, '').replace(/^91(?=\d{10})/, '');
    let rows = [];
    if (email && String(email).trim()) {
      const emailTrimmed = String(email).trim();
      if (organizationId) {
        rows = await db.query(
          `SELECT * FROM \`${database}\`.college_candidates WHERE organization_id = ? AND LOWER(TRIM(email)) = LOWER(?) LIMIT 1`,
          [organizationId, emailTrimmed]
        );
      } else {
        rows = await db.query(
          `SELECT * FROM \`${database}\`.college_candidates WHERE LOWER(TRIM(email)) = LOWER(?) LIMIT 1`,
          [emailTrimmed]
        );
      }
    }
    if (rows.length === 0 && normMobile && normMobile.length >= 10) {
      if (organizationId) {
        rows = await db.query(
          `SELECT * FROM \`${database}\`.college_candidates WHERE organization_id = ? AND (REPLACE(REPLACE(REPLACE(COALESCE(mobile_number,''), '+', ''), ' ', ''), '-', '') = ? OR mobile_number LIKE ?) LIMIT 1`,
          [organizationId, normMobile, `%${normMobile}`]
        );
      } else {
        rows = await db.query(
          `SELECT * FROM \`${database}\`.college_candidates WHERE REPLACE(REPLACE(REPLACE(COALESCE(mobile_number,''), '+', ''), ' ', ''), '-', '') = ? OR mobile_number LIKE ? LIMIT 1`,
          [normMobile, `%${normMobile}`]
        );
      }
    }
    return rows.length > 0 ? rows[0] : null;
  }

  // Create or update college_candidates for candidate portal registration (called by SuperadminBackend).
  static async registerOrUpdateCandidate(data, database = 'candidates_db') {
    const {
      organization_id,
      candidate_id,
      email,
      mobile_number,
      candidate_name,
      register_no,
      department,
      semester,
      location,
      address,
      birthdate,
      skills
    } = data;

    if (!organization_id || !candidate_id || !email) {
      throw new Error('organization_id, candidate_id, and email are required');
    }

    const existing = await CandidateModel.getCandidateByEmailOrPhone(organization_id, email, mobile_number, database);
    const skillsJson = Array.isArray(skills) ? JSON.stringify(skills) : (skills ? JSON.stringify([skills]) : '[]');

    if (existing) {
      const updateSql = `
        UPDATE \`${database}\`.college_candidates SET
          candidate_name = COALESCE(?, candidate_name),
          register_no = COALESCE(?, register_no),
          department = COALESCE(?, department),
          semester = COALESCE(?, semester),
          mobile_number = COALESCE(?, mobile_number),
          location = COALESCE(?, location),
          address = COALESCE(?, address),
          birthdate = COALESCE(?, birthdate),
          skills = COALESCE(?, skills),
          updated_at = NOW()
        WHERE candidate_id = ? AND organization_id = ?
      `;
      await db.query(updateSql, [
        candidate_name || existing.candidate_name,
        register_no != null ? register_no : existing.register_no,
        department != null ? department : existing.department,
        semester != null ? semester : existing.semester,
        mobile_number != null ? mobile_number : existing.mobile_number,
        location != null ? location : existing.location,
        address != null ? address : existing.address,
        birthdate != null ? birthdate : existing.birthdate,
        skillsJson,
        existing.candidate_id,
        organization_id
      ]);
      return existing.candidate_id;
    }

    const candidateCode = await getNextCandidateCode(database);
    const insertSql = `
      INSERT INTO \`${database}\`.college_candidates (
        candidate_id, organization_id, candidate_code, register_no,
        candidate_name, department, semester, email, mobile_number,
        location, address, birthdate, status, skills, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'All', ?, NOW(), NOW())
    `;
    await db.query(insertSql, [
      candidate_id,
      organization_id,
      candidateCode,
      register_no || null,
      candidate_name || '',
      department || null,
      semester || null,
      email,
      mobile_number || null,
      location || null,
      address || null,
      birthdate || null,
      skillsJson
    ]);
    return candidate_id;
  }

  /**
   * Check if WhatsApp number is available for use.
   * @param {string} mobileNumber - 10-digit mobile
   * @param {string} organizationId - org id
   * @param {string} [database] - DB name
   * @param {string} [excludeCandidateId] - If the number is assigned to this candidate (same person), treat as available (add exam for existing candidate).
   * @returns {Promise<boolean>} true if available
   */
  static async checkWhatsAppAvailability(mobileNumber, organizationId, database = 'candidates_db', excludeCandidateId = null) {
    const query = `
      SELECT candidate_id FROM \`${database}\`.college_candidates
      WHERE mobile_number = ? AND organization_id = ?
      LIMIT 1
    `;
    const rows = await db.query(query, [mobileNumber, organizationId]);
    if (!rows || rows.length === 0) return true;
    if (excludeCandidateId) {
      const existingId = rows[0].candidate_id;
      const existingHex = Buffer.isBuffer(existingId) ? existingId.toString('hex') : String(existingId || '').replace(/-/g, '');
      const excludeHex = String(excludeCandidateId || '').replace(/-/g, '');
      if (existingHex.toLowerCase() === excludeHex.toLowerCase()) return true; // Same candidate: number is "available" for this add-exam flow
    }
    return false;
  }

  // Helper to convert UUID string to BINARY(16) Buffer
  static uuidToBinary(uuid) {
    if (!uuid) return null;
    if (Buffer.isBuffer(uuid)) return uuid;
    // Remove hyphens and convert to buffer
    const hex = uuid.toString().replace(/-/g, '');
    if (hex.length !== 32) return null; // Not a valid UUID hex
    return Buffer.from(hex, 'hex');
  }

  /**
   * Get existing active private link for candidate + position (same link/OTP reused when already invited).
   * @returns {{ linkId: string, verificationCode: string } | null}
   */
  static async getExistingPrivateLinkByCandidateAndPosition(candidateId, positionId, database = 'candidates_db') {
    if (!candidateId || !positionId) return null;
    const candidateIdBinary = this.uuidToBinary(candidateId);
    const positionIdBinary = this.uuidToBinary(positionId);
    if (!candidateIdBinary || !positionIdBinary) return null;
    const query = `
      SELECT id, verification_code
      FROM \`${database}\`.private_link
      WHERE candidate_id = ? AND position_id = ? AND is_active = 1
        AND (link_expires_at IS NULL OR link_expires_at > NOW())
      LIMIT 1
    `;
    const rows = await db.query(query, [candidateIdBinary, positionIdBinary]);
    if (!rows || rows.length === 0) return null;
    const r = rows[0];
    const toUuid = (buf) => {
      if (!buf || !Buffer.isBuffer(buf)) return null;
      const hex = buf.toString('hex');
      return hex.length === 32 ? `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}` : null;
    };
    return {
      linkId: toUuid(r.id) || r.id,
      verificationCode: r.verification_code ? String(r.verification_code).trim() : null
    };
  }

  // Create candidate link (private/public)
  static async createCandidateLink(linkData, database = 'candidates_db') {
    const linkId = uuidv4();
    const verificationCode = Math.floor(100000 + Math.random() * 900000).toString();
    const createdAt = new Date();

    // Convert common IDs to binary
    const linkIdBinary = this.uuidToBinary(linkId);
    const positionIdBinary = this.uuidToBinary(linkData.position_id);
    const questionSetIdBinary = this.uuidToBinary(linkData.question_set_id);
    const createdByBinary = this.uuidToBinary(linkData.created_by);

    // Choose table based on link type
    const tableName = linkData.link_type === 'PRIVATE' ? 'private_link' : 'public_link';

    if (linkData.link_type === 'PRIVATE') {
      // Private link structure
      const candidateIdBinary = this.uuidToBinary(linkData.candidate_id);

      const query = `
        INSERT INTO ${database}.${tableName} 
        (id, candidate_id, candidate_name, client_id, company_name, email, position_id, position_name, 
         question_set_id, interview_platform, link, verification_code, link_active_at, link_expires_at, 
         interview_taken, is_active, created_by, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `;

      const values = [
        linkIdBinary,
        candidateIdBinary,
        linkData.candidate_name,
        linkData.client_id,
        linkData.company_name,
        linkData.email,
        positionIdBinary,
        linkData.position_name,
        questionSetIdBinary,
        linkData.interview_platform || 'BROWSER',
        linkData.link,
        verificationCode,
        linkData.link_active_at || createdAt,
        linkData.link_expires_at,
        0,
        true,
        createdByBinary,
        createdAt
      ];

      await db.query(query, values);
    } else {
      // Public link structure
      const query = `
        INSERT INTO ${database}.${tableName} 
        (id, client_id, position_id, question_set_id, tenant_id, link, active_at, expire_at, created_by, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `;

      const values = [
        linkIdBinary,
        linkData.client_id,
        positionIdBinary,
        questionSetIdBinary,
        linkData.tenant_id,
        linkData.link,
        linkData.active_at || createdAt,
        linkData.expire_at,
        createdByBinary,
        createdAt,
        createdAt // updated_at is also createdAt initially
      ];

      await db.query(query, values);
    }

    return { linkId, verificationCode };
  }

  /**
   * Get private link by email and verification code (OTP). Used for candidate test entry.
   * @returns {Object|null} Formatted link with id, candidateId, positionId, questionSetId, clientId, email, etc. (hex IDs) or null
   */
  static async getLinkByEmailAndCode(email, verificationCode, database = 'candidates_db') {
    if (!email || !verificationCode) return null;
    const emailTrim = String(email).trim().toLowerCase();
    const codeTrim = String(verificationCode).trim();
    const query = `
      SELECT id, candidate_id, position_id, question_set_id, client_id, email, candidate_name,
             company_name, position_name, interview_platform, link, verification_code,
             link_active_at, link_expires_at, interview_taken, is_active, created_at
      FROM ${database}.private_link
      WHERE LOWER(TRIM(email)) = ? AND verification_code = ? AND is_active = 1
        AND (link_expires_at IS NULL OR link_expires_at > NOW())
      LIMIT 1
    `;
    const rows = await db.query(query, [emailTrim, codeTrim]);
    if (!rows || rows.length === 0) return null;
    const r = rows[0];
    const toHex = (buf) => (buf && Buffer.isBuffer(buf)) ? buf.toString('hex') : (buf ? String(buf).replace(/-/g, '') : null);
    let tenantId = null;
    if (r.client_id) {
      try {
        const authRows = await db.authQuery(
          'SELECT client FROM auth_db.users WHERE organization_id = ? AND client IS NOT NULL AND is_active = 1 LIMIT 1',
          [r.client_id]
        );
        if (authRows && authRows.length > 0 && authRows[0].client) {
          tenantId = authRows[0].client;
        }
      } catch (err) {
        console.warn('[getLinkByEmailAndCode] tenant resolve failed:', err.message);
      }
    }
    return {
      id: toHex(r.id),
      candidateId: toHex(r.candidate_id),
      positionId: toHex(r.position_id),
      questionSetId: toHex(r.question_set_id),
      clientId: r.client_id,
      tenantId,
      email: r.email,
      candidateName: r.candidate_name,
      companyName: r.company_name,
      positionName: r.position_name,
      interviewPlatform: r.interview_platform,
      link: r.link,
      verificationCode: r.verification_code,
      linkActiveAt: r.link_active_at,
      linkExpiresAt: r.link_expires_at,
      interviewTaken: Boolean(r.interview_taken),
      isActive: Boolean(r.is_active),
      createdAt: r.created_at,
    };
  }

  // Get candidate link by verification code
  static async getLinkByCode(verificationCode, database = 'candidates_db') {
    // Try private links first
    let query = `
      SELECT *, 'PRIVATE' as link_type FROM ${database}.private_link 
      WHERE verification_code = ? AND is_active = 1 AND (link_expires_at IS NULL OR link_expires_at > NOW())
      LIMIT 1
    `;

    let rows = await db.query(query, [verificationCode]);
    if (rows.length > 0) return rows[0];

    // If not found, try public links
    query = `
      SELECT *, 'PUBLIC' as link_type FROM ${database}.public_link 
      WHERE link = ? AND (expire_at IS NULL OR expire_at > NOW())
      LIMIT 1
    `;

    rows = await db.query(query, [verificationCode]);
    return rows.length > 0 ? rows[0] : null;
  }

  /**
   * Update interview_taken = 1 for private_link by positionId and candidateId (hex or UUID).
   */
  static async updateInterviewStatus(positionId, candidateId, database = 'candidates_db', questionSetId = null) {
    if (!positionId || !candidateId) return 0;
    const posHex = String(positionId).replace(/-/g, '');
    const candHex = String(candidateId).replace(/-/g, '');
    if (posHex.length !== 32 || candHex.length !== 32) return 0;
    const qHex = questionSetId ? String(questionSetId).replace(/-/g, '') : '';
    let query = `UPDATE \`${database}\`.private_link
       SET interview_taken = 1, updated_at = NOW()
       WHERE position_id = UNHEX(?) AND candidate_id = UNHEX(?)`;
    const params = [posHex, candHex];
    if (qHex.length === 32) {
      query += ' AND question_set_id = UNHEX(?)';
      params.push(qHex);
    }
    const result = await db.query(query, params);
    return result?.affectedRows ?? 0;
  }

  /**
   * Update company_name and position_name on private_link for display (e.g. manual invite with dynamic data).
   */
  static async updatePrivateLinkDisplayFields(candidateId, positionId, fields, database = 'candidates_db') {
    if (!candidateId || !positionId || !fields || typeof fields !== 'object') return 0;
    const posHex = String(positionId).replace(/-/g, '');
    const candHex = String(candidateId).replace(/-/g, '');
    if (posHex.length !== 32 || candHex.length !== 32) return 0;
    const updates = [];
    const values = [];
    if (fields.company_name != null) {
      updates.push('company_name = ?');
      values.push(fields.company_name);
    }
    if (fields.position_name != null) {
      updates.push('position_name = ?');
      values.push(fields.position_name);
    }
    if (updates.length === 0) return 0;
    values.push(candHex, posHex);
    const result = await db.query(
      `UPDATE \`${database}\`.private_link SET ${updates.join(', ')} WHERE candidate_id = UNHEX(?) AND position_id = UNHEX(?)`,
      values
    );
    return result?.affectedRows ?? 0;
  }

  /**
   * Set position-candidate (candidate_positions) status to e.g. TEST_STARTED when candidate starts test.
   * Uses tenant DB; falls back to candidates_db. Returns affected rows.
   */
  static async updatePositionCandidateStatus(positionId, candidateId, newStatus, tenantDb = 'candidates_db', options = {}) {
    if (!positionId || !candidateId || !newStatus) return 0;
    try {
      const tables = await db.query(
        `SELECT TABLE_NAME FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_SCHEMA = ? AND TABLE_NAME IN ('candidate_positions', 'position_candidates')`,
        [tenantDb]
      );
      const names = (tables || []).map((t) => t.TABLE_NAME);
      const posHex = String(positionId).replace(/-/g, '');
      const candHex = String(candidateId).replace(/-/g, '');
      const qHex = String(options?.questionSetId || '').replace(/-/g, '');
      if (names.includes('candidate_positions')) {
        const hasQuestionSetColumnRows = await db.query(
          `SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = ? AND TABLE_NAME = 'candidate_positions' AND COLUMN_NAME = 'question_set_id' LIMIT 1`,
          [tenantDb]
        );
        const hasQuestionSetColumn = Array.isArray(hasQuestionSetColumnRows) && hasQuestionSetColumnRows.length > 0;
        let result;
        if (posHex.length === 32 && candHex.length === 32) {
          let query = `UPDATE \`${tenantDb}\`.candidate_positions SET status = ?, updated_at = NOW()
             WHERE (position_id = UNHEX(?) OR REPLACE(LOWER(COALESCE(BIN_TO_UUID(position_id), '')), '-', '') = ?)
               AND (candidate_id = UNHEX(?) OR REPLACE(LOWER(COALESCE(BIN_TO_UUID(candidate_id), '')), '-', '') = ?)`;
          const params = [newStatus, posHex, posHex, candHex, candHex];
          if (hasQuestionSetColumn && qHex.length === 32) {
            query += ` AND (question_set_id = UNHEX(?) OR REPLACE(LOWER(COALESCE(BIN_TO_UUID(question_set_id), '')), '-', '') = ?)`;
            params.push(qHex, qHex);
          }
          result = await db.query(query, params);
        } else {
          let query = `UPDATE \`${tenantDb}\`.candidate_positions SET status = ?, updated_at = NOW()
             WHERE REPLACE(LOWER(COALESCE(position_id, '')), '-', '') = ? AND REPLACE(LOWER(COALESCE(candidate_id, '')), '-', '') = ?`;
          const params = [newStatus, posHex, candHex];
          if (hasQuestionSetColumn && qHex) {
            query += ` AND REPLACE(LOWER(COALESCE(question_set_id, '')), '-', '') = ?`;
            params.push(qHex);
          }
          result = await db.query(query, params);
        }
        return result?.affectedRows ?? 0;
      }
      if (names.includes('position_candidates') && posHex.length === 32 && candHex.length === 32) {
        const result = await db.query(
          `UPDATE \`${tenantDb}\`.position_candidates SET recommendation = ?, updated_at = NOW()
           WHERE position_id = UNHEX(?) AND candidate_id = UNHEX(?)`,
          [newStatus, posHex, candHex]
        );
        return result?.affectedRows ?? 0;
      }
    } catch (err) {
      console.error('updatePositionCandidateStatus error:', err.message);
    }
    return 0;
  }

  // Get candidate link by ID
  static async getLinkById(linkId, database = 'candidates_db') {
    // Try private links first
    let query = `
      SELECT *, 'PRIVATE' as link_type FROM ${database}.private_link 
      WHERE id = ?
      LIMIT 1
    `;

    let rows = await db.query(query, [linkId]);
    if (rows.length > 0) return rows[0];

    // If not found, try public links
    query = `
      SELECT *, 'PUBLIC' as link_type FROM ${database}.public_link 
      WHERE id = ?
      LIMIT 1
    `;

    rows = await db.query(query, [linkId]);
    return rows.length > 0 ? rows[0] : null;
  }

  // Get public link by short code
  static async getLinkByShortCode(shortCode, database = 'candidates_db') {
    // Short code is the last part of UUID (truncated for display)
    // Search by link containing the short code
    const query = `
      SELECT *, 'PUBLIC' as link_type FROM ${database}.public_link 
      WHERE link LIKE CONCAT('%/', ?)
      LIMIT 1
    `;

    const rows = await db.query(query, [shortCode]);
    return rows.length > 0 ? rows[0] : null;
  }

  // Get existing public link by position and question set
  static async getExistingPublicLink(organizationId, positionId, questionSetId, tenantId = null, database = 'candidates_db') {
    const positionIdBinary = positionId ? Buffer.from(positionId.toString().replace(/-/g, ''), 'hex') : null;
    const questionSetIdBinary = questionSetId ? Buffer.from(questionSetId.toString().replace(/-/g, ''), 'hex') : null;

    let query = `
      SELECT id as link_id, link, expire_at, active_at, tenant_id
      FROM ${database}.public_link 
      WHERE client_id = ? 
        AND position_id = ? 
        AND question_set_id = ?
        AND expire_at > NOW()
    `;

    const queryParams = [organizationId, positionIdBinary, questionSetIdBinary];

    if (tenantId) {
      query += ` AND tenant_id = ?`;
      queryParams.push(tenantId);
    }

    query += ` ORDER BY created_at DESC LIMIT 1`;

    const rows = await db.query(query, queryParams);
    return rows.length > 0 ? rows[0] : null;
  }

  // Create candidate position mapping
  static async createCandidatePosition(positionData, tenantDb) {
    if (!tenantDb) {
      throw new Error('Tenant database is required for candidate-position mapping');
    }

    // Determine which table exists in the tenant database
    const tableCheck = await db.query(
      `SELECT TABLE_NAME FROM INFORMATION_SCHEMA.TABLES 
       WHERE TABLE_SCHEMA = ? AND TABLE_NAME IN ('candidate_positions', 'position_candidates', 'job_candidates')`,
      [tenantDb]
    );

    const existingTables = tableCheck.map(t => t.TABLE_NAME);
    const createdAt = new Date();

    if (existingTables.includes('candidate_positions')) {
      const positionCandidateId = uuidv4();
      const query = `
        INSERT INTO ${tenantDb}.candidate_positions 
        (position_candidate_id, candidate_id, position_id, organization_id, candidate_code, candidate_name, 
         job_title, domain_type, position_code, invited_date, resume_score, status, recommendation_status,
         question_set_id, question_section_id, question_set_duration, interview_notes, internal_notes, notes_by, notes_date,
         workflow_stage, invitation_sent_at, created_by, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `;

      const values = [
        positionCandidateId,
        positionData.candidate_id,
        positionData.position_id,
        positionData.organization_id,
        positionData.candidate_code,
        positionData.candidate_name,
        positionData.job_title,
        positionData.domain_type,
        positionData.position_code,
        positionData.invited_date || new Date(),
        positionData.resume_score,
        positionData.status || CANDIDATE_STATUSES.INVITED,
        positionData.recommendation_status || 'PENDING',
        positionData.question_set_id,
        positionData.question_section_id,
        positionData.question_set_duration,
        positionData.interview_notes,
        positionData.internal_notes,
        positionData.notes_by,
        positionData.notes_date,
        positionData.workflow_stage || 'Initial Review',
        positionData.invitation_sent_at || null,
        positionData.created_by,
        createdAt,
        createdAt
      ];

      await db.query(query, values);

      // Return the full object
      const [newRecord] = await db.query(
        `SELECT HEX(position_candidate_id) as positionCandidateId, HEX(candidate_id) as candidateId, 
                HEX(position_id) as positionId, HEX(organization_id) as organizationId, 
                candidate_code as candidateCode, candidate_name as candidateName, 
                job_title as jobTitle, domain_type as domainType, position_code as positionCode, 
                invited_date as invitedDate, resume_score as resumeScore, status, recommendation_status as recommendationStatus,
                HEX(question_set_id) as questionSetId, HEX(question_section_id) as questionSectionId, 
                question_set_duration as questionSetDuration, interview_notes as interviewNotes, 
                internal_notes as internalNotes, notes_by as notesBy, notes_date as notesDate,
                workflow_stage as workflowStage, invitation_sent_at as invitationSentAt, 
                created_by as createdBy, created_at as createdAt, updated_at as updatedAt
         FROM ${tenantDb}.candidate_positions WHERE position_candidate_id = ?`,
        [positionCandidateId]
      );
      return newRecord;
    }

    // Support for BINARY(16) schemas (position_candidates or job_candidates)
    let tableName = null;
    let positionIdCol = 'position_id';

    if (existingTables.includes('position_candidates')) {
      tableName = 'position_candidates';
    } else if (existingTables.includes('job_candidates')) {
      tableName = 'job_candidates';
      positionIdCol = 'job_id';
    }

    if (tableName) {
      const id = uuidv4();
      const query = `
        INSERT INTO \`${tenantDb}\`.\`${tableName}\`
        (id, candidate_id, ${positionIdCol}, question_set_id, recommendation, invitation_sent_at, link_active_at, link_expires_at, created_at, updated_at)
        VALUES (UNHEX(?), UNHEX(?), UNHEX(?), UNHEX(?), ?, ?, ?, ?, ?, ?)
      `;

      const values = [
        id.replace(/-/g, ''),
        positionData.candidate_id.replace(/-/g, ''),
        positionData.position_id.replace(/-/g, ''),
        positionData.question_set_id.replace(/-/g, ''),
        positionData.recommendation_status || 'PENDING',
        positionData.invitation_sent_at || null,
        positionData.link_active_at || new Date(),
        positionData.link_expires_at || null,
        createdAt,
        createdAt
      ];

      await db.query(query, values);

      // Fetch and return the full object
      const [newRecord] = await db.query(
        `SELECT HEX(id) as id, HEX(candidate_id) as candidateId, HEX(${positionIdCol}) as positionId, 
                HEX(question_set_id) as questionSetId, recommendation as recommendationStatus,
                invitation_sent_at as invitationSentAt, link_active_at as linkActiveAt, 
                link_expires_at as linkExpiresAt, workflow_stage as workflowStage,
                created_at as createdAt, updated_at as updatedAt
         FROM \`${tenantDb}\`.\`${tableName}\` WHERE id = UNHEX(?)`,
        [id.replace(/-/g, '')]
      );

      // Add position title fallback if possible (usually fetched later or passed in)
      if (newRecord) {
        newRecord.positionTitle = positionData.job_title || positionData.position_name;
      }

      return newRecord;
    }

    throw new Error('No supported candidate-position mapping table found in ' + tenantDb);
  }

  // Get candidates for position
  static async getCandidatesForPosition(positionId, organizationId, tenantDb) {
    if (!tenantDb) {
      throw new Error('Tenant database is required for candidate-position lookup');
    }
    const query = `
      SELECT cp.* FROM ${tenantDb}.candidate_positions cp
      WHERE cp.position_id = ? AND cp.organization_id = ?
      ORDER BY cp.created_at DESC
    `;

    const rows = await db.query(query, [positionId, organizationId]);
    return rows;
  }

  // Create assessment record
  static async createAssessment(assessmentData, database = 'candidates_db') {
    const assessmentId = uuidv4();
    const createdAt = new Date();

    const query = `
      INSERT INTO ${database}.candidate_assessments 
      (assessment_id, candidate_id, organization_id, position_id, question_set_id, question_section_id,
       resume_score, assessment_round, round_status, started_at, completed_at, score, feedback, assessor_id, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `;

    const values = [
      assessmentId,
      assessmentData.candidate_id,
      assessmentData.organization_id,
      assessmentData.position_id,
      assessmentData.question_set_id,
      assessmentData.question_section_id,
      assessmentData.resume_score,
      assessmentData.assessment_round,
      assessmentData.round_status || 'SCHEDULED',
      assessmentData.started_at,
      assessmentData.completed_at,
      assessmentData.score,
      assessmentData.feedback,
      assessmentData.assessor_id,
      createdAt,
      createdAt
    ];

    const result = await db.query(query, values);
    return assessmentId;
  }

  // Get assessment records for candidate
  static async getCandidateAssessments(candidateId, organizationId, database = 'candidates_db') {
    const query = `
      SELECT * FROM ${database}.candidate_assessments 
      WHERE candidate_id = ? AND organization_id = ?
      ORDER BY assessment_round ASC, created_at DESC
    `;

    const rows = await db.query(query, [candidateId, organizationId]);
    return rows;
  }

  // Create candidate application
  static async createCandidateApplied(appliedData, database = 'candidates_db') {
    const appliedId = uuidv4();
    const appliedIdBinary = this.uuidToBinary(appliedId);
    const positionIdBinary = this.uuidToBinary(appliedData.position_id);
    const createdAt = new Date();

    const query = `
      INSERT INTO ${database}.candidate_applied 
      (applied_id, candidate_id, organization_id, position_id, candidate_name, position_name, 
       email, source, application_status, remarks, applied_by, applied_at, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `;

    const values = [
      appliedIdBinary,
      appliedData.candidate_id,
      appliedData.organization_id,
      positionIdBinary,
      appliedData.candidate_name,
      appliedData.position_name,
      appliedData.email,
      appliedData.source || 'ADMIN_ADDED',
      appliedData.application_status || 'Applied',
      appliedData.remarks,
      appliedData.applied_by,
      appliedData.applied_at || createdAt,
      createdAt,
      createdAt
    ];

    await db.query(query, values);
    return appliedId;
  }

  // Get applied positions for candidate
  static async getCandidateApplications(candidateId, organizationId, database = 'candidates_db') {
    const query = `
      SELECT * FROM ${database}.candidate_applied
      WHERE candidate_id = ? AND organization_id = ?
      ORDER BY applied_at DESC
    `;

    const rows = await db.query(query, [candidateId, organizationId]);
    return rows;
  }

  // Get all applied candidates for position
  static async getAppliedCandidatesForPosition(positionId, organizationId, database = 'candidates_db') {
    const query = `
      SELECT * FROM ${database}.candidate_applied
      WHERE position_id = ? AND organization_id = ?
      ORDER BY applied_at DESC
    `;

    const rows = await db.query(query, [positionId, organizationId]);
    return rows;
  }

  // Update application status
  static async updateApplicationStatus(appliedId, applicationStatus, database = 'candidates_db') {
    const query = `
      UPDATE ${database}.candidate_applied
      SET application_status = ?, updated_at = NOW()
      WHERE applied_id = ?
    `;

    await db.query(query, [applicationStatus, appliedId]);
  }

  // Check if candidate already applied for position
  static async checkDuplicateApplication(candidateId, positionId, organizationId, database = 'candidates_db') {
    const query = `
      SELECT COUNT(*) as count FROM ${database}.candidate_applied
      WHERE candidate_id = ? AND position_id = ? AND organization_id = ?
    `;

    const rows = await db.query(query, [candidateId, positionId, organizationId]);
    const count = rows[0]?.count || 0;
    return count > 0;
  }

  // Add position candidate (standalone method for /position-candidates/add route)
  // Returns full reference-aligned response matching backend_admin-main PositionCandidateResponse
  static async addPositionCandidate(data, tenantDb) {
    const id = uuidv4();
    const now = new Date();

    const {
      positionId,
      candidateId,
      questionSetId,
      linkActiveAt,
      linkExpiresAt,
      interviewScheduledBy,
      recommendationStatus,
      positionTitle: positionTitleFromPayload,
      organizationId,
      createdBy
    } = data;

    // Helper: format datetime for MySQL
    const toMysqlDt = (val) => {
      if (!val) return null;
      const d = new Date(val);
      return d.toISOString().slice(0, 19).replace('T', ' ');
    };

    const isLinkActive = !!(linkActiveAt && linkExpiresAt && new Date() < new Date(linkExpiresAt));

    // Check which table exists in tenant DB
    const tablesResult = await db.query(
      `SELECT TABLE_NAME FROM INFORMATION_SCHEMA.TABLES 
       WHERE TABLE_SCHEMA = ? AND TABLE_NAME IN ('candidate_positions', 'position_candidates', 'job_candidates')`,
      [tenantDb]
    );
    const existingTables = tablesResult.map(r => r.TABLE_NAME);

    // Helper: safe hex-strip for UNHEX
    const hex = (uuid) => (uuid || '').replace(/-/g, '');

    // ── Position details: title, code, domain_type, experience, deadline ────
    let positionTitle = positionTitleFromPayload || null;
    let positionCode = null;
    let domainType = null;
    let minExperience = null;
    let maxExperience = null;
    let applicationDeadline = null;
    try {
      const hexId = hex(positionId);
      let posRow = (await db.query(
        `SELECT title, code, domain_type, minimum_experience, maximum_experience, application_deadline
         FROM \`${tenantDb}\`.positions WHERE id = UNHEX(?) LIMIT 1`,
        [hexId]
      ))[0];
      if (!posRow && hexId) {
        posRow = (await db.query(
          `SELECT title, code, domain_type, minimum_experience, maximum_experience, application_deadline
           FROM \`${tenantDb}\`.positions WHERE HEX(id) = ? LIMIT 1`,
          [hexId.toLowerCase()]
        ))[0];
      }
      if (posRow) {
        positionTitle = positionTitle || posRow.title || null;
        positionCode = posRow.code || null;
        domainType = posRow.domain_type || null;
        minExperience = posRow.minimum_experience != null ? posRow.minimum_experience : null;
        maxExperience = posRow.maximum_experience != null ? posRow.maximum_experience : null;
        applicationDeadline = posRow.application_deadline ? toMysqlDt(posRow.application_deadline) : null;
      }
    } catch (_) { }

    // ── Question set duration ─────────────────────────────────────────────────
    let questionSetDuration = null;
    try {
      const qsRows = await db.query(
        `SELECT total_duration FROM \`${tenantDb}\`.question_sets WHERE id = UNHEX(?) LIMIT 1`,
        [(questionSetId || '').replace(/-/g, '')]
      );
      questionSetDuration = qsRows[0]?.total_duration || null;
    } catch (_) { }

    // ── Fetch interviewer name from auth_db.users (for interviewScheduledByName) ─
    let interviewScheduledByName = null;
    if (interviewScheduledBy) {
      try {
        const userRows = await db.query(
          'SELECT first_name, last_name FROM auth_db.users WHERE id = ? LIMIT 1',
          [interviewScheduledBy]
        );
        const u = userRows[0];
        if (u) {
          const first = (u.first_name || '').trim();
          const last = (u.last_name || '').trim();
          interviewScheduledByName = [first, last].filter(Boolean).join(' ') || null;
        }
      } catch (_) { }
    }

    // ══════════════════════════════════════════════════════════
    // Schema A: position_candidates (BINARY(16) - reference project)
    // ══════════════════════════════════════════════════════════
    if (existingTables.includes('position_candidates')) {
      const invitationSentAtStr = toMysqlDt(now);
      const insertQWithInvitation = `
        INSERT INTO \`${tenantDb}\`.position_candidates
          (id, candidate_id, position_id, question_set_id, recommendation,
           link_active_at, link_expires_at, invitation_sent_at, last_invitation_sent_at,
           interview_scheduled_by, created_at, updated_at)
        VALUES (UNHEX(?), UNHEX(?), UNHEX(?), UNHEX(?), ?, ?, ?, ?, ?, ${interviewScheduledBy ? 'UNHEX(?)' : 'NULL'}, ?, ?)
      `;
      const valsWithInv = [
        hex(id), hex(candidateId), hex(positionId), hex(questionSetId),
        recommendationStatus || 'INVITED',
        toMysqlDt(linkActiveAt) || toMysqlDt(now),
        toMysqlDt(linkExpiresAt),
        invitationSentAtStr,
        invitationSentAtStr,
      ];
      if (interviewScheduledBy) valsWithInv.push(hex(interviewScheduledBy));
      valsWithInv.push(toMysqlDt(now), toMysqlDt(now));
      await db.query(insertQWithInvitation, valsWithInv);

      const rows = await db.query(
        `SELECT HEX(id) as id,
                HEX(candidate_id) as candidateId,
                HEX(position_id) as positionId,
                HEX(question_set_id) as questionSetId,
                recommendation as recommendationStatus,
                HEX(status_changed_by) as statusChangedBy,
                status_changed_at as statusChangedAt,
                resume_match_score as resumeMatchScore,
                skills_match_percentage as skillsMatchPercentage,
                experience_match_percentage as experienceMatchPercentage,
                DATE_FORMAT(invitation_sent_at, '%Y-%m-%d %H:%i:%s') as invitationSentAt,
                DATE_FORMAT(last_invitation_sent_at, '%Y-%m-%d %H:%i:%s') as lastInvitationSentAt,
                DATE_FORMAT(link_active_at, '%Y-%m-%d %H:%i:%s') as linkActiveAt,
                DATE_FORMAT(link_expires_at, '%Y-%m-%d %H:%i:%s') as linkExpiresAt,
                room_id as roomId,
                recording_link as recordingLink,
                feedback_link as feedbackLink,
                HEX(interview_scheduled_by) as interviewScheduledBy,
                candidate_overall_score as candidateOverallScore,
                interview_completed_at as interviewCompletedAt,
                DATE_FORMAT(created_at, '%Y-%m-%d %H:%i:%s') as createdAt,
                DATE_FORMAT(updated_at, '%Y-%m-%d %H:%i:%s') as updatedAt
         FROM \`${tenantDb}\`.position_candidates WHERE id = UNHEX(?)`,
        [hex(id)]
      );
      const rec = rows && rows[0];

      const fmtUuid = (h) => h ? [
        h.slice(0, 8), h.slice(8, 12), h.slice(12, 16), h.slice(16, 20), h.slice(20)
      ].join('-').toLowerCase() : null;

      return {
        id: fmtUuid(rec?.id) || id,
        positionId: fmtUuid(rec?.positionId) || positionId,
        positionTitle: positionTitleFromPayload != null && positionTitleFromPayload !== '' ? positionTitleFromPayload : positionTitle,
        positionDepartment: null,
        recommendationStatus: rec?.recommendationStatus || recommendationStatus || 'INVITED',
        statusChangedBy: fmtUuid(rec?.statusChangedBy),
        statusChangedByName: null,
        statusChangedAt: rec?.statusChangedAt || null,
        resumeMatchScore: rec?.resumeMatchScore || null,
        skillsMatchPercentage: rec?.skillsMatchPercentage || null,
        experienceMatchPercentage: rec?.experienceMatchPercentage || null,
        invitationSentAt: rec?.invitationSentAt ?? invitationSentAtStr,
        lastInvitationSentAt: rec?.lastInvitationSentAt ?? invitationSentAtStr,
        linkActiveAt: rec?.linkActiveAt ?? (toMysqlDt(linkActiveAt) || invitationSentAtStr),
        linkExpiresAt: rec?.linkExpiresAt ?? toMysqlDt(linkExpiresAt),
        roomId: rec?.roomId || null,
        recordingLink: rec?.recordingLink || null,
        feedbackLink: rec?.feedbackLink || null,
        interviewScheduledBy: fmtUuid(rec?.interviewScheduledBy) || (interviewScheduledBy || null),
        interviewScheduledByName: interviewScheduledByName ?? null,
        candidateOverallScore: rec?.candidateOverallScore || null,
        interviewCompletedAt: rec?.interviewCompletedAt || null,
        createdAt: rec?.createdAt ?? invitationSentAtStr,
        updatedAt: rec?.updatedAt ?? invitationSentAtStr,
        overallMatchPercentage: null,
        linkActive: isLinkActive,
        interviewCompleted: false,
        invitationSent: true,
        workflowStage: 'Initial Review'
      };
    }

    // ══════════════════════════════════════════════════════════
    // Schema B: candidate_positions (VARCHAR UUID - college admin)
    // ══════════════════════════════════════════════════════════
    if (existingTables.includes('candidate_positions')) {
      if (!organizationId) {
        throw new Error("organization_id is required for candidate_positions. Send organizationId in the request body (e.g. from localStorage).");
      }
      const invitationSentAtStr = toMysqlDt(now);

      // Fetch candidate profile (name, code, email, phone) from college_candidates
      let candidateName = null;
      let candidateCode_ = null;
      try {
        const ccRows = await db.query(
          `SELECT candidate_name, candidate_code FROM candidates_db.college_candidates WHERE candidate_id = ? LIMIT 1`,
          [candidateId]
        );
        if (Array.isArray(ccRows) && ccRows[0]) {
          candidateName = ccRows[0].candidate_name || null;
          candidateCode_ = ccRows[0].candidate_code || null;
        }
      } catch (_) { /* college_candidates may not exist in this environment */ }

      await db.query(
        `INSERT INTO \`${tenantDb}\`.candidate_positions
          (position_candidate_id, candidate_id, position_id, organization_id,
           candidate_code, candidate_name, job_title, domain_type, position_code,
           minimum_experience, maximum_experience, application_deadline,
           question_set_id, question_set_duration,
           recommendation_status, status, invited_date, link_expires_at,
           invitation_sent_at, interview_scheduled_by, created_by, created_at, updated_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'Pending', ?, ?, ?, ?, ?, ?, ?)`,
        [
          id, candidateId, positionId, organizationId,
          candidateCode_ || null, candidateName || null,
          positionTitle || null, domainType || null, positionCode || null,
          minExperience, maxExperience, applicationDeadline,
          questionSetId, questionSetDuration || null,
          'PENDING',
          toMysqlDt(linkActiveAt) || toMysqlDt(now),
          toMysqlDt(linkExpiresAt),
          invitationSentAtStr,
          interviewScheduledBy || null,
          createdBy || null,
          toMysqlDt(now), toMysqlDt(now)
        ]
      );

      const rows = await db.query(
        `SELECT position_candidate_id as positionCandidateId,
                candidate_name as candidateName,
                candidate_code as candidateCode,
                recommendation_status as recommendationStatus,
                DATE_FORMAT(invited_date, '%Y-%m-%d %H:%i:%s') as linkActiveAt,
                DATE_FORMAT(link_expires_at, '%Y-%m-%d %H:%i:%s') as linkExpiresAt,
                DATE_FORMAT(invitation_sent_at, '%Y-%m-%d %H:%i:%s') as invitationSentAt,
                interview_scheduled_by as interviewScheduledBy,
                DATE_FORMAT(created_at, '%Y-%m-%d %H:%i:%s') as createdAt,
                DATE_FORMAT(updated_at, '%Y-%m-%d %H:%i:%s') as updatedAt
         FROM \`${tenantDb}\`.candidate_positions WHERE position_candidate_id = ?`,
        [id]
      );
      const rec = rows[0];

      return {
        id: rec?.positionCandidateId || id,
        candidateName: rec?.candidateName || candidateName || null,
        candidateCode: rec?.candidateCode || candidateCode_ || null,
        positionId,
        positionTitle: positionTitleFromPayload != null && positionTitleFromPayload !== '' ? positionTitleFromPayload : positionTitle,
        positionDepartment: null,
        recommendationStatus: rec?.recommendationStatus || 'INVITED',
        statusChangedBy: null, statusChangedByName: null, statusChangedAt: null,
        resumeMatchScore: null, skillsMatchPercentage: null, experienceMatchPercentage: null,
        invitationSentAt: rec?.invitationSentAt ?? invitationSentAtStr,
        lastInvitationSentAt: rec?.invitationSentAt ?? invitationSentAtStr,
        linkActiveAt: rec?.linkActiveAt ?? invitationSentAtStr,
        linkExpiresAt: rec?.linkExpiresAt ?? toMysqlDt(linkExpiresAt),
        roomId: null, recordingLink: null, feedbackLink: null,
        interviewScheduledBy: rec?.interviewScheduledBy ?? interviewScheduledBy,
        interviewScheduledByName: interviewScheduledByName ?? null,
        candidateOverallScore: null, interviewCompletedAt: null,
        createdAt: rec?.createdAt ?? invitationSentAtStr,
        updatedAt: rec?.updatedAt ?? invitationSentAtStr,
        overallMatchPercentage: null,
        linkActive: isLinkActive,
        interviewCompleted: false,
        invitationSent: true,
        workflowStage: 'Initial Review'
      };
    }

    // ══════════════════════════════════════════════════════════
    // Fallback response (no matching table found) – still return payload/derived values
    // ══════════════════════════════════════════════════════════
    const fallbackNow = toMysqlDt(now);
    const fallbackTitle = positionTitleFromPayload != null && positionTitleFromPayload !== '' ? positionTitleFromPayload : positionTitle;
    console.warn('addPositionCandidate: no matching table in', tenantDb, '- tables found:', existingTables);
    return {
      id,
      positionId,
      positionTitle: fallbackTitle,
      positionDepartment: null,
      recommendationStatus: recommendationStatus || 'INVITED',
      statusChangedBy: null,
      statusChangedByName: null,
      statusChangedAt: null,
      resumeMatchScore: null,
      skillsMatchPercentage: null,
      experienceMatchPercentage: null,
      invitationSentAt: fallbackNow,
      lastInvitationSentAt: fallbackNow,
      linkActiveAt: toMysqlDt(linkActiveAt) || fallbackNow,
      linkExpiresAt: toMysqlDt(linkExpiresAt),
      roomId: null,
      recordingLink: null,
      feedbackLink: null,
      interviewScheduledBy: interviewScheduledBy || null,
      interviewScheduledByName: interviewScheduledByName ?? null,
      candidateOverallScore: null,
      interviewCompletedAt: null,
      createdAt: fallbackNow,
      updatedAt: fallbackNow,
      overallMatchPercentage: null,
      linkActive: isLinkActive,
      interviewCompleted: false,
      invitationSent: true,
      workflowStage: 'Initial Review'
    };
  }

  // Update resume match score for a position-candidate link (for Resume ATS).
  static async updateResumeScore(tenantDb, positionCandidateId, score) {
    if (!tenantDb || positionCandidateId == null) {
      throw new Error('tenantDb and positionCandidateId are required');
    }
    const numScore = parseFloat(score);
    if (Number.isNaN(numScore) || numScore < 0 || numScore > 100) {
      throw new Error('score must be a number between 0 and 100');
    }
    const tablesResult = await db.query(
      `SELECT TABLE_NAME FROM INFORMATION_SCHEMA.TABLES 
       WHERE TABLE_SCHEMA = ? AND TABLE_NAME IN ('candidate_positions', 'position_candidates')`,
      [tenantDb]
    );
    const tables = (tablesResult || []).map(r => r.TABLE_NAME);
    const hexId = (positionCandidateId || '').replace(/-/g, '');
    if (tables.includes('candidate_positions')) {
      const result = await db.query(
        `UPDATE \`${tenantDb}\`.candidate_positions SET resume_score = ? WHERE position_candidate_id = ?`,
        [numScore, positionCandidateId]
      );
      if (result && result.affectedRows > 0) return { updated: true, table: 'candidate_positions' };
    }
    if (tables.includes('position_candidates') && hexId.length === 32) {
      try {
        const result = await db.query(
          `UPDATE \`${tenantDb}\`.position_candidates SET resume_match_score = ? WHERE id = UNHEX(?)`,
          [numScore, hexId]
        );
        if (result && result.affectedRows > 0) return { updated: true, table: 'position_candidates' };
      } catch (colErr) {
        if (colErr.code === 'ER_BAD_FIELD_ERROR' && colErr.message && colErr.message.includes('resume_match_score')) {
          try {
            await db.query(
              `ALTER TABLE \`${tenantDb}\`.position_candidates ADD COLUMN resume_match_score DECIMAL(5,2) NULL`
            );
            const retry = await db.query(
              `UPDATE \`${tenantDb}\`.position_candidates SET resume_match_score = ? WHERE id = UNHEX(?)`,
              [numScore, hexId]
            );
            if (retry && retry.affectedRows > 0) return { updated: true, table: 'position_candidates' };
          } catch (alterErr) {
            throw new Error('position_candidates.resume_match_score column missing and could not add it: ' + (alterErr.message || ''));
          }
        } else {
          throw colErr;
        }
      }
    }
    return { updated: false };
  }

  // Update recommendation status (e.g. INVITED, RESUME_REJECTED) for a position-candidate link.
  static async updateRecommendationStatus(tenantDb, positionCandidateId, recommendationStatus) {
    if (!tenantDb || positionCandidateId == null || !recommendationStatus) {
      throw new Error('tenantDb, positionCandidateId and recommendationStatus are required');
    }
    const tablesResult = await db.query(
      `SELECT TABLE_NAME FROM INFORMATION_SCHEMA.TABLES 
       WHERE TABLE_SCHEMA = ? AND TABLE_NAME IN ('candidate_positions', 'position_candidates')`,
      [tenantDb]
    );
    const tables = (tablesResult || []).map(r => r.TABLE_NAME);
    const hexId = (positionCandidateId || '').replace(/-/g, '');
    if (tables.includes('candidate_positions')) {
      const statusDisplay = recommendationStatus === 'INVITED' ? 'Invited' : recommendationStatus === 'MANUALLY_INVITED' ? 'MANUALLY_INVITED' : recommendationStatus;
      const result = await db.query(
        `UPDATE \`${tenantDb}\`.candidate_positions SET recommendation_status = ?, status = ? WHERE position_candidate_id = ?`,
        [recommendationStatus, statusDisplay, positionCandidateId]
      );
      if (result && result.affectedRows > 0) return { updated: true, table: 'candidate_positions' };
    }
    if (tables.includes('position_candidates') && hexId.length === 32) {
      const result = await db.query(
        `UPDATE \`${tenantDb}\`.position_candidates SET recommendation = ? WHERE id = UNHEX(?)`,
        [recommendationStatus, hexId]
      );
      if (result && result.affectedRows > 0) return { updated: true, table: 'position_candidates' };
    }
    return { updated: false };
  }

  // Get position-candidate details for creating private link (by positionCandidateId).
  static async getPositionCandidateDetailsForLink(tenantDb, positionCandidateId) {
    if (!tenantDb || !positionCandidateId) return null;
    const hexId = (positionCandidateId || '').replace(/-/g, '');
    const tablesResult = await db.query(
      `SELECT TABLE_NAME FROM INFORMATION_SCHEMA.TABLES 
       WHERE TABLE_SCHEMA = ? AND TABLE_NAME IN ('candidate_positions', 'position_candidates')`,
      [tenantDb]
    );
    const tables = (tablesResult || []).map(r => r.TABLE_NAME);
    if (tables.includes('candidate_positions')) {
      const rows = await db.query(
        `SELECT cp.position_candidate_id as positionCandidateId, cp.candidate_id as candidateId, cp.position_id as positionId,
                cp.question_set_id as questionSetId, cp.invited_date as linkActiveAt, cp.link_expires_at as linkExpiresAt,
                cp.candidate_name as candidateName,
                COALESCE(p.title, cp.job_title) as positionName
         FROM \`${tenantDb}\`.candidate_positions cp
         LEFT JOIN \`${tenantDb}\`.positions p
           ON p.id = UNHEX(REPLACE(COALESCE(cp.position_id, ''), '-', ''))
         WHERE cp.position_candidate_id = ? LIMIT 1`,
        [positionCandidateId]
      );
      const r = rows[0];
      if (!r) return null;
      const fmt = (id) => (id && String(id).replace(/-/g, '').length === 32 ? (String(id).length === 32 ? id.replace(/(\w{8})(\w{4})(\w{4})(\w{4})(\w{12})/, '$1-$2-$3-$4-$5') : id) : id);
      return {
        candidateId: r.candidateId ? fmt(r.candidateId) : null,
        positionId: r.positionId ? fmt(r.positionId) : null,
        questionSetId: r.questionSetId ? fmt(r.questionSetId) : null,
        linkActiveAt: r.linkActiveAt,
        linkExpiresAt: r.linkExpiresAt,
        candidateName: r.candidateName,
        positionName: r.positionName
      };
    }
    if (tables.includes('position_candidates') && hexId.length === 32) {
      const rows = await db.query(
        `SELECT HEX(pc.id) as positionCandidateId, HEX(pc.candidate_id) as candidateId, HEX(pc.position_id) as positionId,
                HEX(pc.question_set_id) as questionSetId,
                DATE_FORMAT(pc.link_active_at, '%Y-%m-%dT%H:%i:%s.000Z') as linkActiveAt,
                DATE_FORMAT(pc.link_expires_at, '%Y-%m-%dT%H:%i:%s.000Z') as linkExpiresAt,
                p.title as positionName
         FROM \`${tenantDb}\`.position_candidates pc
         LEFT JOIN \`${tenantDb}\`.positions p ON p.id = pc.position_id
         WHERE pc.id = UNHEX(?) LIMIT 1`,
        [hexId]
      );
      const r = rows[0];
      if (!r) return null;
      const fmt = (h) => (h && h.length === 32 ? h.toLowerCase().replace(/(\w{8})(\w{4})(\w{4})(\w{4})(\w{12})/, '$1-$2-$3-$4-$5') : h);
      return {
        candidateId: fmt(r.candidateId),
        positionId: fmt(r.positionId),
        questionSetId: fmt(r.questionSetId),
        linkActiveAt: r.linkActiveAt,
        linkExpiresAt: r.linkExpiresAt,
        candidateName: r.candidateName || null,
        positionName: r.positionName || null
      };
    }
    return null;
  }

  // Get a single position-candidate by positionId and candidateId.
  static async getPositionCandidate(positionId, candidateId, tenantDb) {
    if (!tenantDb || !positionId || !candidateId) return null;
    const tablesResult = await db.query(
      `SELECT TABLE_NAME FROM INFORMATION_SCHEMA.TABLES 
       WHERE TABLE_SCHEMA = ? AND TABLE_NAME IN ('candidate_positions', 'position_candidates')`,
      [tenantDb]
    );
    const tables = (tablesResult || []).map((r) => r.TABLE_NAME);
    const posId = String(positionId).replace(/-/g, '');
    const candId = String(candidateId).replace(/-/g, '');
    if (tables.includes('candidate_positions')) {
      const rows = await db.query(
        `SELECT cp.position_candidate_id AS positionCandidateId, cp.candidate_id AS candidateId, cp.position_id AS positionId,
                cp.question_set_id AS questionSetId, cp.invited_date AS linkActiveAt, cp.link_expires_at AS linkExpiresAt,
                cp.candidate_name AS candidateName, cp.job_title AS positionName,
                COALESCE(cp.recommendation_status, cp.status) AS recommendationStatus
         FROM \`${tenantDb}\`.candidate_positions cp
         WHERE (REPLACE(LOWER(TRIM(cp.position_id)), '-', '') = ? OR LOWER(TRIM(cp.position_id)) = LOWER(?))
           AND (REPLACE(LOWER(TRIM(cp.candidate_id)), '-', '') = ? OR LOWER(TRIM(cp.candidate_id)) = LOWER(?))
         LIMIT 1`,
        [posId, positionId, candId, candidateId]
      );
      const r = rows[0];
      if (!r) return null;
      const fmt = (id) => (id && String(id).replace(/-/g, '').length === 32 ? (String(id).length === 32 ? id.replace(/(\w{8})(\w{4})(\w{4})(\w{4})(\w{12})/, '$1-$2-$3-$4-$5') : id) : id);
      return {
        positionCandidateId: r.positionCandidateId ? fmt(r.positionCandidateId) : r.positionCandidateId,
        candidateId: r.candidateId ? fmt(r.candidateId) : r.candidateId,
        positionId: r.positionId ? fmt(r.positionId) : r.positionId,
        questionSetId: r.questionSetId ? fmt(r.questionSetId) : r.questionSetId,
        linkActiveAt: r.linkActiveAt,
        linkExpiresAt: r.linkExpiresAt,
        candidateName: r.candidateName,
        positionName: r.positionName,
        recommendationStatus: r.recommendationStatus
      };
    }
    if (tables.includes('position_candidates') && posId.length === 32 && candId.length === 32) {
      const rows = await db.query(
        `SELECT LOWER(BIN_TO_UUID(pc.id)) AS positionCandidateId, LOWER(BIN_TO_UUID(pc.candidate_id)) AS candidateId,
                LOWER(BIN_TO_UUID(pc.position_id)) AS positionId, LOWER(BIN_TO_UUID(pc.question_set_id)) AS questionSetId,
                pc.link_active_at AS linkActiveAt, pc.link_expires_at AS linkExpiresAt, p.title AS positionName,
                pc.recommendation AS recommendationStatus
         FROM \`${tenantDb}\`.position_candidates pc
         LEFT JOIN \`${tenantDb}\`.positions p ON p.id = pc.position_id
         WHERE pc.position_id = UNHEX(?) AND pc.candidate_id = UNHEX(?)
         LIMIT 1`,
        [posId, candId]
      );
      const r = rows[0];
      if (!r) return null;
      return {
        positionCandidateId: r.positionCandidateId,
        candidateId: r.candidateId,
        positionId: r.positionId,
        questionSetId: r.questionSetId,
        linkActiveAt: r.linkActiveAt,
        linkExpiresAt: r.linkExpiresAt,
        candidateName: null,
        positionName: r.positionName,
        recommendationStatus: r.recommendationStatus
      };
    }
    return null;
  }

  // Get positions for a candidate (stages) – tenant DB, latest first. For drawer dropdown + position details.
  static async getPositionsForCandidate(candidateId, organizationId, tenantDb) {
    if (!tenantDb || !candidateId || !organizationId) return [];
    const tableCheck = await db.query(
      `SELECT TABLE_NAME FROM INFORMATION_SCHEMA.TABLES 
       WHERE TABLE_SCHEMA = ? AND TABLE_NAME IN ('candidate_positions', 'position_candidates')`,
      [tenantDb]
    );
    const tables = (tableCheck || []).map((t) => t.TABLE_NAME);
    const cId = String(candidateId).replace(/-/g, '');
    if (tables.includes('candidate_positions')) {
      const rows = await db.query(
        `SELECT cp.position_candidate_id AS positionCandidateId, cp.candidate_id AS candidateId, cp.position_id AS positionId,
                cp.job_title AS positionTitle, cp.position_code AS positionCode, cp.domain_type AS domainType,
                cp.question_set_id AS questionSetId, cp.question_set_duration AS questionSetDuration,
                cp.invited_date AS linkActiveAt, cp.link_expires_at AS linkExpiresAt,
                cp.resume_score AS resumeMatchScore, COALESCE(cp.recommendation_status, cp.status) AS recommendationStatus,
                cp.created_at AS createdAt,
                p.title AS positionTitleFromPos, p.code AS positionCodeFromPos,
                qs.question_set_code AS questionSetCode, qs.question_set_code AS questionSetTitle
         FROM \`${tenantDb}\`.candidate_positions cp
         LEFT JOIN \`${tenantDb}\`.positions p ON (p.id = UNHEX(REPLACE(LOWER(TRIM(cp.position_id)), '-', '')) OR BIN_TO_UUID(p.id) = cp.position_id)
         LEFT JOIN \`${tenantDb}\`.question_sets qs ON (qs.id = UNHEX(REPLACE(LOWER(TRIM(cp.question_set_id)), '-', '')) OR BIN_TO_UUID(qs.id) = cp.question_set_id)
         WHERE (LOWER(TRIM(cp.candidate_id)) = LOWER(?) OR REPLACE(cp.candidate_id, '-', '') = ?) AND cp.organization_id = ?
         ORDER BY cp.created_at DESC`,
        [candidateId, cId, organizationId]
      );
      const list = Array.isArray(rows) ? rows : [];
      return list.map((r) => ({
        positionCandidateId: r.positionCandidateId,
        candidateId: r.candidateId,
        positionId: r.positionId,
        positionTitle: r.positionTitleFromPos || r.positionTitle || '—',
        positionCode: r.positionCodeFromPos || r.positionCode || '—',
        domainType: r.domainType,
        questionSetId: r.questionSetId,
        questionSetTitle: r.questionSetCode || r.questionSetTitle || '—',
        questionSetDuration: r.questionSetDuration,
        linkActiveAt: r.linkActiveAt,
        linkExpiresAt: r.linkExpiresAt,
        resumeMatchScore: r.resumeMatchScore,
        recommendationStatus: r.recommendationStatus,
        createdAt: r.createdAt
      }));
    }
    if (tables.includes('position_candidates')) {
      const hexCandidate = cId.length === 32 ? cId : null;
      if (!hexCandidate) return [];
      const rows = await db.query(
        `SELECT HEX(pc.id) AS positionCandidateId, HEX(pc.candidate_id) AS candidateId, HEX(pc.position_id) AS positionId,
                p.title AS positionTitle, p.code AS positionCode,
                HEX(pc.question_set_id) AS questionSetId,
                DATE_FORMAT(pc.link_active_at, '%Y-%m-%dT%H:%i:%s.000Z') AS linkActiveAt,
                DATE_FORMAT(pc.link_expires_at, '%Y-%m-%dT%H:%i:%s.000Z') AS linkExpiresAt,
                pc.resume_match_score AS resumeMatchScore, pc.recommendation AS recommendationStatus,
                pc.created_at AS createdAt
         FROM \`${tenantDb}\`.position_candidates pc
         LEFT JOIN \`${tenantDb}\`.positions p ON p.id = pc.position_id
         WHERE pc.candidate_id = UNHEX(?)
         ORDER BY pc.created_at DESC`,
        [hexCandidate]
      );
      const list = Array.isArray(rows) ? rows : [];
      return list.map((r) => ({
        positionCandidateId: r.positionCandidateId?.toLowerCase?.()?.replace(/(\w{8})(\w{4})(\w{4})(\w{4})(\w{12})/, '$1-$2-$3-$4-$5') || r.positionCandidateId,
        candidateId: r.candidateId?.toLowerCase?.()?.replace(/(\w{8})(\w{4})(\w{4})(\w{4})(\w{12})/, '$1-$2-$3-$4-$5') || r.candidateId,
        positionId: r.positionId?.toLowerCase?.()?.replace(/(\w{8})(\w{4})(\w{4})(\w{4})(\w{12})/, '$1-$2-$3-$4-$5') || r.positionId,
        positionTitle: r.positionTitle || '—',
        positionCode: r.positionCode || '—',
        questionSetId: r.questionSetId,
        questionSetTitle: '—',
        questionSetDuration: null,
        linkActiveAt: r.linkActiveAt,
        linkExpiresAt: r.linkExpiresAt,
        resumeMatchScore: r.resumeMatchScore,
        recommendationStatus: r.recommendationStatus,
        createdAt: r.createdAt
      }));
    }
    return [];
  }

  // Get assessment summary by candidateId + positionId. database = tenant DB or 'candidates_db'.
  // In candidates_db IDs are BINARY(16); in tenant DB they may be VARCHAR(36). Try both.
  static async getAssessmentSummary(candidateId, positionId, database = 'candidates_db', questionId = null, assessmentSummaryId = null) {
    if (!candidateId || !positionId) return null;
    const cHex = String(candidateId).replace(/-/g, '');
    const pHex = String(positionId).replace(/-/g, '');
    const qHex = String(questionId || '').replace(/-/g, '');
    const sHex = String(assessmentSummaryId || '').replace(/-/g, '');
    try {
      const tableCheck = await db.query(
        `SELECT TABLE_NAME FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_SCHEMA = ? AND TABLE_NAME = 'assessments_summary'`,
        [database]
      );
      const hasTable = Array.isArray(tableCheck) && tableCheck.length > 0;
      if (!hasTable) return null;
      const query = cHex.length === 32 && pHex.length === 32
        ? `
        SELECT HEX(id) as id, HEX(candidate_id) as candidateId, HEX(position_id) as positionId,
               HEX(question_id) as questionId,
               total_rounds_assigned as totalRoundsAssigned,
               total_rounds_completed as totalRoundsCompleted,
               total_interview_time as totalInterviewTime,
               assessment_start_time as assessmentStartTime,
               assessment_end_time as assessmentEndTime,
               round1_assigned as round1Assigned, round1_completed as round1Completed,
               round1_start_time as round1StartTime, round1_end_time as round1EndTime,
               round1_time_taken as round1TimeTaken, round1_given_time as round1GivenTime,
               round2_assigned as round2Assigned, round2_completed as round2Completed,
               round2_start_time as round2StartTime, round2_end_time as round2EndTime,
               round2_time_taken as round2TimeTaken, round2_given_time as round2GivenTime,
               round3_assigned as round3Assigned, round3_completed as round3Completed,
               round3_start_time as round3StartTime, round3_end_time as round3EndTime,
               round3_time_taken as round3TimeTaken, round3_given_time as round3GivenTime,
               round4_assigned as round4Assigned, round4_completed as round4Completed,
               round4_start_time as round4StartTime, round4_end_time as round4EndTime,
               round4_time_taken as round4TimeTaken, round4_given_time as round4GivenTime,
               is_assessment_completed as isAssessmentCompleted,
               is_report_generated as isReportGenerated,
               created_at as createdAt, updated_at as updatedAt
        FROM \`${database}\`.assessments_summary
        WHERE 
          (CASE WHEN ? != '' THEN id = UNHEX(?) ELSE TRUE END)
          AND candidate_id = UNHEX(?) AND position_id = UNHEX(?)
          AND (CASE WHEN ? != '' THEN question_id = UNHEX(?) ELSE TRUE END)
        ORDER BY total_rounds_assigned DESC, created_at DESC LIMIT 1
      `
        : `
        SELECT id, candidate_id as candidateId, position_id as positionId, question_id as questionId,
               total_rounds_assigned as totalRoundsAssigned,
               total_rounds_completed as totalRoundsCompleted,
               total_interview_time as totalInterviewTime,
               assessment_start_time as assessmentStartTime,
               assessment_end_time as assessmentEndTime,
               round1_assigned as round1Assigned, round1_completed as round1Completed,
               round1_start_time as round1StartTime, round1_end_time as round1EndTime,
               round1_time_taken as round1TimeTaken, round1_given_time as round1GivenTime,
               round2_assigned as round2Assigned, round2_completed as round2Completed,
               round2_start_time as round2StartTime, round2_end_time as round2EndTime,
               round2_time_taken as round2TimeTaken, round2_given_time as round2GivenTime,
               round3_assigned as round3Assigned, round3_completed as round3Completed,
               round3_start_time as round3StartTime, round3_end_time as round3EndTime,
               round3_time_taken as round3TimeTaken, round3_given_time as round3GivenTime,
               round4_assigned as round4Assigned, round4_completed as round4Completed,
               round4_start_time as round4StartTime, round4_end_time as round4EndTime,
               round4_time_taken as round4TimeTaken, round4_given_time as round4GivenTime,
               is_assessment_completed as isAssessmentCompleted,
               is_report_generated as isReportGenerated,
               created_at as createdAt, updated_at as updatedAt
        FROM \`${database}\`.assessments_summary
        WHERE
          (CASE WHEN ? != '' THEN REPLACE(id, '-', '') = ? ELSE TRUE END)
          AND (candidate_id = ? OR REPLACE(candidate_id, '-', '') = ?)
          AND (position_id = ? OR REPLACE(position_id, '-', '') = ?)
          AND (CASE WHEN ? != '' THEN (question_id = ? OR REPLACE(question_id, '-', '') = ?) ELSE TRUE END)
        ORDER BY total_rounds_assigned DESC, created_at DESC LIMIT 1
      `;
      const params = cHex.length === 32 && pHex.length === 32
        ? [sHex, sHex, cHex, pHex, qHex, qHex]
        : [sHex, sHex, candidateId, cHex, positionId, pHex, qHex, questionId, qHex];
      const rows = await db.query(query, params);
      const row = Array.isArray(rows) && rows[0] ? rows[0] : null;
      return row || null;
    } catch (err) {
      console.error('getAssessmentSummary error:', err.message);
      return null;
    }
  }

  /**
   * Update assessment summary by candidateId + positionId. Only updates provided fields.
   * updates: { assessmentStartTime, assessmentEndTime, round1StartTime, round1EndTime, round1TimeTaken, round1Completed, ... }
   */
  static async updateAssessmentSummary(candidateId, positionId, updates, database = 'candidates_db', assessmentSummaryId = null) {
    if (!candidateId || !positionId || !updates || typeof updates !== 'object') return null;
    const cHex = String(candidateId).replace(/-/g, '');
    const pHex = String(positionId).replace(/-/g, '');
    const sHex = assessmentSummaryId ? String(assessmentSummaryId).replace(/-/g, '') : '';
    const allowed = {
      assessmentStartTime: 'assessment_start_time',
      assessmentEndTime: 'assessment_end_time',
      totalRoundsAssigned: 'total_rounds_assigned',
      totalRoundsCompleted: 'total_rounds_completed',
      round1StartTime: 'round1_start_time',
      round1EndTime: 'round1_end_time',
      round1TimeTaken: 'round1_time_taken',
      round1Completed: 'round1_completed',
      round2StartTime: 'round2_start_time',
      round2EndTime: 'round2_end_time',
      round2TimeTaken: 'round2_time_taken',
      round2Completed: 'round2_completed',
      round3StartTime: 'round3_start_time',
      round3EndTime: 'round3_end_time',
      round3TimeTaken: 'round3_time_taken',
      round3Completed: 'round3_completed',
      round4StartTime: 'round4_start_time',
      round4EndTime: 'round4_end_time',
      round4TimeTaken: 'round4_time_taken',
      round4Completed: 'round4_completed',
      isAssessmentCompleted: 'is_assessment_completed',
      isReportGenerated: 'is_report_generated',
    };
    const setParts = [];
    const values = [];
    for (const [key, col] of Object.entries(allowed)) {
      if (!Object.prototype.hasOwnProperty.call(updates, key)) continue;
      const v = updates[key];
      setParts.push(`${col} = ?`);
      values.push(v === null || v === undefined ? null : (typeof v === 'boolean' ? (v ? 1 : 0) : String(v)));
    }
    if (setParts.length === 0) return await this.getAssessmentSummary(candidateId, positionId, database, null, assessmentSummaryId || null);
    setParts.push('updated_at = NOW()');
    const query = `UPDATE \`${database}\`.assessments_summary SET ${setParts.join(', ')}
      WHERE candidate_id = UNHEX(?) AND position_id = UNHEX(?)`
      + (sHex.length === 32 ? ' AND (CASE WHEN ? != \'\' THEN id = UNHEX(?) ELSE TRUE END)' : '');
    values.push(cHex, pHex);
    if (sHex.length === 32) values.push(sHex, sHex);
    try {
      await db.query(query, values);
      return await this.getAssessmentSummary(candidateId, positionId, database, null, assessmentSummaryId || null);
    } catch (err) {
      console.error('updateAssessmentSummary error:', err.message);
      return null;
    }
  }

  // Create assessment summary
  static async createAssessmentSummary(summaryData, database = 'candidates_db') {
    const summaryId = uuidv4();
    const createdAt = new Date();

    // Compute totalRoundsAssigned from round*Assigned booleans
    const r1 = !!(summaryData.round1Assigned ?? true);
    const r2 = !!(summaryData.round2Assigned ?? true);
    const r3 = !!(summaryData.round3Assigned ?? false);
    const r4 = !!(summaryData.round4Assigned ?? false);
    const totalRoundsAssigned = (r1 ? 1 : 0) + (r2 ? 1 : 0) + (r3 ? 1 : 0) + (r4 ? 1 : 0);

    // Try to insert with all columns; fallback if some columns don't exist yet
    const query = `
      INSERT INTO ${database}.assessments_summary
      (id, candidate_id, position_id, question_id,
       total_rounds_assigned, total_rounds_completed, total_interview_time,
       is_assessment_completed, is_report_generated, 
       round1_assigned, round1_completed, round1_given_time,
       round2_assigned, round2_completed, round2_given_time,
       round3_assigned, round3_completed, round3_given_time,
       round4_assigned, round4_completed, round4_given_time,
       created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `;

    const values = [
      this.uuidToBinary(summaryId),
      this.uuidToBinary(summaryData.candidateId || summaryData.candidate_id),
      this.uuidToBinary(summaryData.positionId || summaryData.position_id),
      this.uuidToBinary(summaryData.questionId || summaryData.question_set_id || summaryData.question_id),
      totalRoundsAssigned,
      summaryData.totalRoundsCompleted ?? 0,
      summaryData.totalInterviewTime ?? '0',
      summaryData.isAssessmentCompleted ?? false,
      summaryData.isReportGenerated ?? false,
      r1,
      summaryData.round1Completed ?? false,
      summaryData.round1GivenTime ?? null,
      r2,
      summaryData.round2Completed ?? false,
      summaryData.round2GivenTime ?? null,
      r3,
      summaryData.round3Completed ?? false,
      summaryData.round3GivenTime ?? null,
      r4,
      summaryData.round4Completed ?? false,
      summaryData.round4GivenTime ?? null,
      createdAt,
      createdAt
    ];

    // If migration hasn't run yet, fall back to older minimal schema
    try {
      await db.query(query, values);
    } catch (schemaErr) {
      if (schemaErr.code === 'ER_BAD_FIELD_ERROR') {
        try {
          const fallbackQuery = `
            INSERT INTO ${database}.assessments_summary
            (id, candidate_id, position_id, question_id, total_rounds_assigned, total_rounds_completed, total_interview_time,
             is_assessment_completed, is_report_generated, 
             round1_assigned, round1_completed, round2_assigned, round2_completed, 
             round3_assigned, round3_completed, round4_assigned, round4_completed, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          `;
          await db.query(fallbackQuery, [
            this.uuidToBinary(summaryId),
            this.uuidToBinary(summaryData.candidateId || summaryData.candidate_id),
            this.uuidToBinary(summaryData.positionId || summaryData.position_id),
            this.uuidToBinary(summaryData.questionId || summaryData.question_set_id || summaryData.question_id),
            totalRoundsAssigned,
            summaryData.totalRoundsCompleted ?? 0,
            summaryData.totalInterviewTime ?? '0',
            summaryData.isAssessmentCompleted ?? false,
            summaryData.isReportGenerated ?? false,
            r1,
            summaryData.round1Completed ?? false,
            r2,
            summaryData.round2Completed ?? false,
            r3,
            summaryData.round3Completed ?? false,
            r4,
            summaryData.round4Completed ?? false,
            createdAt,
            createdAt
          ]);
        } catch (fallbackErr) {
          if (fallbackErr.code === 'ER_BAD_FIELD_ERROR') {
            const minimalQuery = `
              INSERT INTO ${database}.assessments_summary
              (id, candidate_id, position_id, question_id, is_assessment_completed, is_report_generated,
               round1_assigned, round1_completed, round2_assigned, round2_completed,
               round3_assigned, round3_completed, round4_assigned, round4_completed, created_at)
              VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            `;
            await db.query(minimalQuery, [
              this.uuidToBinary(summaryId),
              this.uuidToBinary(summaryData.candidateId || summaryData.candidate_id),
              this.uuidToBinary(summaryData.positionId || summaryData.position_id),
              this.uuidToBinary(summaryData.questionId || summaryData.question_set_id || summaryData.question_id),
              summaryData.isAssessmentCompleted ?? false,
              summaryData.isReportGenerated ?? false,
              r1, summaryData.round1Completed ?? false,
              r2, summaryData.round2Completed ?? false,
              r3, summaryData.round3Completed ?? false,
              r4, summaryData.round4Completed ?? false,
              createdAt
            ]);
          } else {
            throw fallbackErr;
          }
        }
      } else {
        throw schemaErr;
      }
    }

    const hexToUuid = (val) => {
      if (!val) return null;
      const s = (typeof val === 'string' ? val : (Buffer.isBuffer(val) ? val.toString('hex') : String(val))).replace(/-/g, '').toLowerCase();
      if (s.length !== 32) return val;
      return [s.slice(0, 8), s.slice(8, 12), s.slice(12, 16), s.slice(16, 20), s.slice(20)].join('-');
    };
    const toDateTime = (d) => (d ? (d instanceof Date ? d.toISOString().slice(0, 19).replace('T', ' ') : String(d).slice(0, 19).replace('T', ' ')) : null);
    const createdDtStr = toDateTime(createdAt);

    return {
      id: hexToUuid(summaryId),
      positionId: hexToUuid(summaryData.positionId || summaryData.position_id),
      candidateId: hexToUuid(summaryData.candidateId || summaryData.candidate_id),
      questionId: hexToUuid(summaryData.questionId || summaryData.question_set_id || summaryData.question_id),
      totalRoundsAssigned,
      totalRoundsCompleted: summaryData.totalRoundsCompleted ?? 0,
      totalInterviewTime: summaryData.totalInterviewTime ?? '0',
      totalCompletionTime: null,
      assessmentStartTime: null,
      assessmentEndTime: null,
      round1Assigned: r1,
      round1Completed: !!summaryData.round1Completed,
      round1TimeTaken: null,
      round1StartTime: null,
      round1EndTime: null,
      round2Assigned: r2,
      round2Completed: !!summaryData.round2Completed,
      round2TimeTaken: null,
      round2StartTime: null,
      round2EndTime: null,
      round3Assigned: r3,
      round3Completed: !!summaryData.round3Completed,
      round3TimeTaken: null,
      round3StartTime: null,
      round3EndTime: null,
      round4Assigned: r4,
      round4Completed: !!summaryData.round4Completed,
      round4TimeTaken: null,
      round4StartTime: null,
      round4EndTime: null,
      round1AssignedTime: summaryData.round1GivenTime ?? null,
      round2AssignedTime: summaryData.round2GivenTime ?? null,
      round3AssignedTime: summaryData.round3GivenTime ?? null,
      round4AssignedTime: summaryData.round4GivenTime ?? null,
      isAssessmentCompleted: !!summaryData.isAssessmentCompleted,
      isReportGenerated: !!summaryData.isReportGenerated,
      createdAt: createdDtStr,
      updatedAt: createdDtStr
    };
  }
}

module.exports = CandidateModel;
