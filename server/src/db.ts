import { Pool } from 'pg';

const pool = new Pool({
  host: process.env.DB_HOST || 'db',
  port: parseInt(process.env.DB_PORT || '5432'),
  database: process.env.DB_NAME || 'kanban',
  user: process.env.DB_USER || 'kanban',
  password: process.env.DB_PASSWORD || 'kanban123',
});

export default pool;
