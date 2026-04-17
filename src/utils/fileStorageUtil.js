/**
 * File storage utility for AdminBackend.
 * - If GOOGLE_APPLICATION_CREDENTIALS is set and USE_LOCAL_STORAGE is not 'true': use GCP Cloud Storage.
 * - Otherwise: use local filesystem (./uploads) so the server can run without GCS credentials (e.g. local dev).
 * Same path structure for DB: {STORAGE_FOLDER_ID}/Resume|JD/filename
 */

const path = require('path');
const fs = require('fs').promises;
const fsSync = require('fs');

const GCS_BUCKET = process.env.GCS_BUCKET || 'qwikhire-prod-storage';
const GCS_RECORDING_BUCKET = process.env.GCS_RECORDING_BUCKET || 'ats-prod-storage';
const STORAGE_FOLDER_ID = process.env.STORAGE_FOLDER_ID || '6464-0160-2190-198-79266';

// Use local storage when credentials are not set or explicitly requested (avoids startup crash)
const USE_LOCAL_STORAGE =
  process.env.USE_LOCAL_STORAGE === 'true' ||
  !process.env.GOOGLE_APPLICATION_CREDENTIALS;

const LOCAL_UPLOADS_DIR = path.resolve(process.cwd(), 'uploads');

let defaultStorage = null;
let recordingStorage = null;
let bucket = null;
let recordingBucket = null;

function getGcsClient(bucketName = null) {
  const { Storage } = require('@google-cloud/storage');
  
  if (!defaultStorage) {
    defaultStorage = new Storage();
  }
  if (!bucket) {
    bucket = defaultStorage.bucket(GCS_BUCKET);
  }

  if (bucketName === GCS_RECORDING_BUCKET) {
    if (!recordingStorage) {
      if (process.env.GCP_CLIENT_EMAIL && process.env.GCP_PRIVATE_KEY) {
        recordingStorage = new Storage({
          credentials: {
            client_email: process.env.GCP_CLIENT_EMAIL,
            private_key: process.env.GCP_PRIVATE_KEY.replace(/\\n/g, '\n')
          }
        });
      } else {
        recordingStorage = defaultStorage;
      }
    }
    if (!recordingBucket) {
      recordingBucket = recordingStorage.bucket(GCS_RECORDING_BUCKET);
    }
    return { storage: recordingStorage, bucket: recordingBucket };
  }

  return { storage: defaultStorage, bucket };
}

/** For backward compatibility: logical base path */
const STORAGE_BASE_PATH = USE_LOCAL_STORAGE
  ? path.join(LOCAL_UPLOADS_DIR, STORAGE_FOLDER_ID)
  : `gs://${GCS_BUCKET}/${STORAGE_FOLDER_ID}`;

/**
 * Full logical path for Resume files: {folderId}/Resume
 */
function getResumeDir() {
  return `${STORAGE_FOLDER_ID}/Resume`;
}

/**
 * Full logical path for JD (Job Description) files: {folderId}/JD
 */
function getJDDir() {
  return `${STORAGE_FOLDER_ID}/JD`;
}

/**
 * Ensure local directories exist (no-op for GCS).
 */
async function ensureDir() {
  if (!USE_LOCAL_STORAGE) return;
  const resumeDir = path.join(LOCAL_UPLOADS_DIR, STORAGE_FOLDER_ID, 'Resume');
  const jdDir = path.join(LOCAL_UPLOADS_DIR, STORAGE_FOLDER_ID, 'JD');
  await fs.mkdir(resumeDir, { recursive: true });
  await fs.mkdir(jdDir, { recursive: true });
}

/**
 * Generate a safe stored filename: yyyyMMdd-HHmmss-sanitized-original.ext (same as ref backend)
 */
function generateSafeFilename(originalFilename) {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  const h = String(now.getHours()).padStart(2, '0');
  const min = String(now.getMinutes()).padStart(2, '0');
  const sec = String(now.getSeconds()).padStart(2, '0');
  const timestamp = `${y}${m}${d}-${h}${min}${sec}`;

  let base = (originalFilename || '')
    .replace(/[^a-zA-Z0-9._-]/g, '')
    .toLowerCase();
  if (!base) base = `file-${Date.now()}`;
  const ext = path.extname(originalFilename || '') || '';
  const nameWithoutExt = path.basename(base, ext) || 'document';
  const safeName = (nameWithoutExt + ext).replace(/\.+/g, '.');

  return `${timestamp}-${safeName}`;
}

/**
 * Store a file in the given folder (Resume or JD).
 * @param {'Resume'|'JD'} folderType - Which folder: 'Resume' or 'JD'
 * @param {object} file - Multer file object: { buffer, originalname } or { path (file path), originalname }
 * @returns {Promise<{ storedFilename: string, relativePath: string }>}
 */
