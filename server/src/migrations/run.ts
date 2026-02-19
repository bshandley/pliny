import fs from 'fs';
import path from 'path';
import pool from '../db';

export async function runMigrations() {
  // Run base schema first
  const schemaPath = path.join(__dirname, 'schema.sql');
  if (fs.existsSync(schemaPath)) {
    const schema = fs.readFileSync(schemaPath, 'utf-8');
    await pool.query(schema);
  }

  // Auto-discover numbered migration files (NNN-*.sql) and run in order
  const files = fs.readdirSync(__dirname)
    .filter(f => /^\d{3}-.*\.sql$/.test(f))
    .sort();

  for (const file of files) {
    const sql = fs.readFileSync(path.join(__dirname, file), 'utf-8');
    await pool.query(sql);
  }

  console.log(`Migrations completed (${files.length} files)`);
}

// Allow running as standalone script
if (require.main === module) {
  runMigrations()
    .then(() => process.exit(0))
    .catch(err => {
      console.error('Migration failed:', err);
      process.exit(1);
    });
}
