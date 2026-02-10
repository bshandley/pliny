import { Router } from 'express';
import bcrypt from 'bcryptjs';
import pool from '../db';
import { authenticate, requireAdmin, generateToken } from '../middleware/auth';
import { AuthRequest } from '../types';

const router = Router();

// Login
router.post('/login', async (req, res) => {
  try {
    const { username, password } = req.body;

    const result = await pool.query(
      'SELECT id, username, password_hash, role FROM users WHERE username = $1',
      [username]
    );

    if (result.rows.length === 0) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    const user = result.rows[0];
    const valid = await bcrypt.compare(password, user.password_hash);

    if (!valid) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    const token = generateToken({
      id: user.id,
      username: user.username,
      role: user.role
    });

    res.json({
      token,
      user: {
        id: user.id,
        username: user.username,
        role: user.role
      }
    });
  } catch (error) {
    console.error('Login error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Get current user (restore session)
router.get('/me', authenticate, async (req: AuthRequest, res) => {
  try {
    const user = req.user!;
    res.json({
      id: user.id,
      username: user.username,
      role: user.role
    });
  } catch (error) {
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Register (ADMIN users can create new users)
router.post('/register', authenticate, requireAdmin, async (req: AuthRequest, res) => {
  try {
    const { username, password, role } = req.body;

    if (!username || !password || !role) {
      return res.status(400).json({ error: 'Missing required fields' });
    }

    if (username.length > 255) {
      return res.status(400).json({ error: 'Username must be 255 characters or fewer' });
    }

    if (!['READ', 'COLLABORATOR', 'ADMIN'].includes(role)) {
      return res.status(400).json({ error: 'Invalid role' });
    }

    const hash = await bcrypt.hash(password, 10);

    const result = await pool.query(
      'INSERT INTO users (username, password_hash, role) VALUES ($1, $2, $3) RETURNING id, username, role, created_at',
      [username, hash, role]
    );

    const user = result.rows[0];

    res.status(201).json({
      user: {
        id: user.id,
        username: user.username,
        role: user.role,
        created_at: user.created_at
      }
    });
  } catch (error: any) {
    if (error.code === '23505') { // Unique violation
      return res.status(409).json({ error: 'Username already exists' });
    }
    console.error('Register error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;
