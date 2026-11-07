const mysql = require('mysql2/promise');
const bcrypt = require('bcryptjs');
require('dotenv').config();

async function recreateReproutesManager() {
    const conn = await mysql.createConnection(process.env.DATABASE_URL);
    
    console.log('Connected to database. Recreating manager@reproutes.com...');
    
    try {
        // Create or find reproutes-demo tenant
        const [tenants] = await conn.execute('SELECT id FROM `Tenant` WHERE slug = ?', ['reproutes-demo']);
        let tenantId;
        if (tenants.length === 0) {
            tenantId = 't_' + Date.now();
            await conn.execute(
                'INSERT INTO `Tenant` (id, name, slug, createdAt, updatedAt) VALUES (?, ?, ?, NOW(), NOW())',
                [tenantId, 'Reproutes Demo', 'reproutes-demo']
            );
            console.log('Created reproutes-demo tenant.');
        } else {
            tenantId = tenants[0].id;
        }

        // Hash password
        const password = 'password123';
        const passwordHash = await bcrypt.hash(password, 12);

        // Delete if already exists to reset
        await conn.execute('DELETE FROM `User` WHERE email = ?', ['manager@reproutes.com']);

        // Create Manager User
        const userId = 'u_manager_reproutes';
        const email = 'manager@reproutes.com';
        
        await conn.execute(
            `INSERT INTO \`User\` (id, email, passwordHash, name, role, tenantId, status, createdAt, updatedAt) 
             VALUES (?, ?, ?, ?, ?, ?, ?, NOW(), NOW())`,
            [userId, email, passwordHash, 'Reproutes Manager', 'MANAGER', tenantId, 'ACTIVE']
        );
        
        console.log('Account manager@reproutes.com recreated successfully!');

    } catch (error) {
        console.error('Error recreating account:', error);
    } finally {
        await conn.end();
    }
}

recreateReproutesManager();