async function storeFile(folderType, file, options = {}) {
  if (!file || (!file.buffer && !file.path)) {
    throw new Error('File cannot be empty');
  }

  const { tenantDb, organizationId } = options;
  const originalName = file.originalname || 'document.pdf';
  const storedFilename = generateSafeFilename(originalName);
  
  let relativePath = `${STORAGE_FOLDER_ID}/${folderType}/${storedFilename}`;
  let targetBucket = GCS_BUCKET;
  let forceGcp = false;

  if (folderType.toUpperCase() === 'JD' || folderType.toUpperCase() === 'RESUME') {
    relativePath = `ats-proctoring-data/qwikhire_easxlo5t/f9583cb8-3e20-4656-bcc1-3c9b8228b7b0/streaming/${folderType.toLowerCase()}/${storedFilename}`;
    targetBucket = GCS_RECORDING_BUCKET;
    forceGcp = true;
  }

  let buffer;
  if (file.buffer) {
    buffer = file.buffer;
  } else {
    buffer = await fs.readFile(file.path);
  }

  if (USE_LOCAL_STORAGE && !forceGcp) {
    const fullPath = path.join(LOCAL_UPLOADS_DIR, relativePath);
    await fs.mkdir(path.dirname(fullPath), { recursive: true });
    await fs.writeFile(fullPath, buffer);
    return { storedFilename, relativePath };
  }

  const { bucket: b } = getGcsClient(targetBucket);
  const gcsFile = b.file(relativePath);
  await gcsFile.save(buffer, {
    contentType: getContentType(storedFilename),
    metadata: { cacheControl: 'private, max-age=0' }
  });
  return { storedFilename, relativePath };
}

/**
 * Retrieve file bytes by relative path (e.g. "6464-0160-2190-198-79266/Resume/20260301-120000-x.pdf")
 */
async function retrieveFileByRelativePath(relativePath) {
  if (!relativePath || typeof relativePath !== 'string') {
    throw new Error('Invalid file path');
  }
  const key = relativePath.replace(/^\/+/, '').replace(/\\/g, '/');

  if (USE_LOCAL_STORAGE && !key.startsWith('ats-proctoring-data/')) {
    const fullPath = path.join(LOCAL_UPLOADS_DIR, key);
    try {
      return await fs.readFile(fullPath);
    } catch (err) {
      if (err.code === 'ENOENT') throw new Error('File not found: ' + relativePath);
      throw err;
    }
  }

  const targetBucket = key.startsWith('ats-proctoring-data/') ? GCS_RECORDING_BUCKET : GCS_BUCKET;
  const { bucket: b } = getGcsClient(targetBucket);
  const gcsFile = b.file(key);
  const [exists] = await gcsFile.exists();
  if (!exists) {
    throw new Error('File not found: ' + relativePath);
  }
  const [contents] = await gcsFile.download();
  return contents;
}

/**
 * Retrieve file from a folder by filename (when DB stores only filename).
 */
async function retrieveFile(folderType, filename) {
  const relativePath = `${STORAGE_FOLDER_ID}/${folderType}/${filename}`;
  return retrieveFileByRelativePath(relativePath);
}

/**
 * Get content type for download response from filename
 */
function getContentType(filename) {
  if (!filename || !filename.includes('.')) return 'application/octet-stream';
  const ext = filename.split('.').pop().toLowerCase();
  const map = {
    pdf: 'application/pdf',
    doc: 'application/msword',
    docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    xls: 'application/vnd.ms-excel',
    xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    jpg: 'image/jpeg',
    jpeg: 'image/jpeg',
    png: 'image/png',
    gif: 'image/gif',
    csv: 'text/csv',
    txt: 'text/plain',
    json: 'application/json'
  };
  return map[ext] || 'application/octet-stream';
}

/**
 * Initialize storage: local = ensure dirs; GCS = verify bucket access.
 */
async function initStorage() {
  if (USE_LOCAL_STORAGE) {
    const resumeDir = path.join(LOCAL_UPLOADS_DIR, STORAGE_FOLDER_ID, 'Resume');
    const jdDir = path.join(LOCAL_UPLOADS_DIR, STORAGE_FOLDER_ID, 'JD');
    fsSync.mkdirSync(resumeDir, { recursive: true });
    fsSync.mkdirSync(jdDir, { recursive: true });
    return;
  }
  const { bucket: b } = getGcsClient();
  const [exists] = await b.exists();
  if (!exists) {
    throw new Error(`GCS bucket "${GCS_BUCKET}" not found or not accessible. Check GOOGLE_APPLICATION_CREDENTIALS and bucket name.`);
  }
}

module.exports = {
  USE_LOCAL_STORAGE,
  STORAGE_BASE_PATH,
  STORAGE_FOLDER_ID,
  getResumeDir,
  getJDDir,
  ensureDir,
  generateSafeFilename,
  storeFile,
  retrieveFile,
  retrieveFileByRelativePath,
  getContentType,
  initStorage
};
