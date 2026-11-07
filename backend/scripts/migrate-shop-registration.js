import db from '../src/lib/db.js';

// Additive and rerunnable: never drop existing shop data or columns.
const columns = {
    alternateMobile: 'VARCHAR(191) NULL',
    email: 'VARCHAR(191) NULL',
    paymentTerms: 'VARCHAR(120) NULL',
};
try {
    const [existing] = await db.query('SHOW COLUMNS FROM Shop');
    const names = new Set(existing.map(column => column.Field));
    const additions = Object.entries(columns)
        .filter(([name]) => !names.has(name))
        .map(([name, definition]) => `ADD COLUMN \`${name}\` ${definition}`);
    if (additions.length) {
        await db.query(`ALTER TABLE Shop ${additions.join(', ')}`);
    }
    console.log(`Shop registration schema ready (${additions.length} columns added).`);
} catch (error) {
    console.error('Shop registration migration failed:', error.code ?? error.name);
    process.exitCode = 1;
} finally {
    await db.end();
}
