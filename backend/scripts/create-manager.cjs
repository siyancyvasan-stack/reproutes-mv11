const mysql = require('mysql2/promise');
const bcrypt = require('bcryptjs');
require('dotenv').config();

async function createManager() {
    const conn = await mysql.createConnection(process.env.DATABASE_URL);
    
    console.log('Connected to database. Creating a new tenant and manager account...');
    
    try {
        // 1. Create a Tenant
        const tenantId = 't_' + Date.now();
        await conn.execute(
            'INSERT INTO `Tenant` (id, name, slug, createdAt, updatedAt) VALUES (?, ?, ?, NOW(), NOW())',
            [tenantId, 'My Company', 'my-company']
        );
        console.log(`Created Tenant: My Company (slug: my-company)`);

        // 2. Hash password
        const password = 'password123';
        const passwordHash = await bcrypt.hash(password, 12);

        // 3. Create Manager User
        const userId = 'u_' + Date.now();
        const email = 'manager@mycompany.com';
        
        await conn.execute(
            `INSERT INTO \`User\` (id, email, passwordHash, name, role, tenantId, status, createdAt, updatedAt) 
             VALUES (?, ?, ?, ?, ?, ?, ?, NOW(), NOW())`,
            [userId, email, passwordHash, 'System Manager', 'MANAGER', tenantId, 'ACTIVE']
        );
        
        console.log('Manager account created successfully!');
        console.log('-------------------------------------------');
        console.log(`Tenant Slug: my-company`);
        console.log(`Login Email: ${email}`);
        console.log(`Password:    ${password}`);
        console.log('-------------------------------------------');

    } catch (error) {
        console.error('Error creating account:', error);
    } finally {
        await conn.end();
    }
}

createManager();
