/**
 * JD and Resume extract: extract keywords from PDF/DOCX and save to jd_extract / resume_extract (tenant DB).
 * One row per position for JD (upsert by position_id). One row per (candidate_id, position_id) for resume (upsert).
 */
const { v4: uuidv4 } = require('uuid');
const db = require('../config/db');
const docExtractor = require('../utils/docExtractor');

/**
 * Ensure jd_extract and resume_extract tables exist in tenant DB (run migration if needed).
 * @param {string} tenantDb
 */
async function ensureExtractTables(tenantDb) {
  await db.query(
    `CREATE TABLE IF NOT EXISTS \`${tenantDb}\`.jd_extract (
      id CHAR(36) NOT NULL PRIMARY KEY,
      position_id VARCHAR(36) NOT NULL,
      org_id VARCHAR(36) NOT NULL,
      extracted_data JSON NOT NULL,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      UNIQUE KEY uk_jd_extract_position (position_id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`
  );
  await db.query(
    `CREATE TABLE IF NOT EXISTS \`${tenantDb}\`.resume_extract (
      id CHAR(36) NOT NULL PRIMARY KEY,
      candidate_id VARCHAR(36) NOT NULL,
      position_id VARCHAR(36) NOT NULL,
      org_id VARCHAR(36) NOT NULL,
      extracted_data JSON NOT NULL,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      UNIQUE KEY uk_resume_extract_candidate_position (candidate_id, position_id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`
  );
}

/**
 * Upsert JD extract: if position_id exists update, else insert.
 * @param {string} tenantDb
 * @param {string} positionId
 * @param {string} orgId
 * @param {object} extractedData - { text, keywords } (JSON)
 */
async function upsertJdExtract(tenantDb, positionId, orgId, extractedData) {
  const dataJson = JSON.stringify(extractedData);
  const existing = await db.query(
    `SELECT id FROM \`${tenantDb}\`.jd_extract WHERE position_id = ? LIMIT 1`,
    [positionId]
  );
  if (existing && existing.length > 0) {
    await db.query(
      `UPDATE \`${tenantDb}\`.jd_extract SET org_id = ?, extracted_data = ?, updated_at = NOW() WHERE position_id = ?`,
      [orgId, dataJson, positionId]
    );
    // Also sync to positions table if text exists
    if (extractedData.text) {
      await db.query(
        // `UPDATE \`${tenantDb}\`.positions SET job_description = ?, updated_at = NOW() WHERE HEX(id) = ?`, // REMOVED: job_description column does not exist
        [extractedData.text, positionId.replace(/-/g, '')]
      );
    }
    return { id: existing[0].id, updated: true };
  }
  const id = uuidv4();
  await db.query(
    `INSERT INTO \`${tenantDb}\`.jd_extract (id, position_id, org_id, extracted_data) VALUES (?, ?, ?, ?)`,
    [id, positionId, orgId, dataJson]
  );
  // Also sync to positions table if text exists
  if (extractedData.text) {
    await db.query(
      // `UPDATE \`${tenantDb}\`.positions SET job_description = ?, updated_at = NOW() WHERE HEX(id) = ?`, // REMOVED: job_description column does not exist
      [extractedData.text, positionId.replace(/-/g, '')]
    );
  }
  return { id, updated: false };
}

/**
 * Upsert resume extract: if (candidate_id, position_id) exists update, else insert.
 * @param {string} tenantDb
 * @param {string} candidateId
 * @param {string} positionId
 * @param {string} orgId
 * @param {object} extractedData - { text, keywords } (JSON)
 */
async function upsertResumeExtract(tenantDb, candidateId, positionId, orgId, extractedData) {
  const dataJson = JSON.stringify(extractedData);
  const existing = await db.query(
    `SELECT id FROM \`${tenantDb}\`.resume_extract WHERE candidate_id = ? AND position_id = ? LIMIT 1`,
    [candidateId, positionId]
  );
  if (existing && existing.length > 0) {
    await db.query(
      `UPDATE \`${tenantDb}\`.resume_extract SET org_id = ?, extracted_data = ?, updated_at = NOW() WHERE candidate_id = ? AND position_id = ?`,
      [orgId, dataJson, candidateId, positionId]
    );
    return { id: existing[0].id, updated: true };
  }
  const id = uuidv4();
  await db.query(
    `INSERT INTO \`${tenantDb}\`.resume_extract (id, candidate_id, position_id, org_id, extracted_data) VALUES (?, ?, ?, ?, ?)`,
    [id, candidateId, positionId, orgId, dataJson]
  );
  return { id, updated: false };
}

/**
 * Extract from JD file buffer and save to jd_extract (upsert by position_id).
 */
async function extractAndSaveJd(tenantDb, positionId, orgId, fileBuffer, originalName) {
  const { text, keywords } = await docExtractor.extractTextAndKeywords(fileBuffer, originalName || 'document.pdf');
  await ensureExtractTables(tenantDb);
  const result = await upsertJdExtract(tenantDb, positionId, orgId, { text: text.slice(0, 50000), keywords });
  return { ...result, text: text.slice(0, 50000), keywords, keywordsCount: keywords.length };
}

/**
 * Extract from resume file buffer and save to resume_extract (upsert by candidate_id, position_id).
 */
async function extractAndSaveResume(tenantDb, candidateId, positionId, orgId, fileBuffer, originalName) {
  const { text, keywords } = await docExtractor.extractTextAndKeywords(fileBuffer, originalName || 'resume.pdf');
  await ensureExtractTables(tenantDb);
  const result = await upsertResumeExtract(tenantDb, candidateId, positionId, orgId, { text: text.slice(0, 50000), keywords });
  return { ...result, text: text.slice(0, 50000), keywords, keywordsCount: keywords.length };
}

/**
 * Extract from resume text (e.g. from CandidateBackend) and save to resume_extract. No file.
 */
async function extractAndSaveResumeFromText(tenantDb, candidateId, positionId, orgId, resumeText) {
  const keywords = docExtractor.extractKeywords(resumeText || '');
  await ensureExtractTables(tenantDb);
  const result = await upsertResumeExtract(tenantDb, candidateId, positionId, orgId, { text: (resumeText || '').slice(0, 50000), keywords });
  return { ...result, keywordsCount: keywords.length };
}

/**
 * Extract from JD text and save to jd_extract. No file.
 */
async function extractAndSaveJdFromText(tenantDb, positionId, orgId, jdText) {
  const keywords = docExtractor.extractKeywords(jdText || '');
  await ensureExtractTables(tenantDb);
  const result = await upsertJdExtract(tenantDb, positionId, orgId, { text: (jdText || '').slice(0, 50000), keywords });
  return { ...result, keywordsCount: keywords.length };
}

module.exports = {
  ensureExtractTables,
  upsertJdExtract,
  upsertResumeExtract,
  extractAndSaveJd,
  extractAndSaveResume,
  extractAndSaveResumeFromText,
  extractAndSaveJdFromText
};
