const mysql = require('mysql2/promise');
const bcrypt = require('bcryptjs');
require('dotenv').config();

async function createTestAgent() {
    const conn = await mysql.createConnection(process.env.DATABASE_URL);
    
    try {
        // Get reproutes tenant
        const [tenants] = await conn.execute('SELECT id FROM Tenant WHERE slug=?', ['reproutes']);
        if (tenants.length === 0) {
            console.log('Tenant "reproutes" not found. Run create-reproutes-manager.cjs first.');
            return;
        }
        const tenantId = tenants[0].id;

        // Delete existing test agent if exists
        await conn.execute('DELETE FROM User WHERE email=?', ['agent@reproutes.com']);
        
        // Create test agent
        const hash = await bcrypt.hash('agent123', 12);
        const userId = 'u_agent_test_' + Date.now();
        
        await conn.execute(
            `INSERT INTO User (id, email, passwordHash, name, role, tenantId, status, region, createdAt, updatedAt) 
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, NOW(), NOW())`,
            [userId, 'agent@reproutes.com', hash, 'Test Agent', 'AGENT', tenantId, 'ACTIVE', 'Central Region']
        );
        
        // Create AgentProfile
        await conn.execute(
            `INSERT INTO AgentProfile (userId, status, shiftActive, trackingState)
             VALUES (?, ?, ?, ?)
             ON DUPLICATE KEY UPDATE status=VALUES(status)`,
            [userId, 'OFFLINE', false, 'STOPPED']
        );
        
        console.log('\n✅ Test Agent Account Created Successfully!');
        console.log('==========================================');
        console.log('Tenant:   reproutes');
        console.log('Email:    agent@reproutes.com');
        console.log('Password: agent123');
        console.log('Role:     AGENT (Field Sales Agent)');
        console.log('==========================================\n');
        
    } catch (err) {
        console.error('❌ Error:', err.message);
    } finally {
        await conn.end();
    }
}

createTestAgent();
