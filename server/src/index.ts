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

// Health check
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok' });
});

// WebSocket authentication
io.use((socket, next) => {
  const token = socket.handshake.auth?.token;
  if (!token) {
    return next(new Error('Authentication required'));
  }
  try {
    const secret = process.env.JWT_SECRET;
    if (!secret) return next(new Error('Server misconfigured'));
    jwt.verify(token, secret);
    next();
  } catch {
    next(new Error('Invalid token'));
  }
});

io.on('connection', (socket) => {
  socket.on('join-board', (boardId: string) => {
    socket.join(`board:${boardId}`);
  });

  socket.on('leave-board', (boardId: string) => {
    socket.leave(`board:${boardId}`);
  });

  socket.on('board-updated', (boardId: string) => {
    socket.to(`board:${boardId}`).emit('board-updated');
  });
});

// Broadcast helper (attach to app for use in routes)
app.set('io', io);

const PORT = process.env.PORT || 3001;
httpServer.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
});

export { io };
