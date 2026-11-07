const mysql = require('mysql2/promise');
require('dotenv').config();

async function removeDemoAccounts() {
    const conn = await mysql.createConnection(process.env.DATABASE_URL);
    
    console.log('Connected to database. Removing demo accounts and tenant...');
    
    try {
        await conn.query('SET FOREIGN_KEY_CHECKS = 0');
        
        console.log('Clearing User table...');
        await conn.query('TRUNCATE TABLE `User`');
        
        console.log('Clearing Tenant table...');
        await conn.query('TRUNCATE TABLE `Tenant`');

        console.log('Clearing TenantSettings table...');
        await conn.query('TRUNCATE TABLE `TenantSettings`');

        await conn.query('SET FOREIGN_KEY_CHECKS = 1');
        
        console.log('Demo accounts and tenant removed successfully!');
    } catch (error) {
        console.error('Error removing demo accounts:', error);
    } finally {
        await conn.end();
    }
}

removeDemoAccounts();
