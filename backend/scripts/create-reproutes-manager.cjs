const mysql = require('mysql2/promise');
const bcrypt = require('bcryptjs');
require('dotenv').config();

async function run() {
    const conn = await mysql.createConnection(process.env.DATABASE_URL);
    try {
        let [tenants] = await conn.execute('SELECT id FROM Tenant WHERE slug=?', ['reproutes']);
        let tenantId;
        if (tenants.length === 0) {
            tenantId = 't_' + Date.now();
            await conn.execute(
                'INSERT INTO Tenant (id, name, slug, createdAt, updatedAt) VALUES (?, ?, ?, NOW(), NOW())',
                [tenantId, 'Reproutes Official', 'reproutes']
            );
        } else {
            tenantId = tenants[0].id;
        }

        const hash = await bcrypt.hash('password123', 12);
        const [users] = await conn.execute('SELECT id FROM User WHERE email=? LIMIT 1', ['manager@reproutes.com']);
        if (users.length > 0) {
            await conn.execute(
                'UPDATE User SET passwordHash=?, name=?, role=?, tenantId=?, status=?, updatedAt=NOW() WHERE id=?',
                [hash, 'Reproutes Manager', 'MANAGER', tenantId, 'ACTIVE', users[0].id]
            );
            console.log('Reset manager@reproutes.com password and activated the account.');
        } else {
            await conn.execute(
                'INSERT INTO User (id, email, passwordHash, name, role, tenantId, status, createdAt, updatedAt) VALUES (?, ?, ?, ?, ?, ?, ?, NOW(), NOW())',
                ['u_manager_real', 'manager@reproutes.com', hash, 'Reproutes Manager', 'MANAGER', tenantId, 'ACTIVE']
            );
            console.log('Created manager@reproutes.com under reproutes tenant.');
        }
        console.log('Login email: manager@reproutes.com');
        console.log('Login password: password123');
    } catch(err) {
        console.error(err);
        process.exitCode = 1;
    } finally {
        await conn.end();
    }
}
run();
