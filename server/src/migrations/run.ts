import fs from 'fs';
import path from 'path';
import pool from '../db';

export async function runMigrations() {
  // Run base schema first (always idempotent — uses IF NOT EXISTS throughout)
  const schemaPath = path.join(__dirname, 'schema.sql');
  if (fs.existsSync(schemaPath)) {
    const schema = fs.readFileSync(schemaPath, 'utf-8');
    await pool.query(schema);
  }

  // Ensure migration tracking table exists
  await pool.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      filename TEXT PRIMARY KEY,
      applied_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `);

  // Fetch already-applied migrations
  const applied = await pool.query('SELECT filename FROM schema_migrations');
  const appliedSet = new Set(applied.rows.map((r: { filename: string }) => r.filename));

  // Auto-discover numbered migration files (NNN-*.sql) and run in order
  const files = fs.readdirSync(__dirname)
    .filter(f => /^\d{3}-.*\.sql$/.test(f))
    .sort();

  let ran = 0;
  for (const file of files) {
    if (appliedSet.has(file)) continue; // already applied

    console.log(`Running migration: ${file}`);
    const sql = fs.readFileSync(path.join(__dirname, file), 'utf-8');
    await pool.query(sql);
    await pool.query('INSERT INTO schema_migrations (filename) VALUES ($1)', [file]);
    ran++;
  }

  console.log(`Migrations completed (${ran} new, ${appliedSet.size} already applied)`);
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
