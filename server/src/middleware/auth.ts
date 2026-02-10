import { Request, Response, NextFunction } from 'express';
import crypto from 'crypto';
import jwt from 'jsonwebtoken';
import { AuthRequest } from '../types';

function getJwtSecret(): string {
  const secret = process.env.JWT_SECRET;
  if (secret && secret.length >= 16) return secret;
  if (process.env.NODE_ENV === 'production') {
    console.error('FATAL: JWT_SECRET must be set (>=16 chars) in production');
    process.exit(1);
  }
  // Generate a random secret for development (changes each restart)
  const devSecret = crypto.randomBytes(32).toString('hex');
  console.warn('WARNING: No JWT_SECRET set — using random dev secret (sessions lost on restart)');
  return devSecret;
}

const JWT_SECRET = getJwtSecret();

export const authenticate = (req: AuthRequest, res: Response, next: NextFunction) => {
  const token = req.headers.authorization?.split(' ')[1];

  if (!token) {
    return res.status(401).json({ error: 'No token provided' });
  }

  try {
    const decoded = jwt.verify(token, JWT_SECRET) as {
      id: string;
      username: string;
      role: 'READ' | 'COLLABORATOR' | 'ADMIN';
    };
    req.user = decoded;
    next();
  } catch (error) {
    return res.status(401).json({ error: 'Invalid token' });
  }
};

export const requireAdmin = (req: AuthRequest, res: Response, next: NextFunction) => {
  if (req.user?.role !== 'ADMIN') {
    return res.status(403).json({ error: 'Admin permission required' });
  }
  next();
};

export const generateToken = (user: { id: string; username: string; role: 'READ' | 'COLLABORATOR' | 'ADMIN' }) => {
  return jwt.sign(user, JWT_SECRET, { expiresIn: '7d' });
};
