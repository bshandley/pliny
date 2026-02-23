import pool from '../db';
import { BUILTIN_TEMPLATES } from './builtins';

export async function seedBuiltinTemplates() {
  for (const tpl of BUILTIN_TEMPLATES) {
    const exists = await pool.query(
      'SELECT 1 FROM board_templates WHERE name = $1 AND is_builtin = true',
      [tpl.name]
    );
    if (exists.rows.length === 0) {
      await pool.query(
        'INSERT INTO board_templates (name, description, is_builtin, data) VALUES ($1, $2, true, $3)',
        [tpl.name, tpl.description, JSON.stringify(tpl.data)]
      );
    }
  }
}
