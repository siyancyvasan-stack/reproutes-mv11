const mysql = require('mysql2/promise');
const bcrypt = require('bcryptjs');
require('dotenv').config();

async function createAdmin() {
    const conn = await mysql.createConnection(process.env.DATABASE_URL);
    
    console.log('Connected to database. Creating a new admin account...');
    
    try {
        // Find existing tenant
        const [tenants] = await conn.execute('SELECT id, slug FROM `Tenant` WHERE slug = ?', ['my-company']);
        if (tenants.length === 0) {
            console.log('Tenant "my-company" not found. Please run the manager script first.');
            return;
        }
        const tenantId = tenants[0].id;

        // Hash password
        const password = 'adminpassword123';
        const passwordHash = await bcrypt.hash(password, 12);

        // Create Admin User
        const userId = 'u_' + Date.now();
        const email = 'admin@mycompany.com';
        
        await conn.execute(
            `INSERT INTO \`User\` (id, email, passwordHash, name, role, tenantId, status, createdAt, updatedAt) 
             VALUES (?, ?, ?, ?, ?, ?, ?, NOW(), NOW())`,
            [userId, email, passwordHash, 'System Admin', 'ADMIN', tenantId, 'ACTIVE']
        );
        
        console.log('Admin account created successfully!');
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

createAdmin();
