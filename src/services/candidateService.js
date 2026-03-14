const db = require('../config/db');
const config = require('../config');
const CandidateModel = require('../models/candidateModel');
const AiAssistantService = require('./aiAssistantService');
const questionSectionService = require('./questionSectionService');
const emailService = require('./emailService');
const { CANDIDATE_STATUSES, LINK_TYPES } = require('../models/candidateConstants');
const fileStorageUtil = require('../utils/fileStorageUtil');

function parseSkills(skills) {
  if (Array.isArray(skills)) return skills;
  if (typeof skills === 'string') {
    try {
      const p = JSON.parse(skills);
      return Array.isArray(p) ? p : [];
    } catch (_) {
      return [];
    }
  }
  return [];
}

class CandidateService {
  // Create a new candidate
  static async createCandidate(candidateData) {
    try {
      const normalized = {
        ...candidateData,
        email: candidateData.email || candidateData.candidate_email,
        mobile_number: candidateData.mobile_number || candidateData.candidate_mobile_number,
        register_no: candidateData.register_no || candidateData.registration_number
      };

      // Validate required fields
      if (!normalized.email || !normalized.candidate_name || !normalized.organization_id) {
        throw new Error('Missing required fields: email, name, or organization_id');
      }

      // Check if email already exists for this organization
      const emailExists = await CandidateModel.emailExists(
        normalized.email,
        normalized.organization_id
      );

      if (emailExists) {
        throw new Error('Candidate with this email already exists in this organization');
      }

      // Create candidate
      const candidateId = await CandidateModel.createCandidate(normalized);

      // Fetch and return the created candidate
      const candidate = await CandidateModel.getCandidateById(
        candidateId,
        normalized.organization_id
      );

      return {
        success: true,
        message: 'Candidate created successfully',
        data: candidate
      };
    } catch (error) {
      throw error;
    }
  }

  // Get candidate by ID with full details (assessments from candidate_assessments if table exists; else [])
  static async getCandidateById(candidateId, organizationId) {
    const candidate = await CandidateModel.getCandidateById(candidateId, organizationId);
    if (!candidate) {
      throw new Error('Candidate not found');
    }
    let assessments = [];
    try {
      assessments = await CandidateModel.getCandidateAssessments(candidateId, organizationId) || [];
    } catch (_) {
      // candidate_assessments table may not exist (e.g. in candidates_db); return candidate without assessments
    }
    return {
      success: true,
      message: 'Candidate retrieved successfully',
      data: {
        ...candidate,
        skills: candidate.skills != null ? parseSkills(candidate.skills) : [],
        assessments: Array.isArray(assessments) ? assessments : []
      }
    };
  }

  // Get positions (stages) for a candidate – latest first, for drawer dropdown
  static async getPositionsForCandidate(candidateId, organizationId, tenantDb) {
    const positions = await CandidateModel.getPositionsForCandidate(candidateId, organizationId, tenantDb);
    return { success: true, data: positions };
  }

