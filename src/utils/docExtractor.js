/**
 * Extract text from PDF/DOCX and keywords (no AI). Used for jd_extract and resume_extract.
 */
const path = require('path');

const STOP_WORDS = new Set([
  'a', 'an', 'the', 'and', 'or', 'but', 'in', 'on', 'at', 'to', 'for', 'of', 'with', 'by', 'from',
  'is', 'are', 'was', 'were', 'be', 'been', 'being', 'have', 'has', 'had', 'do', 'does', 'did',
  'will', 'would', 'could', 'should', 'may', 'might', 'must', 'shall', 'can', 'need', 'dare',
  'this', 'that', 'these', 'those', 'it', 'its', 'as', 'if', 'when', 'than', 'because', 'until',
  'while', 'although', 'so', 'after', 'before', 'between', 'into', 'through', 'during', 'above',
  'below', 'under', 'again', 'further', 'then', 'once', 'here', 'there', 'all', 'each', 'few',
  'more', 'most', 'other', 'some', 'such', 'no', 'nor', 'not', 'only', 'own', 'same', 'so',
  'than', 'too', 'very', 'just', 'also', 'now', 'year', 'years', 'experience', 'work', 'skills'
]);

/**
 * Extract plain text from a buffer (PDF or DOCX). No AI.
 * @param {Buffer} buffer - File content
 * @param {string} originalName - e.g. "jd.pdf" or "resume.docx"
 * @returns {Promise<string>} Extracted text
 */
async function extractTextFromBuffer(buffer, originalName) {
  if (!buffer || !Buffer.isBuffer(buffer)) throw new Error('Buffer is required');
  const ext = (originalName || '').split('.').pop().toLowerCase();
  if (ext === 'pdf') {
    const pdfParse = require('pdf-parse');
    const data = await pdfParse(buffer);
    return (data && data.text) ? data.text.trim() : '';
  }
  if (ext === 'docx' || ext === 'doc') {
    const mammoth = require('mammoth');
    const result = await mammoth.extractRawText({ buffer });
    return (result && result.value) ? result.value.trim() : '';
  }
  throw new Error('Unsupported format; use PDF or DOCX');
}

/**
 * Extract keywords from text (no AI): words 3+ chars, no stop words, unique, sorted.
 * @param {string} text - Plain text
 * @returns {string[]} Array of keywords
 */
function extractKeywords(text) {
  if (!text || typeof text !== 'string') return [];
  const words = text
    .toLowerCase()
    .replace(/[^\w\s]/g, ' ')
    .split(/\s+/)
    .filter(w => w.length >= 3 && !STOP_WORDS.has(w) && /[a-z]/.test(w));
  return [...new Set(words)].sort();
}

/**
 * Extract text from file buffer then keywords. Returns { text, keywords }.
 * @param {Buffer} buffer - File content
 * @param {string} originalName - e.g. "jd.pdf"
 * @returns {Promise<{ text: string, keywords: string[] }>}
 */
async function extractTextAndKeywords(buffer, originalName) {
  const text = await extractTextFromBuffer(buffer, originalName);
  const keywords = extractKeywords(text);
  return { text, keywords };
}

module.exports = {
  extractTextFromBuffer,
  extractKeywords,
  extractTextAndKeywords
};
