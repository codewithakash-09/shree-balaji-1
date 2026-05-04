const { Pool } = require('pg');

const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: {
        rejectUnauthorized: false
    },
    max: 10,
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 10000,  // Increase timeout
});

// Test connection
pool.connect((err, client, release) => {
    if (err) {
        console.error('❌ Database connection error:', err.message);
    } else {
        console.log('✅ Connected to Neon database');
        release();
    }
});

// Initialize database tables (without clearing existing data)
async function initializeDatabase() {
    const client = await pool.connect();
    try {
        const fs = require('fs');
        const path = require('path');
        const schema = fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8');
        await client.query(schema);
        console.log('✅ Database schema verified');
    } catch (err) {
        console.error('❌ Error initializing database:', err);
    } finally {
        client.release();
    }
}

module.exports = { pool, initializeDatabase };