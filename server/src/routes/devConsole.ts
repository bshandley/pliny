import { Router, Response } from 'express';
import jwt from 'jsonwebtoken';
import { authenticate, requireAdmin } from '../middleware/auth';
import { AuthRequest } from '../types';
import {
  getRecentApiEvents,
  subscribeToApiEvents,
  setApiLoggingEnabled,
  isApiLoggingEnabled,
} from '../middleware/apiLogger';

const router = Router();

// Get recent API events (ADMIN only)
router.get('/events', authenticate, requireAdmin, async (req: AuthRequest, res: Response) => {
  const limit = Math.min(parseInt(req.query.limit as string) || 100, 500);
  const events = getRecentApiEvents(limit);
  res.json(events);
});

// Get logging status
router.get('/status', authenticate, requireAdmin, async (req: AuthRequest, res: Response) => {
  res.json({ enabled: isApiLoggingEnabled() });
});

// Toggle logging
router.put('/status', authenticate, requireAdmin, async (req: AuthRequest, res: Response) => {
  const { enabled } = req.body;
  if (typeof enabled !== 'boolean') {
    return res.status(400).json({ error: 'enabled must be a boolean' });
  }
  setApiLoggingEnabled(enabled);
  res.json({ enabled: isApiLoggingEnabled() });
});

// Function map will be served from a generated file (see Part 3)
router.get('/fn-map', authenticate, requireAdmin, async (req: AuthRequest, res: Response) => {
  try {
    const fs = await import('fs');
    const path = await import('path');
    const fnMapPath = path.join(__dirname, '../generated/fnMap.json');
    const fnMap = JSON.parse(fs.readFileSync(fnMapPath, 'utf-8'));
    res.json(fnMap);
  } catch {
    res.json({});
  }
});

export default router;

// WebSocket handler for real-time event streaming
export function setupDevConsoleWebSocket(io: any): void {
  // Create a namespace for dev console
  const devNs = io.of('/dev');

  devNs.use((socket: any, next: any) => {
    const token = socket.handshake.auth?.token;
    if (!token) {
      return next(new Error('Authentication required'));
    }

    try {
      const secret = process.env.JWT_SECRET;
      if (!secret) return next(new Error('Server misconfigured'));
      const decoded = jwt.verify(token, secret) as { id: string; username: string; role: string };
      if (decoded.role !== 'ADMIN') {
        return next(new Error('Admin access required'));
      }
      (socket as any).userId = decoded.id;
      next();
    } catch {
      return next(new Error('Invalid token'));
    }
  });

  devNs.on('connection', (socket: any) => {
    // Subscribe to events and forward to socket
    const unsubscribe = subscribeToApiEvents((event) => {
      socket.emit('api-event', event);
    });

    socket.on('disconnect', () => {
      unsubscribe();
    });
  });
}
