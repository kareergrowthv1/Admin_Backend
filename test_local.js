const axios = require('axios');
const LOGIN_URL = 'https://superadmin-backend-4uuj.onrender.com/auth-session/login';

async function run() {
    const res = await axios.post(LOGIN_URL, { email: 'sharan@qwikhire.ai', password: 'Sharan@123' }, { withCredentials: true });
    const token = res.data?.data?.accessToken;
    try {
        const result = await axios.post(
            'http://localhost:8002/admins/positions',
            { title: 'Test Local', domainType: 'IT', noOfPositions: 1, mandatorySkills: ['JS', 'TS'], createdBy: 'sharan@qwikhire.ai' },
            { headers: { Authorization: `Bearer ${token}` } }
        );
        console.log(result.data);
    } catch (e) {
        console.error(e.response?.data || e.message);
    }
}
run();
