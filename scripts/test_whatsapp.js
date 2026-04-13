const whatsappService = require('../src/services/whatsappService');
const axios = require('axios');

// Mock axios
try {
    if (typeof jest !== 'undefined') {
        jest.mock('axios');
    }
} catch (e) {}

axios.post = async (url, data, config) => {
    console.log('\n--- WhatsApp API Mock Call ---');
    console.log('URL:', url);
    console.log('Headers:', JSON.stringify(config.headers, null, 2));
    console.log('Payload:', JSON.stringify(data, null, 2));
    return { data: { success: true } };
};

axios.get = async (url) => {
    if (url.includes('/superadmin/settings/whatsapp')) {
        return {
            data: {
                success: true,
                data: {
                    enabled: true,
                    apiUrl: 'https://api.test-whatsapp.com/v1/messages',
                    apiKey: 'test-api-key-123',
                    templateName: 'invite_template',
                    fromNumber: '911234567890',
                    languageCode: 'en'
                }
            }
        };
    }
    return { data: { success: false } };
};

async function runTest() {
    console.log('Testing WhatsApp Service...');
    
    const recipient = '+91 99999 88888';
    const bodyValues = ['John Doe', 'Senior Developer', 'Systemmindz', 'http://localhost:4002', 'VCODE123'];
    
    const result = await whatsappService.sendWhatsAppMessage(recipient, bodyValues);
    
    if (result.sent) {
        console.log('\nSUCCESS: WhatsApp message triggered successfully (Mock).');
    } else {
        console.log('\nFAILED:', result.error);
    }
}

runTest().catch(err => console.error(err));
