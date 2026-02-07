import fs from 'fs';
import path from 'path';
import pool from '../db';

async function runMigrations() {
  try {
    const sql = fs.readFileSync(
      path.join(__dirname, 'schema.sql'),
      'utf-8'
    );
    
    await pool.query(sql);
    console.log('✅ Migrations completed successfully');
    process.exit(0);
  } catch (error) {
    console.error('❌ Migration failed:', error);
    process.exit(1);
  }
}

runMigrations();
