const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../.env') });
const db = require('../src/config/db');
const CandidateModel = require('../src/models/candidateModel');

async function test() {
    try {
        await db.initializePool();
        console.log('Testing CandidateModel.getAllLinkedCandidates for smith_mnitalrm...');
        const filters = {
            organizationId: 'aad8206a-4b8e-4481-8d58-bdc29af56506', // Smith org ID from logs
            page: 0,
            pageSize: 10
        };
        const tenantDb = 'smith_mnitalrm';
        
        const result = await CandidateModel.getAllLinkedCandidates(filters, tenantDb);
        console.log('Success! Found candidates:', result.data.length);
        if (result.data.length > 0) {
            console.log('First candidate example:', JSON.stringify(result.data[0], null, 2));
        }
    } catch (error) {
        console.error('Test failed:', error);
    } finally {
        process.exit(0);
    }
}

test();
