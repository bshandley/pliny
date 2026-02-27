import { Router } from 'express';
import bcrypt from 'bcryptjs';
import pool from '../db';
import { authenticate, requireAdmin } from '../middleware/auth';
import { AuthRequest } from '../types';

const router = Router();

// Get all users (admin only)
router.get('/', authenticate, requireAdmin, async (req: AuthRequest, res) => {
  try {
    const result = await pool.query(
      'SELECT id, username, role, created_at FROM users ORDER BY created_at DESC'
    );
    res.json(result.rows);
  } catch (error) {
    console.error('Get users error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Update user (admin only)
router.put('/:id', authenticate, requireAdmin, async (req: AuthRequest, res) => {
  try {
    const { id } = req.params;
    const { username, password, role } = req.body;

    // Prevent admin from demoting themselves
    if (id === req.user!.id && role && role !== 'ADMIN') {
      return res.status(400).json({ error: 'Cannot change your own role' });
    }

    if (role && !['GUEST', 'MEMBER', 'ADMIN'].includes(role)) {
      return res.status(400).json({ error: 'Invalid role' });
    }

    if (username && username.length > 255) {
      return res.status(400).json({ error: 'Username must be 255 characters or fewer' });
    }

    // Build update query dynamically
    const updates: string[] = [];
    const values: any[] = [];
    let paramCount = 0;

    if (username) {
      paramCount++;
      updates.push(`username = $${paramCount}`);
      values.push(username);
    }

    if (password) {
      paramCount++;
      const hash = await bcrypt.hash(password, 10);
      updates.push(`password_hash = $${paramCount}`);
      values.push(hash);
    }

    if (role) {
      paramCount++;
      updates.push(`role = $${paramCount}`);
      values.push(role);
    }

    if (updates.length === 0) {
      return res.status(400).json({ error: 'No fields to update' });
    }

    paramCount++;
    values.push(id);

    const result = await pool.query(
      `UPDATE users SET ${updates.join(', ')} WHERE id = $${paramCount} RETURNING id, username, role, created_at`,
      values
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'User not found' });
    }

    res.json(result.rows[0]);
  } catch (error: any) {
    if (error.code === '23505') {
      return res.status(409).json({ error: 'Username already exists' });
    }
    console.error('Update user error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Delete user (admin only)
router.delete('/:id', authenticate, requireAdmin, async (req: AuthRequest, res) => {
  try {
    const { id } = req.params;

    // Prevent admin from deleting themselves
    if (id === req.user!.id) {
      return res.status(400).json({ error: 'Cannot delete your own account' });
    }

    // Check if deleting this user would orphan any boards (leave them with no ADMIN)
    const orphanCheck = await pool.query(
      `SELECT bm.board_id, b.name
       FROM board_members bm
       JOIN boards b ON bm.board_id = b.id
       WHERE bm.user_id = $1 AND bm.role = 'ADMIN'
         AND (SELECT COUNT(*) FROM board_members bm2
              WHERE bm2.board_id = bm.board_id AND bm2.role = 'ADMIN') = 1`,
      [id]
    );
    if (orphanCheck.rows.length > 0) {
      const boardNames = orphanCheck.rows.map((r: any) => r.name).join(', ');
      return res.status(400).json({
        error: `Cannot delete user: they are the sole admin on board(s): ${boardNames}. Reassign admin role first.`
      });
    }

    const result = await pool.query(
      'DELETE FROM users WHERE id = $1 RETURNING id, username',
      [id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'User not found' });
    }

    res.json({ message: 'User deleted' });
  } catch (error) {
    console.error('Delete user error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;
