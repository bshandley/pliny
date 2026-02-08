import { Pool } from 'pg';

if (process.env.NODE_ENV === 'production' && !process.env.DB_PASSWORD) {
  console.error('FATAL: DB_PASSWORD must be set in production');
  process.exit(1);
}

const pool = new Pool({
  host: process.env.DB_HOST || 'db',
  port: parseInt(process.env.DB_PORT || '5432'),
  database: process.env.DB_NAME || 'plank',
  user: process.env.DB_USER || 'plank',
  password: process.env.DB_PASSWORD || 'dev-only-password',
});

export default pool;