  /**
   * Get resume file buffer and filename for download.
   * Supports storage path: qwikhire-prod-storage/6464-0160-2190-198-79266/Resume (relativePath in DB)
   * and legacy: resume_url like /uploads/resumes/...
   */
  static async getCandidateResume(candidateId, organizationId) {
    const candidate = await CandidateModel.getCandidateById(candidateId, organizationId);
    if (!candidate) throw new Error('Candidate not found');
    const resumeUrl = candidate.resume_url;
    const resumeFilename = candidate.resume_filename || 'resume.pdf';
    if (!resumeUrl) throw new Error('Candidate does not have a resume');
    // New storage: relative path e.g. 6464-0160-2190-198-79266/Resume/20260301-120000-x.pdf
    if (resumeUrl.includes('Resume/') || resumeUrl.includes('6464-0160-2190-198-79266')) {
      const buffer = await fileStorageUtil.retrieveFileByRelativePath(resumeUrl);
      return { buffer, filename: resumeFilename };
    }
    // Legacy: /uploads/resumes/<multer-filename>
    const fs = require('fs').promises;
    const path = require('path');
    const legacyPath = path.join(process.cwd(), resumeUrl.replace(/^\//, ''));
    await fs.access(legacyPath);
    const buffer = await fs.readFile(legacyPath);
    return { buffer, filename: resumeFilename };
  }

  // Get all candidates with advanced filters and pagination
  static async getAllCandidates(filters) {
    try {
      const result = await CandidateModel.getAllCandidates(filters);

      return {
        success: true,
        message: 'Candidates retrieved successfully',
        data: result.data,
        pagination: result.pagination
      };
    } catch (error) {
      throw error;
    }
  }

  // Get students (college_candidates) for organization - for Students page (college admin)
  static async getStudents(filters) {
    const result = await CandidateModel.getAllCandidates(filters);
    return {
      success: true,
      message: 'Students retrieved successfully',
      data: result.data,
      pagination: result.pagination
    };
  }

  // Get student counts by status (All, Pending, Active, Inactive)
  static async getStudentCounts(organizationId) {
    const counts = await CandidateModel.getStudentCounts(organizationId);
    return { success: true, data: counts };
  }

  // Format value to reference CandidatePositionDTO shape (UUIDs with dashes, ISO dates)
  static toCandidatePositionDTO(row) {
    const toUuid = (v) => {
      if (v == null) return null;
      const s = Buffer.isBuffer(v) ? v.toString('hex') : String(v);
      const hex = s.replace(/-/g, '').toLowerCase();
      if (hex.length === 32) return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
      return s;
    };
    const toIso = (v) => {
      if (v == null) return null;
      if (v instanceof Date) return v.toISOString().slice(0, 19).replace('Z', '');
      const d = new Date(v);
      return isNaN(d.getTime()) ? v : d.toISOString().slice(0, 19).replace('Z', '');
    };
    return {
      candidateId: toUuid(row.candidateId) ?? row.candidate_id ?? null,
      candidateCode: row.candidateCode ?? row.candidate_code ?? null,
      candidateName: row.candidateName ?? row.candidate_name ?? null,
      candidateEmail: row.candidateEmail ?? row.candidate_email ?? null,
      candidateMobileNumber: row.candidateMobileNumber ?? row.candidate_mobile_number ?? null,
      candidateCreatedAt: toIso(row.candidateCreatedAt ?? row.candidate_created_at),
      resumeFilename: row.resumeFilename ?? row.resume_filename ?? null,
      resumeStoragePath: row.resumeStoragePath ?? row.resume_storage_path ?? null,
      candidateCreatedBy: toUuid(row.candidateCreatedBy ?? row.candidate_created_by) ?? null,
      positionCandidateId: toUuid(row.positionCandidateId ?? row.position_candidate_id) ?? null,
      resumeMatchScore: row.resumeMatchScore != null ? Number(row.resumeMatchScore) : (row.resume_match_score != null ? Number(row.resume_match_score) : null),
      linkActiveAt: toIso(row.linkActiveAt ?? row.link_active_at),
      linkExpiresAt: toIso(row.linkExpiresAt ?? row.link_expires_at),
      interviewCompletedAt: toIso(row.interviewCompletedAt ?? row.interview_completed_at),
      recommendationStatus: row.recommendationStatus ?? row.recommendation_status ?? row.status ?? null,
      questionSetId: toUuid(row.questionSetId ?? row.question_set_id) ?? null,
      questionSetDuration: row.questionSetDuration ?? row.question_set_duration ?? null,
      questionSetCode: row.questionSetCode ?? row.question_set_code ?? null,
      questionSetTitle: row.questionSetTitle ?? row.question_set_title ?? row.questionSetCode ?? row.question_set_code ?? null,
      positionId: toUuid(row.positionId ?? row.position_id) ?? null,
      positionCode: row.positionCode ?? row.position_code ?? null,
      positionTitle: row.positionTitle ?? row.position_title ?? row.jobTitle ?? row.job_title ?? null,
      domainType: row.domainType ?? row.domain_type ?? null,
      minimumExperience: row.minimumExperience != null ? Number(row.minimumExperience) : (row.minimum_experience != null ? Number(row.minimum_experience) : null),
      maximumExperience: row.maximumExperience != null ? Number(row.maximumExperience) : (row.maximum_experience != null ? Number(row.maximum_experience) : null)
    };
  }

  // Get all linked candidates with positions and question sets
  static async getAllLinkedCandidates(filters, tenantDb) {
    try {
      const result = await CandidateModel.getAllLinkedCandidates(filters, tenantDb);
      const content = (result.data || []).map((row) => CandidateService.toCandidatePositionDTO(row));

      return {
        success: true,
        message: 'Linked candidates retrieved successfully',
        content,
        page: result.pagination.page,
        size: result.pagination.pageSize,
        totalElements: result.pagination.total,
        totalPages: result.pagination.totalPages,
        last: !result.pagination.hasNextPage
      };
    } catch (error) {
      throw error;
    }
  }

  // Get candidate-position link counts by status (not college_candidates count)
  static async getCandidateStatusCounts(filters, tenantDb) {
    try {
      const counts = await CandidateModel.getStatusCounts(filters, tenantDb);
      return {
        success: true,
        message: 'Candidate status counts retrieved successfully',
        data: counts
      };
    } catch (error) {
      throw error;
    }
  }

  // Update candidate details
  static async updateCandidate(candidateId, organizationId, updateData) {
    try {
      const normalizedUpdate = {
        ...updateData,
        email: updateData.email || updateData.candidate_email,
        mobile_number: updateData.mobile_number || updateData.candidate_mobile_number,
        register_no: updateData.register_no || updateData.registration_number
      };

      // Check if candidate exists
      const candidate = await CandidateModel.getCandidateById(candidateId, organizationId);
      if (!candidate) {
        throw new Error('Candidate not found');
      }

      // If email is being updated, check for duplicate
      if (normalizedUpdate.email && normalizedUpdate.email !== candidate.email) {
        const emailExists = await CandidateModel.emailExists(
          normalizedUpdate.email,
          organizationId
        );
        if (emailExists) {
          throw new Error('Email already exists for another candidate');
        }
      }

      // Update candidate
      const updated = await CandidateModel.updateCandidate(candidateId, organizationId, normalizedUpdate);

      if (!updated) {
        throw new Error('Failed to update candidate');
      }

      // Fetch updated candidate
      const updatedCandidate = await CandidateModel.getCandidateById(candidateId, organizationId);

      return {
        success: true,
        message: 'Candidate updated successfully',
        data: updatedCandidate
      };
    } catch (error) {
      throw error;
    }
  }

  // Update internal notes
  static async updateInternalNotes(candidateId, organizationId, notes, notesBy) {
    try {
      const candidate = await CandidateModel.getCandidateById(candidateId, organizationId);
      if (!candidate) {
        throw new Error('Candidate not found');
      }

      const updated = await CandidateModel.updateInternalNotes(
        candidateId,
        organizationId,
        notes,
        notesBy
      );

      if (!updated) {
        throw new Error('Failed to update internal notes');
      }

      const updatedCandidate = await CandidateModel.getCandidateById(candidateId, organizationId);

      return {
        success: true,
        message: 'Internal notes updated successfully',
        data: updatedCandidate
      };
    } catch (error) {
      throw error;
    }
  }

  // Update candidate status
  static async updateCandidateStatus(candidateId, organizationId, newStatus, changedBy, remarks) {
    try {
      // Validate status
      const validStatuses = Object.values(CANDIDATE_STATUSES);
      if (!validStatuses.includes(newStatus)) {
        throw new Error(`Invalid status. Valid statuses are: ${validStatuses.join(', ')}`);
      }

      // Check if candidate exists
      const candidate = await CandidateModel.getCandidateById(candidateId, organizationId);
      if (!candidate) {
        throw new Error('Candidate not found');
      }

      // Update status
      const updated = await CandidateModel.updateCandidateStatus(
        candidateId,
        organizationId,
        newStatus,
        changedBy,
        remarks
      );

      if (!updated) {
        throw new Error('Failed to update candidate status');
      }

      // Fetch updated candidate
      const updatedCandidate = await CandidateModel.getCandidateById(candidateId, organizationId);

      return {
        success: true,
        message: 'Candidate status updated successfully',
        data: updatedCandidate
      };
    } catch (error) {
      throw error;
    }
  }

  // Delete candidate
  static async deleteCandidate(candidateId, organizationId) {
    try {
      const candidate = await CandidateModel.getCandidateById(candidateId, organizationId);
      if (!candidate) {
        throw new Error('Candidate not found');
      }

      const deleted = await CandidateModel.deleteCandidate(candidateId, organizationId);

      if (!deleted) {
        throw new Error('Failed to delete candidate');
      }

      return {
        success: true,
        message: 'Candidate deleted successfully',
        data: { candidateId }
      };
    } catch (error) {
      throw error;
    }
  }

  // Create private/public link for candidate
  static async createCandidateLink(candidateId, organizationId, positionId, linkType, createdBy) {
    try {
      // Validate link type
      if (!Object.values(LINK_TYPES).includes(linkType)) {
        throw new Error(`Invalid link type. Valid types are: ${Object.values(LINK_TYPES).join(', ')}`);
      }

      // Check if candidate exists
      const candidate = await CandidateModel.getCandidateById(candidateId, organizationId);
      if (!candidate) {
        throw new Error('Candidate not found');
      }

      // Generate link URL (this would be customized based on your frontend)
      const linkUrl = `${process.env.CANDIDATE_LINK_BASE_URL}/assessment/${candidateId}`;

      const linkData = {
        candidate_id: candidateId,
        organization_id: organizationId,
        position_id: positionId,
        link_type: linkType,
        link_url: linkUrl,
        created_by: createdBy
      };

      const { linkId, linkToken } = await CandidateModel.createCandidateLink(linkData);

      return {
        success: true,
        message: `${linkType} link created successfully`,
        data: {
          linkId,
          linkToken,
          linkUrl: linkUrl + '?token=' + linkToken,
          linkType
        }
      };
    } catch (error) {
      throw error;
    }
  }

  // Get assessments for candidate
  static async getCandidateAssessments(candidateId, organizationId) {
    try {
      const candidate = await CandidateModel.getCandidateById(candidateId, organizationId);
      if (!candidate) {
        throw new Error('Candidate not found');
      }

      const assessments = await CandidateModel.getCandidateAssessments(candidateId, organizationId);

      return {
        success: true,
        message: 'Assessments retrieved successfully',
        data: assessments
      };
    } catch (error) {
      throw error;
    }
  }

  // Create assessment record for candidate
  static async createAssessment(candidateId, organizationId, assessmentData) {
    try {
      const candidate = await CandidateModel.getCandidateById(candidateId, organizationId);
      if (!candidate) {
        throw new Error('Candidate not found');
      }

      const fullAssessmentData = {
        candidate_id: candidateId,
        organization_id: organizationId,
        ...assessmentData
      };

      const assessmentId = await CandidateModel.createAssessment(fullAssessmentData);

      return {
        success: true,
        message: 'Assessment created successfully',
        data: { assessmentId }
      };
    } catch (error) {
      throw error;
    }
  }

  // Map candidate to position
  static async mapCandidateToPosition(candidateId, organizationId, positionData, tenantDb) {
    try {
      const candidate = await CandidateModel.getCandidateById(candidateId, organizationId);
      if (!candidate) {
        throw new Error('Candidate not found');
      }

      const fullPositionData = {
        candidate_id: candidateId,
        organization_id: organizationId,
        candidate_code: candidate.candidate_code,
        candidate_name: candidate.candidate_name,
        ...positionData
      };

      const positionCandidateId = await CandidateModel.createCandidatePosition(fullPositionData, tenantDb);

      return {
        success: true,
        message: 'Candidate mapped to position successfully',
        data: { positionCandidateId }
      };
    } catch (error) {
      throw error;
    }
  }

  // Get candidates for a position
  static async getCandidatesForPosition(positionId, organizationId, tenantDb) {
    try {
      const candidates = await CandidateModel.getCandidatesForPosition(positionId, organizationId, tenantDb);

      return {
        success: true,
        message: 'Position candidates retrieved successfully',
        data: candidates
      };
    } catch (error) {
      throw error;
    }
  }

  // Bulk update candidate status
  static async bulkUpdateCandidateStatus(candidateIds, organizationId, newStatus) {
    try {
      const validStatuses = Object.values(CANDIDATE_STATUSES);
      if (!validStatuses.includes(newStatus)) {
        throw new Error(`Invalid status. Valid statuses are: ${validStatuses.join(', ')}`);
      }

      const results = [];

      for (const candidateId of candidateIds) {
        try {
          const updated = await CandidateModel.updateCandidateStatus(
            candidateId,
            organizationId,
            newStatus
          );
          results.push({
            candidateId,
            success: updated,
            status: newStatus
          });
        } catch (error) {
          results.push({
            candidateId,
            success: false,
            error: error.message
          });
        }
      }

      return {
        success: true,
        message: 'Bulk status update completed',
        data: results
      };
    } catch (error) {
      throw error;
    }
  }

  // Backward-compatible: Get candidates assigned to a specific position (legacy table)
  static async getCandidatesByPosition(tenantDb, positionId, limit = 5, offset = 0, userId = null) {
    let resolvedTenantDb = tenantDb;

    if (!resolvedTenantDb || resolvedTenantDb === 'auth_db' || resolvedTenantDb === 'superadmin_db') {
      if (userId) {
        const userRows = await db.query(
          'SELECT client FROM auth_db.users WHERE id = ? AND is_active = true LIMIT 1',
          [userId]
        );
        if (userRows.length > 0 && userRows[0].client) {
          resolvedTenantDb = userRows[0].client;
        }
      }
    }

    if (!resolvedTenantDb || resolvedTenantDb === 'auth_db') {
      throw new Error('Could not resolve tenant database for candidates retrieval');
    }

    const positionIdHex = positionId.replace(/-/g, '');

    const tableCheck = await db.query(
      `SELECT TABLE_NAME FROM INFORMATION_SCHEMA.TABLES 
       WHERE TABLE_SCHEMA = ? AND TABLE_NAME IN ('candidate_positions', 'position_candidates', 'job_candidates')`,
      [resolvedTenantDb]
    );

    const existingTables = tableCheck.map(t => t.TABLE_NAME);

    if (existingTables.includes('candidate_positions')) {
      const countQuery = `SELECT COUNT(*) as total FROM \`${resolvedTenantDb}\`.candidate_positions WHERE position_id = ?`;
      const countResult = await db.query(countQuery, [positionId]);
      const totalElements = countResult[0]?.total || 0;

      const selectQuery = `
        SELECT 
          cp.position_candidate_id as id,
          cp.candidate_id,
          cp.candidate_name as name,
          c.email as email,
          cp.candidate_code as code,
          cp.status as status,
          cp.invited_date as assignedAt
        FROM \`${resolvedTenantDb}\`.candidate_positions cp
        LEFT JOIN candidates_db.college_candidates c ON c.candidate_id = cp.candidate_id
        WHERE cp.position_id = ?
        ORDER BY cp.created_at DESC
        LIMIT ? OFFSET ?
      `;

      const candidates = await db.query(selectQuery, [
        positionId,
        parseInt(limit),
        parseInt(offset)
      ]);

      return {
        content: candidates,
        totalElements
      };
    }

    let tableName = 'position_candidates';
    let fkColumn = 'position_id';

    if (existingTables.includes('position_candidates')) {
      tableName = 'position_candidates';
      fkColumn = 'position_id';
    } else if (existingTables.includes('job_candidates')) {
      tableName = 'job_candidates';
      fkColumn = 'job_id';
    } else {
      return { content: [], totalElements: 0 };
    }

    const countQuery = `SELECT COUNT(*) as total FROM \`${resolvedTenantDb}\`.\`${tableName}\` WHERE \`${fkColumn}\` = UNHEX(?)`;
    const countResult = await db.query(countQuery, [positionIdHex]);
    const totalElements = countResult[0]?.total || 0;

    const selectQuery = `
      SELECT 
        BIN_TO_UUID(c.id) as id,
        c.name,
        c.email,
        c.code,
        pc.recommendation as status,
        pc.created_at as assignedAt
      FROM \`${resolvedTenantDb}\`.\`${tableName}\` pc
      JOIN \`${resolvedTenantDb}\`.candidates c ON pc.candidate_id = c.id
      WHERE pc.\`${fkColumn}\` = UNHEX(?)
      ORDER BY pc.created_at DESC
      LIMIT ? OFFSET ?
    `;

    const candidates = await db.query(selectQuery, [
      positionIdHex,
      parseInt(limit),
      parseInt(offset)
    ]);

    return {
      content: candidates,
      totalElements
    };
  }

  static async createCandidateWithPrivateLink(data, file, user, tenantDb, candidateFile) {
    try {
      const { v4: uuidv4 } = require('uuid');
      const fs = require('fs').promises;
      const path = require('path');

      // 0. Resolve data source (may be a JSON string in body OR a file/blob in multipart)
      let finalData = data;

      // Check if candidate data is in a separate file part (common when sent as Blob from frontend)
      if (candidateFile && candidateFile.path) {
        try {
          const fileContent = await fs.readFile(candidateFile.path, 'utf8');
          console.log('DEBUG: candidateFile content:', fileContent);
          finalData = JSON.parse(fileContent);
          // Delete temp candidate file after parsing
          await fs.unlink(candidateFile.path).catch(err => console.warn('Failed to delete temp candidate blob:', err));
        } catch (e) {
          console.error('Failed to parse candidate JSON from file part:', e);
        }
      }
      // Fallback 1: check if it's sent as a JSON string in text field
      else if (data.candidate && typeof data.candidate === 'string') {
        try {
          finalData = JSON.parse(data.candidate);
        } catch (e) {
          console.error('Failed to parse candidate JSON string from body:', e);
        }
      }
      // Fallback 2: check if it's already an object (sometimes happens if parsed by other middleware)
      else if (data.candidate && typeof data.candidate === 'object') {
        finalData = data.candidate;
      }

      console.log('DEBUG: finalData after extraction:', JSON.stringify(finalData, null, 2));

      // 1. Initial extraction of fields from finalData
      const organizationId = finalData.organization_id || finalData.organizationId;
      const candidateName = finalData.candidate_name || finalData.name;
      const candidateEmail = finalData.candidate_email || finalData.email;
      const mobileNumber = finalData.mobile_number || finalData.mobileNumber;
      const positionId = finalData.position_id || finalData.positionId;
      const positionName = finalData.position_name || finalData.positionName;
      const questionSetId = finalData.question_set_id || finalData.questionSetId;
      const linkValidityDays = finalData.link_validity_days || 7;
      const userId = user?.userId || user?.user_id || user?.id;

      // Upload resume file to qwikhire-prod-storage/6464-0160-2190-198-79266/Resume
      let resumeUrl = null;
      let resumeFilename = null;
      if (file) {
        resumeFilename = file.originalname;
        const { relativePath } = await fileStorageUtil.storeFile('Resume', file);
        resumeUrl = relativePath;
      }

      // Fetch question set details for duration
      let questionSetDuration = "00:00";
      if (questionSetId && tenantDb) {
        try {
          const [qsetData] = await db.query(
            `SELECT total_duration FROM \`${tenantDb}\`.question_sets WHERE id = UNHEX(?) OR id = ?`,
            [questionSetId.toString().replace(/-/g, ''), questionSetId]
          );
          if (qsetData) {
            questionSetDuration = qsetData.total_duration || "00:00";
          }
        } catch (err) {
          console.warn('Warning: Failed to fetch question set duration:', err.message);
        }
      }

      // STEP 1: Handle candidate identity (Create or Reuse)
      let candidateId = null;
      let resolvedCandidate = null;

      try {
        resolvedCandidate = await CandidateModel.getCandidateByEmail(candidateEmail, organizationId);
      } catch (err) {
        console.warn('Error checking for existing candidate:', err.message);
      }

      if (resolvedCandidate) {
        candidateId = resolvedCandidate.candidate_id;
        console.log(`DEBUG: Reusing existing candidate ${candidateId} for email ${candidateEmail}`);

        // Optionally update candidate details? Let's keep it simple for now as per user request
        // "if the candidate hase alredy there then u should not create again a new candidate"
      } else {
        candidateId = uuidv4();
        const candidateData = {
          candidate_id: candidateId,
          organization_id: organizationId,
          candidate_name: candidateName,
          email: candidateEmail,
          mobile_number: mobileNumber,
          resume_filename: resumeFilename,
          resume_url: resumeUrl,
          status: 'Invited',
          candidate_created_by: userId,
          candidate_created_at: new Date()
        };

        await CandidateModel.createCandidate(candidateData);
        // Fetch to get the auto-generated candidate_code
        resolvedCandidate = await CandidateModel.getCandidateById(candidateId, organizationId);
        console.log(`DEBUG: Created new candidate ${candidateId} for email ${candidateEmail}`);
      }

      // STEP 2: Create private link or reuse existing (when status is Invited and candidate already in private link)
      const linkActiveAt = new Date();
      const linkExpiresAt = new Date(Date.now() + (linkValidityDays || 7) * 24 * 60 * 60 * 1000);

      let linkId;
      let verificationCode;
      const existingLink = await CandidateModel.getExistingPrivateLinkByCandidateAndPosition(candidateId, positionId, 'candidates_db');
      if (existingLink && existingLink.linkId && existingLink.verificationCode) {
        linkId = existingLink.linkId;
        verificationCode = existingLink.verificationCode;
        console.log(`DEBUG: Reusing existing private link for candidate ${candidateId}, position ${positionId}; same OTP sent.`);
      } else {
        const linkData = {
          link_type: 'PRIVATE',
          candidate_id: candidateId,
          candidate_name: candidateName,
          client_id: organizationId,
          company_name: finalData.company_name || finalData.companyName || 'College',
          email: candidateEmail,
          position_id: positionId,
          position_name: positionName,
          question_set_id: questionSetId,
          interview_platform: finalData.interview_platform || finalData.interviewPlatform || 'BROWSER',
          link_active_at: linkActiveAt,
          link_expires_at: linkExpiresAt,
          created_by: userId
        };
        const created = await CandidateModel.createCandidateLink(linkData);
        linkId = created.linkId;
        verificationCode = created.verificationCode;
      }

      // STEP 2b: Send test invite email via Zepto (config from Superadmin GET /superadmin/settings/email)
      const testPortalUrl = (config.candidateTestPortalUrl || process.env.CANDIDATE_TEST_PORTAL_URL || process.env.CANDIDATE_LINK_BASE_URL || '').trim() || 'your test portal';
      const inviteSubject = `You're invited to take the assessment – ${finalData.position_name || positionName || 'Assessment'}`;
      const inviteBody = `<p>Hi ${candidateName},</p><p>You have been invited to take an assessment for the position: <strong>${finalData.position_name || positionName || 'Assessment'}</strong> at ${finalData.company_name || finalData.companyName || 'our organization'}.</p><p>Your verification code is: <strong>${verificationCode}</strong></p><p>Take your test at: <a href="${testPortalUrl}">${testPortalUrl}</a></p><p>Enter your email and this verification code to start. The link is valid until ${linkExpiresAt.toISOString ? linkExpiresAt.toISOString().slice(0, 10) : linkExpiresAt}.</p>`;
      const inviteResult = await emailService.sendEmail(candidateEmail, inviteSubject, inviteBody);
      if (!inviteResult.sent) {
        console.warn('[CandidateService] Test invite email not sent:', inviteResult.error);
      }

      // STEP 3: Create candidate-position relationship (Position mapping)
      let positionCandidateObj = null;
      if (positionId && organizationId && tenantDb) {
        try {
          const positionMappingData = {
            candidate_id: candidateId,
            position_id: positionId,
            organization_id: organizationId,
            candidate_name: candidateName,
            job_title: positionName,
            question_set_id: questionSetId,
            link_active_at: linkActiveAt,
            link_expires_at: linkExpiresAt,
            invited_date: linkActiveAt,
            status: 'Invited',
            recommendation_status: 'PENDING',
            workflow_stage: 'Initial Review',
            created_by: userId
          };

          positionCandidateObj = await CandidateModel.createCandidatePosition(positionMappingData, tenantDb);
        } catch (posError) {
          console.warn('Warning: Failed to create candidate-position mapping:', posError.message);
        }
      }

      // STEP 4: (candidate_applied not used — candidate/position stored in position_candidates or candidate_positions only)

      // STEP 5: Create assessment summary record (with round given times from question section)
      let assessmentSummaryObj = null;
      if (candidateId && positionId && questionSetId) {
        try {
          let roundTimes = { round1GivenTime: null, round2GivenTime: null, round3GivenTime: null, round4GivenTime: null };
          if (tenantDb) {
            try {
              roundTimes = await questionSectionService.getRoundGivenTimesForQuestionSet(tenantDb, questionSetId, userId);
            } catch (rtErr) {
              console.warn('Warning: Could not fetch round given times from question section:', rtErr.message);
            }
          }
          const summaryData = {
            candidateId,
            positionId,
            questionId: questionSetId,
            totalInterviewTime: questionSetDuration,
            totalRoundsAssigned: 4,
            isAssessmentCompleted: false,
            isReportGenerated: false,
            round1Assigned: true,
            round2Assigned: true,
            round3Assigned: true,
            round4Assigned: true,
            ...roundTimes
          };

          assessmentSummaryObj = await CandidateModel.createAssessmentSummary(summaryData);
        } catch (summError) {
          console.warn('Warning: Failed to create assessment summary:', summError.message);
        }
      }

      // STEP 6: Schedule interview using AI assistant
      try {
        const scheduleData = {
          candidateId,
          email: candidateEmail,
          positionId,
          questionSetId,
          clientId: tenantDb,
          interviewPlatform: finalData.interview_platform || 'BROWSER',
          linkActiveAt,
          linkExpiresAt,
          createdBy: userId,
          sendInviteBy: 'EMAIL',
          candidateName,
          companyName: finalData.company_name || 'College',
          organizationId,
          positionName
        };
        await AiAssistantService.scheduleInterview(scheduleData);
      } catch (schedError) {
        console.warn('Warning: Failed to schedule interview via AI assistant:', schedError.message);
      }

      return {
        success: true,
        message: 'Candidate added and interview scheduled successfully',
        data: {
          id: candidateId,
          candidate_id: candidateId,
          link_id: linkId,
          verification_code: verificationCode,
          position_candidate_id: positionCandidateObj?.positionCandidateId || positionCandidateObj?.id || null,
          positionCandidate: positionCandidateObj,
          assessmentSummary: assessmentSummaryObj,
          candidate: {
            id: candidateId,
            name: candidateName,
            email: candidateEmail,
            mobileNumber: mobileNumber,
            resumeFilename: resumeFilename,
            resumeUrl: resumeUrl
          }
        }
      };
    } catch (error) {
      console.error('Error creating candidate with link:', error);
      throw error;
    }
  }

  // Get candidate by email
  static async getCandidateByEmail(email, organizationId) {
    try {
      const candidate = await CandidateModel.getCandidateByEmail(email, organizationId);
      return {
        success: true,
        message: candidate ? 'Candidate found' : 'Candidate not found',
        data: candidate || null
      };
    } catch (error) {
      console.error('Error in getCandidateByEmail:', error);
      throw error;
    }
  }

  /**
   * Check if WhatsApp is available. When candidateId is provided and the number belongs to that candidate (add exam for existing), treat as available.
   */
  static async checkWhatsAppAvailability(mobileNumber, organizationId, candidateId = null) {
    try {
      const isAvailable = await CandidateModel.checkWhatsAppAvailability(mobileNumber, organizationId, 'candidates_db', candidateId);
      return {
        success: true,
        message: isAvailable ? 'WhatsApp number available' : 'WhatsApp number already in use',
        available: isAvailable
      };
    } catch (error) {
      console.error('Error in checkWhatsAppAvailability:', error);
      throw error;
    }
  }

  // Generate public link
  static async generatePublicLink(data, user) {
    try {
      const { v4: uuidv4 } = require('uuid');
      const FRONTEND_URL = process.env.FRONTEND_URL;

      // 1. Determine the correct tenant database (tenant_id)
      console.log('DEBUG: generatePublicLink data:', JSON.stringify(data));
      console.log('DEBUG: generatePublicLink user:', JSON.stringify(user));

      let tenantId = data.tenant_id || user?.client || user?.tenantDb;
      console.log('DEBUG: Initial tenantId resolution:', tenantId);

      if (!tenantId && user?.organizationId) {
        console.log('DEBUG: Starting tenant scan for organization:', user.organizationId);
        const orgClients = await db.query(
          `SELECT DISTINCT client FROM auth_db.users WHERE organization_id = ? AND client IS NOT NULL`,
          [user.organizationId]
        );
        console.log('DEBUG: Potential tenant DBs for scan:', orgClients.map(c => c.client));

        for (const row of orgClients) {
          const dbName = row.client;
          try {
            // Check positions table (College/Admin)
            try {
              const posRows = await db.query(
                `SELECT id FROM \`${dbName}\`.positions WHERE id = UNHEX(?) LIMIT 1`,
                [data.position_id.replace(/-/g, '')]
              );
              if (posRows && posRows.length > 0) {
                tenantId = dbName;
                console.log(`DEBUG: Found position in ${dbName}.positions`);
                break;
              }
            } catch (e) { /* ignore if table doesn't exist */ }

            // Check jobs table (ATS)
            if (!tenantId) {
              try {
                const jobRows = await db.query(
                  `SELECT id FROM \`${dbName}\`.jobs WHERE id = UNHEX(?) LIMIT 1`,
                  [data.position_id.replace(/-/g, '')]
                );
                if (jobRows && jobRows.length > 0) {
                  tenantId = dbName;
                  console.log(`DEBUG: Found position in ${dbName}.jobs`);
                  break;
                }
              } catch (e) { /* ignore if table doesn't exist */ }
            }
          } catch (e) {
            continue;
          }
        }
      }

      if (!tenantId) {
        console.error('DEBUG: Resolution failed. tenantId is null.');
        throw new Error('Could not resolve tenant database for this position');
      }
      console.log('DEBUG: Final resolved tenantId:', tenantId);

      // 2. Check if a link already exists for this position, question set, AND tenant
      const existingLink = await CandidateModel.getExistingPublicLink(
        user?.organizationId || data.organization_id,
        data.position_id,
        data.question_set_id,
        tenantId
      );

      if (existingLink && new Date(existingLink.expire_at) > new Date()) {
        const shortCode = this.extractShortCodeFromLink(existingLink.link);
        const reconstructedLink = shortCode ? `${FRONTEND_URL}/register/${shortCode}` : existingLink.link;
        return {
          success: true,
          message: 'Public link retrieved successfully',
          data: {
            public_link: reconstructedLink,
            link_id: shortCode || existingLink.link_id,
            expires_at: existingLink.expire_at
          }
        };
      }

      // 3. Generate new link
      const linkId = uuidv4();
      const shortCode = this.generateShortCodeFromUUID(linkId);

      const linkData = {
        link_id: linkId,
        link_type: 'PUBLIC',
        client_id: user?.organizationId || data.organization_id,
        tenant_id: tenantId, // Explicitly store the DB name
        position_id: data.position_id,
        question_set_id: data.question_set_id,
        short_code: shortCode,
        link: `${FRONTEND_URL}/register/${shortCode}`,
        active_at: data.link_start_datetime ? new Date(data.link_start_datetime) : new Date(),
        expire_at: data.link_end_datetime ? new Date(data.link_end_datetime) : new Date(Date.now() + (data.link_validity_days || 7) * 24 * 60 * 60 * 1000),
        created_by: user?.id || null
      };

      await CandidateModel.createCandidateLink(linkData);

      return {
        success: true,
        message: 'Public link generated successfully',
        data: {
          public_link: linkData.link,
          link_id: shortCode,
          expires_at: linkData.expire_at
        }
      };
    } catch (error) {
      console.error('Error generating public link:', error);
      throw error;
    }
  }

  // Generate short readable link code from UUID (e.g., "ASS-ABC123DEF456")
  static generateShortCodeFromUUID(uuid) {
    if (!uuid) return 'ASS-' + Math.random().toString(36).substring(2, 14).toUpperCase();

    // Take 12 chars from UUID (removing hyphens) and convert to uppercase
    const cleanUUID = uuid.replace(/-/g, '');
    const shortPart = cleanUUID.substring(0, 12).toUpperCase();
    return `ASS-${shortPart}`;
  }

  // Normalize UUID values that might be stored as BINARY(16)
  static normalizeUuid(value) {
    if (!value) return null;
    if (Buffer.isBuffer(value)) {
      const hex = value.toString('hex');
      return this.hexToUuid(hex);
    }
    return value;
  }

  // Convert hex string to UUID format
  static hexToUuid(hex) {
    if (!hex || hex.length !== 32) return null;
    return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
  }

  // Extract short code from a stored link URL
  static extractShortCodeFromLink(link) {
    if (!link || typeof link !== 'string') return null;
    const parts = link.split('/');
    return parts.length > 0 ? parts[parts.length - 1] : null;
  }

  // Generate short readable link code (e.g., ASS-ABC123DEF456)
  static generateShortLinkCode() {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
    let code = 'ASS-'; // Assessment prefix

    // Generate 12 character code
    for (let i = 0; i < 12; i++) {
      code += chars.charAt(Math.floor(Math.random() * chars.length));
    }

    return code;
  }

  // Get public link details
  static async getPublicLinkDetails(shortCode) {
    try {
      if (!shortCode) throw new Error('Short code is required');

      const link = await CandidateModel.getLinkByShortCode(shortCode);

      if (!link) {
        throw new Error('Invalid or expired public link');
      }

      // Check if link is still valid
      if (link.expire_at && new Date(link.expire_at) < new Date()) {
        throw new Error('This link has expired');
      }

      // 1. Resolve Admin identity and tenant DB
      // Use stored tenant_id directly if available to ensure correct DB is hit
      const tenantDb = link.tenant_id;
      let roleCode = 'COLLEGE';
      let organizationId = link.client_id;
      let userRows = [];

      if (tenantDb) {
        // Find organization info from tenant DB name
        userRows = await db.query(
          `SELECT u.organization_id, r.code as roleCode
           FROM auth_db.users u 
           LEFT JOIN auth_db.roles r ON u.role_id = r.id 
           WHERE u.client = ? AND u.is_active = true LIMIT 1`,
          [tenantDb]
        );
      } else {
        // Fallback for older links without tenant_id
        const createdByHex = link.created_by ? (Buffer.isBuffer(link.created_by) ? link.created_by.toString('hex') : link.created_by) : null;
        if (createdByHex) {
          userRows = await db.query(
            `SELECT u.client as tenantDb, r.code as roleCode, u.organization_id
             FROM auth_db.users u 
             LEFT JOIN auth_db.roles r ON u.role_id = r.id 
             WHERE REPLACE(u.id, '-', '') = ? AND u.is_active = true LIMIT 1`,
            [createdByHex]
          );
        }
        if (!userRows || userRows.length === 0) {
          userRows = await db.query(
            `SELECT u.client as tenantDb, r.code as roleCode, u.organization_id
             FROM auth_db.users u 
             LEFT JOIN auth_db.roles r ON u.role_id = r.id 
             WHERE u.organization_id = ? AND u.is_active = true LIMIT 1`,
            [link.client_id]
          );
        }
      }

      if ((!tenantDb && (!userRows || userRows.length === 0)) || (tenantDb && userRows.length === 0)) {
        throw new Error('Organization details not found or inactive');
      }

      const activeTenantDb = tenantDb || userRows[0].tenantDb;
      const activeRoleCode = userRows[0].roleCode;
      const activeOrgId = userRows[0].organization_id || link.client_id;
      const isATS = activeRoleCode === 'ATS';

      // Normalize IDs
      const positionIdClean = link.position_id ? (Buffer.isBuffer(link.position_id) ? link.position_id.toString('hex') : link.position_id.toString().replace(/-/g, '')) : null;
      const questionSetIdClean = link.question_set_id ? (Buffer.isBuffer(link.question_set_id) ? link.question_set_id.toString('hex') : link.question_set_id.toString().replace(/-/g, '')) : null;

      let positionName = '';
      let questionSetName = '';

      // 2. Resolve proper Title and Question Set Name from tenant database
      if (positionIdClean && activeTenantDb) {
        try {
          if (isATS) {
            const rows = await db.query(`SELECT job_title FROM \`${activeTenantDb}\`.jobs WHERE HEX(id) = ? LIMIT 1`, [positionIdClean]);
            if (rows.length > 0) {
              positionName = rows[0].job_title;
            }
          } else {
            const rows = await db.query(`SELECT title FROM \`${activeTenantDb}\`.positions WHERE HEX(id) = ? LIMIT 1`, [positionIdClean]);
            if (rows.length > 0) {
              positionName = rows[0].title;
            }
          }
        } catch (err) {
          console.warn('Error fetching position name from tenant DB:', err.message);
        }
      }

      if (questionSetIdClean && activeTenantDb) {
        try {
          // Try name first then question_set_code as fallback
          const rows = await db.query(`SELECT * FROM \`${activeTenantDb}\`.question_sets WHERE HEX(id) = ? LIMIT 1`, [questionSetIdClean]);
          if (rows.length > 0) {
            questionSetName = rows[0].name || rows[0].question_set_code || '';
          }
        } catch (err) {
          console.warn('Error fetching question set name from tenant DB:', err.message);
        }
      }

      const createdByHexFinal = link.created_by ? (Buffer.isBuffer(link.created_by) ? link.created_by.toString('hex') : link.created_by) : null;

      return {
        success: true,
        data: {
          org_id: activeOrgId,
          user_id: createdByHexFinal,
          tenant_id: activeTenantDb,
          organization_name: activeOrgId, // Use Org ID as display name per request
          position_id: positionIdClean,
          question_set_id: questionSetIdClean,
          position_name: positionName,
          question_set_name: questionSetName,
          link_created: link.created_at,
          expire_at: link.expire_at
        }
      };
    } catch (error) {
      throw error;
    }
  }

  // Public registration
  static async publicRegistration(data, file) {
    try {
      const { v4: uuidv4 } = require('uuid');

      // Upload resume file to qwikhire-prod-storage/6464-0160-2190-198-79266/Resume
      let resumeUrl = null;
      let resumeFilename = null;
      if (file) {
        resumeFilename = file.originalname;
        const { relativePath } = await fileStorageUtil.storeFile('Resume', file);
        resumeUrl = relativePath;
      }

      // Create candidate in college_candidates table
      const candidateId = uuidv4();
      const candidateData = {
        candidate_id: candidateId,
        organization_id: data.organization_id,
        candidate_name: data.candidate_name,
        email: data.candidate_email,
        mobile_number: data.mobile_number,
        register_no: data.register_no,
        department: data.department,
        semester: data.semester,
        location: data.location,
        address: data.address,
        birthdate: data.birthdate,
        resume_filename: resumeFilename,
        resume_url: resumeUrl,
        status: 'Applied',
        candidate_created_at: new Date()
      };

      await CandidateModel.createCandidate(candidateData);

      // (candidate_applied not used — use position_candidates/candidate_positions only)

      // Create candidate-position relationship in tenant database
      try {
        const tenantDb = process.env.TENANT_DB;
        const positionData = {
          candidate_id: candidateId,
          position_id: data.position_id,
          organization_id: data.organization_id,
          candidate_name: data.candidate_name,
          question_set_id: data.question_set_id,
          status: 'Applied',
          created_by: null
        };

        await CandidateModel.createCandidatePosition(positionData, tenantDb);
      } catch (posError) {
        console.warn('Warning: Failed to create candidate-position relationship:', posError.message);
      }

      return {
        success: true,
        message: 'Registration successful! You will receive assessment details via email.',
        data: {
          candidate_id: candidateId
        }
      };
    } catch (error) {
      console.error('Error in public registration:', error);
      throw error;
    }
  }

  // Get public position details
  static async getPublicPositionDetails(positionId, organizationId) {
    try {
      const positionIdClean = positionId.replace(/-/g, '');

      // 1. Resolve all potential tenant DBs for this organization
      const orgClients = await db.query(
        `SELECT DISTINCT client FROM auth_db.users WHERE organization_id = ? AND client IS NOT NULL`,
        [organizationId]
      );

      if (orgClients.length === 0) {
        throw new Error('Organization not found or has no linked databases');
      }

      let position = null;
      let targetDb = null;
      let isAtsTable = false;

      // 2. Scan all DBs and both tables (positions, jobs)
      for (const row of orgClients) {
        const dbName = row.client;
        try {
          // Check positions table (College/Admin)
          try {
            const posQuery = `
              SELECT 
                HEX(id) as id, code, title, domain_type as domainType,
                minimum_experience as minimumExperience, maximum_experience as maximumExperience,
                no_of_positions as noOfPositions, position_status as status,
                expected_start_date as expectedStartDate, application_deadline as applicationDeadline,
                job_description_document_path as jobDescriptionDocumentPath,
                job_description_document_file_name as jobDescriptionDocumentFileName
              FROM \`${dbName}\`.positions WHERE HEX(id) = ? LIMIT 1
            `;
            const posRows = await db.query(posQuery, [positionIdClean]);
            if (posRows && posRows.length > 0) {
              position = posRows[0];
              targetDb = dbName;
              isAtsTable = false;
              break;
            }
          } catch (e) { /* table missing */ }

          // Check jobs table (ATS)
          if (!position) {
            try {
              const jobQuery = `
                SELECT 
                  HEX(id) as id, code, job_title as title, requirement_category as domainType,
                  experience_min as minimumExperience, experience_max as maximumExperience,
                  no_of_positions as noOfPositions, status as status,
                  expected_start_date as expectedStartDate, application_deadline as applicationDeadline,
                  job_description_document_path as jobDescriptionDocumentPath,
                  job_description_document_file_name as jobDescriptionDocumentFileName
                FROM \`${dbName}\`.jobs WHERE HEX(id) = ? LIMIT 1
              `;
              const jobRows = await db.query(jobQuery, [positionIdClean]);
              if (jobRows && jobRows.length > 0) {
                position = jobRows[0];
                targetDb = dbName;
                isAtsTable = true;
                break;
              }
            } catch (e) { /* table missing */ }
          }
        } catch (e) {
          continue;
        }
      }

      if (!position) {
        throw new Error('Position not found in any linked database');
      }

      // 3. Fetch skills from the correct tables based on table type
      let mandatorySkills = [];
      let optionalSkills = [];

      try {
        if (isAtsTable) {
          const mSkills = await db.query(`SELECT skill FROM \`${targetDb}\`.job_mandatory_skills WHERE job_id = UNHEX(?)`, [positionIdClean]);
          const oSkills = await db.query(`SELECT skill FROM \`${targetDb}\`.job_optional_skills WHERE job_id = UNHEX(?)`, [positionIdClean]);
          mandatorySkills = mSkills.map(s => s.skill);
          optionalSkills = oSkills.map(s => s.skill);
        } else {
          const mSkills = await db.query(`SELECT skill FROM \`${targetDb}\`.position_mandatory_skills WHERE position_id = UNHEX(?)`, [positionIdClean]);
          const oSkills = await db.query(`SELECT skill FROM \`${targetDb}\`.position_optional_skills WHERE position_id = UNHEX(?)`, [positionIdClean]);
          mandatorySkills = mSkills.map(s => s.skill);
          optionalSkills = oSkills.map(s => s.skill);
        }
      } catch (err) {
        console.warn('Error fetching skills:', err.message);
      }

      return {
        success: true,
        data: {
          ...position,
          mandatorySkills,
          optionalSkills,
          tenant_id: targetDb
        }
      };
    } catch (error) {
      console.error('Error fetching public position details:', error);
      throw error;
    }
  }
}

module.exports = CandidateService;
