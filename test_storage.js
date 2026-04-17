require('dotenv').config();
const fileStorageUtil = require('./src/utils/fileStorageUtil');

// Force local storage so we can safely view the created local path for verification
process.env.USE_LOCAL_STORAGE = 'true';

async function testUpload() {
    const dummyFile = {
        originalname: 'test_jd.pdf',
        buffer: Buffer.from('dummy content')
    };
    try {
        const resultOld = await fileStorageUtil.storeFile('JD', dummyFile);
        console.log('Old structure path:', resultOld.relativePath);
        
        const resultNew = await fileStorageUtil.storeFile('JD', dummyFile, {
            tenantDb: 'qwikhire_easxlo5t',
            organizationId: 'f9583cb8-3e20-4656-bcc1-3c9b8228b7b0'
        });
        console.log('New dynamic path:', resultNew.relativePath);

        // Test retrieval
        const retrieved = await fileStorageUtil.retrieveFileByRelativePath(resultNew.relativePath);
        console.log('File successfully retrieved. Size:', retrieved.length);
    } catch (e) {
        console.error(e);
    }
}
testUpload();
