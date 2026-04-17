// Automated test for creating a position as admin (sharan@qwikhire.ai)
// Run with: node test_create_position.js

const axios = require('axios');


const BASE_URL = 'http://127.0.0.1:8002';
const LOGIN_URL = 'https://superadmin-backend-4uuj.onrender.com/auth-session/login';
const ADMIN_EMAIL = 'sharan@qwikhire.ai';
const ADMIN_PASSWORD = 'Sharan@123';

async function login() {
    const res = await axios.post(LOGIN_URL, {
        email: ADMIN_EMAIL,
        password: ADMIN_PASSWORD
    }, {
        withCredentials: true
    });
    console.log('Full login response:', JSON.stringify(res.data, null, 2));
    // Use accessToken from nested data
    return res.data?.data?.accessToken;
}

async function createPosition(token) {
    const positionData = {
        title: 'Test Automation Engineer',
        domainType: 'IT',
        minimumExperience: 2,
        maximumExperience: 5,
        noOfPositions: 1,
        mandatorySkills: ['JavaScript', 'Automation'],
        optionalSkills: ['Cypress'],
        jobDescriptionPath: null,
        jobDescriptionFileName: null,
        expectedStartDate: '2026-05-01',
        applicationDeadline: '2026-06-01',
        company_name: 'QwikHire',
        createdBy: 'sharan@qwikhire.ai'
    };
    const res = await axios.post(
        `${BASE_URL}/admins/positions`,
        positionData,
        {
            headers: {
                Authorization: `Bearer ${token}`,
                'Content-Type': 'application/json'
            }
        }
    );
    return res.data;
}

(async () => {
    try {
        console.log('Logging in as admin...');
        const token = await login();
        if (!token) throw new Error('Login failed, no token received');
        console.log('Login successful. Creating position...');
        const result = await createPosition(token);
        console.log('Position creation result:', result);
    } catch (err) {
        console.error('Test failed:', err.response?.data || err.message);
        process.exit(1);
    }
})();
