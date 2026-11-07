import 'dotenv/config';
import mysql from 'mysql2/promise';

const dbConfig = {
  host: process.env.DB_HOST || 'srv345.hstgr.io',
  user: process.env.DB_USER || 'u692454198_reproutes',
  password: process.env.DB_PASSWORD || '5nG:;Lwqla',
  database: process.env.DB_NAME || 'u692454198_reproutes',
  port: process.env.DB_PORT || 3306,
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0,
};

// Disable SSL if DB_SSL is explicitly false, or if connecting via localhost (often required on Hostinger production)
if (process.env.DB_SSL !== 'false' && dbConfig.host !== 'localhost' && dbConfig.host !== '127.0.0.1') {
  dbConfig.ssl = { rejectUnauthorized: false };
}

const pool = mysql.createPool(dbConfig);

export default pool;
