const db = require('../src/config/db');
const adminService = require('../src/services/adminService');

async function testCredits() {
    try {
        await db.initializePool();
        const userId = "62e66c61-cfe1-4ba5-8f87-da7d6df45e7e";
        
        // Mock user object similar to req.user but without client, so adminService does a lookup
        const user = {
            id: userId,
            isCollege: false
        };
        
        console.log("Calling getCredits...");
        const result = await adminService.getCredits(null, userId, user);
        console.log("Result:", JSON.stringify(result, null, 2));
    } catch (e) {
        console.error(e);
    } finally {
        process.exit();
    }
}
testCredits();
