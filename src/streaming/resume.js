// Streaming Resume upload handler for GCP
// This module will handle saving resumes to Google Cloud Storage

const { Storage } = require('@google-cloud/storage');
const path = require('path');

// Configure GCP storage
const storage = new Storage({
  keyFilename: process.env.GCP_SERVICE_ACCOUNT_KEY_PATH,
  projectId: process.env.GCP_PROJECT_ID,
});

const BUCKET_NAME = process.env.GCP_BUCKET_NAME;

/**
 * Uploads a resume file to GCP bucket
 * @param {Buffer|string} fileBuffer - The file content
 * @param {string} filename - The name to save as in GCP
 * @returns {Promise<string>} - The public URL of the uploaded file
 */
async function uploadResumeToGCP(fileBuffer, filename) {
  const bucket = storage.bucket(BUCKET_NAME);
  const file = bucket.file(`resume/${filename}`);
  await file.save(fileBuffer);
  await file.makePublic();
  return `https://storage.googleapis.com/${BUCKET_NAME}/resume/${filename}`;
}

module.exports = { uploadResumeToGCP };