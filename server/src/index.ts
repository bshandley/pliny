import express from 'express';
import cors from 'cors';
import { createServer } from 'http';
import { Server } from 'socket.io';
import jwt from 'jsonwebtoken';
import authRoutes from './routes/auth';
import boardRoutes from './routes/boards';
import columnRoutes from './routes/columns';
import cardRoutes from './routes/cards';
import userRoutes from './routes/users';
import assigneeRoutes from './routes/assignees';
import labelRoutes from './routes/labels';
import commentRoutes from './routes/comments';
import checklistRoutes from './routes/checklists';
import activityRoutes from './routes/activity';
import cardMembersRoutes from './routes/cardMembers';
import notificationRoutes from './routes/notifications';
import settingsRoutes from './routes/settings';
import totpRoutes from './routes/totp';
import oidcRoutes from './routes/oidc';
import cookieParser from 'cookie-parser';

const CLIENT_URL = process.env.CLIENT_URL || 'http://localhost:5173';

const app = express();
const httpServer = createServer(app);
const io = new Server(httpServer, {
  cors: {
    origin: CLIENT_URL,
    methods: ['GET', 'POST']
  }
});

// Middleware
app.use(cors({ origin: CLIENT_URL }));
app.use(express.json());
app.use(cookieParser());

// Routes
app.use('/api/auth', authRoutes);
app.use('/api/boards', boardRoutes);
app.use('/api/columns', columnRoutes);
app.use('/api/cards', cardRoutes);
app.use('/api/users', userRoutes);
app.use('/api', assigneeRoutes);
app.use('/api', labelRoutes);
app.use('/api', commentRoutes);
app.use('/api', checklistRoutes);
app.use('/api', activityRoutes);
app.use('/api', cardMembersRoutes);
app.use('/api/notifications', notificationRoutes);
app.use('/api/settings', settingsRoutes);
app.use('/api/settings/totp', totpRoutes);
app.use('/api/auth/oidc', oidcRoutes);

// Health check
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok' });
});

// User socket tracking for point-to-point notifications
const userSockets = new Map<string, string[]>();
app.set('userSockets', userSockets);

// WebSocket authentication
io.use((socket, next) => {
  const token = socket.handshake.auth?.token;
  if (!token) {
    return next(new Error('Authentication required'));
  }
  try {
    const secret = process.env.JWT_SECRET;
    if (!secret) return next(new Error('Server misconfigured'));
    const decoded = jwt.verify(token, secret) as { id: string; username: string; role: string };
    (socket as any).userId = decoded.id;
    next();
  } catch {
    next(new Error('Invalid token'));
  }
});

io.on('connection', (socket) => {
  const userId = (socket as any).userId;
  if (userId) {
    const existing = userSockets.get(userId) || [];
    existing.push(socket.id);
    userSockets.set(userId, existing);
  }

  socket.on('join-board', (boardId: string) => {
    socket.join(`board:${boardId}`);
  });

  socket.on('leave-board', (boardId: string) => {
    socket.leave(`board:${boardId}`);
  });

  socket.on('board-updated', (boardId: string) => {
    socket.to(`board:${boardId}`).emit('board-updated');
  });

  socket.on('disconnect', () => {
    if (userId) {
      const existing = userSockets.get(userId) || [];
      const filtered = existing.filter(id => id !== socket.id);
      if (filtered.length === 0) {
        userSockets.delete(userId);
      } else {
        userSockets.set(userId, filtered);
      }
    }
  });
});

// Broadcast helper (attach to app for use in routes)
app.set('io', io);

const PORT = process.env.PORT || 3001;
httpServer.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
});

export { io };
// Test webhook build: Fri Feb 13 05:50:55 AM UTC 2026
// Cache bust test: 2026-02-13T05:58:25+00:00
