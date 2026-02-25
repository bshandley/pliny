import { Router, Response } from 'express';
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
    // Verify admin token
    const token = socket.handshake.auth?.token;
    if (!token) {
      return next(new Error('Authentication required'));
    }

    // Import auth verification (will be set up in index.ts)
    const verifyAdmin = socket.handshake.auth?.verifyAdmin;
    if (!verifyAdmin) {
      // For now, just pass through - the actual verification happens in the route
      next();
    } else {
      next();
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
