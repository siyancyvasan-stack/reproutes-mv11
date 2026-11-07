const mysql = require('mysql2/promise');
require('dotenv').config();

async function clearDummyData() {
    const conn = await mysql.createConnection(process.env.DATABASE_URL);
    
    console.log('Connected to database. Clearing dummy operational data...');
    
    try {
        // Disable foreign key checks for truncation
        await conn.query('SET FOREIGN_KEY_CHECKS = 0');

        const tablesToClear = [
            'Order',
            'OrderItem',
            'ShopVisit',
            'LocationPing',
            'Attendance',
            'AttendanceBreak',
            'AgentActivity',
            'ChatMessage',
            'ChatRead',
            'Invoice',
            'InvoicePayment',
            'FuelEntry',
            'Notification',
            'AuditLog',
            'SafetyEvent'
        ];

        for (const table of tablesToClear) {
            console.log(`Clearing ${table}...`);
            await conn.query(`TRUNCATE TABLE \`${table}\``);
        }

        await conn.query('SET FOREIGN_KEY_CHECKS = 1');
        console.log('Dummy data cleared successfully! Users, Tenants, and Products were kept intact.');

    } catch (error) {
        console.error('Error clearing data:', error);
    } finally {
        await conn.end();
    }
}

clearDummyData();
