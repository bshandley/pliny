# Activity, @Mentions, and Notifications Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add card activity logging, @mention system for members/assignees, and real-time in-app notifications to Plank.

**Architecture:** Three new database tables (card_activity, card_members, notifications) with corresponding API routes. Socket.io extended to track user connections for point-to-point notification delivery. Frontend gets a NotificationBell component, MentionText renderer, combined member/assignee autocomplete, and activity timeline section in cards.

**Tech Stack:** PostgreSQL, Express, Socket.io, React, TypeScript

**Design doc:** `docs/plans/2026-02-10-activity-mentions-notifications-design.md`

**Worktree:** `/home/bradley/cork/.worktrees/activity-mentions-notifications`

**All file paths are relative to the worktree root.**

---

### Task 1: Database Migration

**Files:**
- Create: `server/src/migrations/006-activity-members-notifications.sql`

**Step 1: Write the migration**

```sql
-- Card activity log
CREATE TABLE IF NOT EXISTS card_activity (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  card_id UUID NOT NULL REFERENCES cards(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE SET NULL,
  action VARCHAR(50) NOT NULL,
  detail JSONB,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_card_activity_card_id ON card_activity(card_id);

-- Card members (real user accounts linked to cards)
CREATE TABLE IF NOT EXISTS card_members (
  card_id UUID NOT NULL REFERENCES cards(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (card_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_card_members_card_id ON card_members(card_id);
CREATE INDEX IF NOT EXISTS idx_card_members_user_id ON card_members(user_id);

-- Notifications
CREATE TABLE IF NOT EXISTS notifications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  type VARCHAR(50) NOT NULL,
  card_id UUID REFERENCES cards(id) ON DELETE CASCADE,
  board_id UUID REFERENCES boards(id) ON DELETE CASCADE,
  actor_id UUID REFERENCES users(id) ON DELETE SET NULL,
  detail JSONB,
  read BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_notifications_user_id ON notifications(user_id);
CREATE INDEX IF NOT EXISTS idx_notifications_read ON notifications(user_id, read);
```

**Step 2: Add migration to schema.sql**

Append the same CREATE TABLE statements to `server/src/migrations/schema.sql` so fresh installs get the tables too.

**Step 3: Commit**

```bash
git add server/src/migrations/006-activity-members-notifications.sql server/src/migrations/schema.sql
git commit -m "feat: add card_activity, card_members, notifications tables"
```

---

### Task 2: Backend — Activity Helper + Activity Route

**Files:**
- Create: `server/src/routes/activity.ts`
- Modify: `server/src/index.ts` (register route)

**Step 1: Create activity route with logging helper**

Create `server/src/routes/activity.ts`:

```typescript
import { Router } from 'express';
import { Pool } from 'pg';
import pool from '../db';
import { authenticate } from '../middleware/auth';
import { AuthRequest } from '../types';

const router = Router();

// Get activity for a card
router.get('/cards/:cardId/activity', authenticate, async (req: AuthRequest, res) => {
  try {
    const { cardId } = req.params;
    const result = await pool.query(
      `SELECT ca.*, u.username
       FROM card_activity ca
       JOIN users u ON ca.user_id = u.id
       WHERE ca.card_id = $1
       ORDER BY ca.created_at DESC`,
      [cardId]
    );
    res.json(result.rows);
  } catch (error) {
    console.error('Get activity error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;

// Helper: log a single activity entry (fire-and-forget)
export async function logActivity(
  cardId: string,
  userId: string,
  action: string,
  detail?: Record<string, any>,
  client?: Pool | any
) {
  const db = client || pool;
  try {
    await db.query(
      'INSERT INTO card_activity (card_id, user_id, action, detail) VALUES ($1, $2, $3, $4)',
      [cardId, userId, action, detail ? JSON.stringify(detail) : null]
    );
  } catch (err) {
    console.error('Failed to log activity:', err);
  }
}
```

**Step 2: Register route in index.ts**

In `server/src/index.ts`, add:
- Import: `import activityRoutes from './routes/activity';`
- Route: `app.use('/api', activityRoutes);`

**Step 3: Commit**

```bash
git add server/src/routes/activity.ts server/src/index.ts
git commit -m "feat: add card activity route and logging helper"
```

---

### Task 3: Backend — Activity Logging in Card Routes

**Files:**
- Modify: `server/src/routes/cards.ts`

**Step 1: Add activity logging to card create**

Import `logActivity` from `'./activity'`. After the card INSERT succeeds, call:

```typescript
logActivity(result.rows[0].id, req.user!.id, 'created');
```

**Step 2: Add activity logging to card update**

This is the most complex part. Before the UPDATE query, fetch the current card state:

```typescript
const oldCard = await pool.query('SELECT * FROM cards WHERE id = $1', [id]);
if (oldCard.rows.length === 0) return res.status(404).json({ error: 'Card not found' });
const old = oldCard.rows[0];
```

After the UPDATE succeeds, compare old vs new and log each change:

```typescript
const updated = result.rows[0];

// Column move
if (column_id !== undefined && column_id !== old.column_id) {
  // Look up column names for readable activity
  const cols = await pool.query('SELECT id, name FROM columns WHERE id = ANY($1)', [[old.column_id, column_id]]);
  const colMap: Record<string, string> = {};
  cols.rows.forEach((c: any) => { colMap[c.id] = c.name; });
  logActivity(id, req.user!.id, 'moved', {
    from_column: colMap[old.column_id] || old.column_id,
    to_column: colMap[column_id] || column_id
  });
}

// Title
if (title !== undefined && title !== old.title) {
  logActivity(id, req.user!.id, 'title_changed', { from: old.title, to: title });
}

// Description
if (description !== undefined && (description || null) !== (old.description || null)) {
  logActivity(id, req.user!.id, 'description_changed');
}

// Due date
if (due_date !== undefined) {
  const oldDue = old.due_date ? old.due_date.toISOString().split('T')[0] : null;
  const newDue = due_date || null;
  if (oldDue !== newDue) {
    logActivity(id, req.user!.id, 'due_date_changed', { from: oldDue, to: newDue });
  }
}

// Archived
if (req.body.archived !== undefined && req.body.archived !== old.archived) {
  logActivity(id, req.user!.id, req.body.archived ? 'archived' : 'unarchived');
}
```

For assignee changes, after the assignee update block:

```typescript
if (assignees !== undefined) {
  const oldAssignees = (await pool.query('SELECT assignee_name FROM card_assignees WHERE card_id = $1', [id])).rows.map((r: any) => r.assignee_name);
  // (existing assignee update code runs here)
  // Then compare:
  const oldSet = new Set(oldAssignees);
  const newSet = new Set(assignees);
  const added = assignees.filter((a: string) => !oldSet.has(a));
  const removed = oldAssignees.filter((a: string) => !newSet.has(a));
  if (added.length > 0 || removed.length > 0) {
    logActivity(id, req.user!.id, 'assignees_changed', { added, removed });
  }
}
```

Note: Fetch old assignees BEFORE deleting them. Move the old assignee query above the DELETE.

For label changes, same pattern — fetch old labels before deleting, compare after inserting.

```typescript
if (req.body.labels !== undefined) {
  const oldLabels = (await pool.query('SELECT label_id FROM card_labels WHERE card_id = $1', [id])).rows.map((r: any) => r.label_id);
  // (existing label update code runs here)
  const oldSet = new Set(oldLabels);
  const newSet = new Set(req.body.labels);
  const added = req.body.labels.filter((l: string) => !oldSet.has(l));
  const removed = oldLabels.filter((l: string) => !newSet.has(l));
  if (added.length > 0 || removed.length > 0) {
    logActivity(id, req.user!.id, 'labels_changed', { added, removed });
  }
}
```

**Step 3: Skip position-only updates**

Don't log activity for `position`-only changes (drag reorder). The existing code handles position updates — just don't add logging for those.

**Step 4: Commit**

```bash
git add server/src/routes/cards.ts
git commit -m "feat: add activity logging to card create and update"
```

---

### Task 4: Backend — Card Members Routes

**Files:**
- Create: `server/src/routes/cardMembers.ts`
- Modify: `server/src/index.ts` (register route)

**Step 1: Create card members route**

Create `server/src/routes/cardMembers.ts`:

```typescript
import { Router } from 'express';
import pool from '../db';
import { authenticate, requireAdmin } from '../middleware/auth';
import { AuthRequest } from '../types';
import { logActivity } from './activity';

const router = Router();

// Get members for a card
router.get('/cards/:cardId/members', authenticate, async (req: AuthRequest, res) => {
  try {
    const { cardId } = req.params;
    const result = await pool.query(
      `SELECT u.id, u.username FROM card_members cm
       JOIN users u ON cm.user_id = u.id
       WHERE cm.card_id = $1
       ORDER BY cm.created_at`,
      [cardId]
    );
    res.json(result.rows);
  } catch (error) {
    console.error('Get card members error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Set card members (replace all)
router.put('/cards/:cardId/members', authenticate, requireAdmin, async (req: AuthRequest, res) => {
  const client = await pool.connect();
  try {
    const { cardId } = req.params;
    const { members } = req.body; // array of user IDs

    await client.query('BEGIN');

    // Get old members
    const oldResult = await client.query(
      'SELECT user_id FROM card_members WHERE card_id = $1',
      [cardId]
    );
    const oldMemberIds = oldResult.rows.map((r: any) => r.user_id);

    // Replace
    await client.query('DELETE FROM card_members WHERE card_id = $1', [cardId]);
    if (Array.isArray(members) && members.length > 0) {
      const vals = members.map((_: string, i: number) => `($1, $${i + 2})`).join(', ');
      await client.query(
        `INSERT INTO card_members (card_id, user_id) VALUES ${vals}`,
        [cardId, ...members]
      );
    }

    await client.query('COMMIT');

    // Log activity
    const oldSet = new Set(oldMemberIds);
    const newSet = new Set(members || []);
    const added = (members || []).filter((id: string) => !oldSet.has(id));
    const removed = oldMemberIds.filter((id: string) => !newSet.has(id));
    if (added.length > 0 || removed.length > 0) {
      // Look up usernames for the activity detail
      if (added.length > 0 || removed.length > 0) {
        const allIds = [...added, ...removed];
        const users = await pool.query('SELECT id, username FROM users WHERE id = ANY($1)', [allIds]);
        const nameMap: Record<string, string> = {};
        users.rows.forEach((u: any) => { nameMap[u.id] = u.username; });
        logActivity(cardId, req.user!.id, 'members_changed', {
          added: added.map((id: string) => nameMap[id] || id),
          removed: removed.map((id: string) => nameMap[id] || id)
        });
      }
    }

    // Create notifications for added members
    const io = req.app.get('io');
    const userSockets: Map<string, string[]> = req.app.get('userSockets');
    if (added.length > 0 && io && userSockets) {
      // Get card info for notification detail
      const cardInfo = await pool.query(
        `SELECT c.title, col.board_id FROM cards c
         JOIN columns col ON c.column_id = col.id
         WHERE c.id = $1`,
        [cardId]
      );
      if (cardInfo.rows.length > 0) {
        const { title, board_id } = cardInfo.rows[0];
        for (const userId of added) {
          if (userId === req.user!.id) continue; // don't notify yourself
          const notif = await pool.query(
            `INSERT INTO notifications (user_id, type, card_id, board_id, actor_id, detail)
             VALUES ($1, 'mention_card', $2, $3, $4, $5) RETURNING *`,
            [userId, cardId, board_id, req.user!.id, JSON.stringify({ card_title: title })]
          );
          // Emit via socket
          const sockets = userSockets.get(userId);
          if (sockets) {
            for (const sid of sockets) {
              io.to(sid).emit('notification:new', {
                ...notif.rows[0],
                actor_username: req.user!.username
              });
            }
          }
        }
      }
    }

    // Return updated members
    const result = await pool.query(
      `SELECT u.id, u.username FROM card_members cm
       JOIN users u ON cm.user_id = u.id
       WHERE cm.card_id = $1
       ORDER BY cm.created_at`,
      [cardId]
    );
    res.json(result.rows);
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('Set card members error:', error);
    res.status(500).json({ error: 'Internal server error' });
  } finally {
    client.release();
  }
});

export default router;
```

**Step 2: Register route in index.ts**

Add import and `app.use('/api', cardMembersRoutes);`

**Step 3: Commit**

```bash
git add server/src/routes/cardMembers.ts server/src/index.ts
git commit -m "feat: add card members routes with notifications"
```

---

### Task 5: Backend — Notifications Routes

**Files:**
- Create: `server/src/routes/notifications.ts`
- Modify: `server/src/index.ts` (register route)

**Step 1: Create notifications route**

Create `server/src/routes/notifications.ts`:

```typescript
import { Router } from 'express';
import pool from '../db';
import { authenticate } from '../middleware/auth';
import { AuthRequest } from '../types';

const router = Router();

// Get notifications for current user
router.get('/', authenticate, async (req: AuthRequest, res) => {
  try {
    const result = await pool.query(
      `SELECT n.*, u.username as actor_username, b.name as board_name
       FROM notifications n
       LEFT JOIN users u ON n.actor_id = u.id
       LEFT JOIN boards b ON n.board_id = b.id
       WHERE n.user_id = $1
       ORDER BY n.created_at DESC
       LIMIT 50`,
      [req.user!.id]
    );
    res.json(result.rows);
  } catch (error) {
    console.error('Get notifications error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Mark single notification as read
router.put('/:id/read', authenticate, async (req: AuthRequest, res) => {
  try {
    const { id } = req.params;
    await pool.query(
      'UPDATE notifications SET read = TRUE WHERE id = $1 AND user_id = $2',
      [id, req.user!.id]
    );
    res.json({ message: 'Marked as read' });
  } catch (error) {
    console.error('Mark notification read error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Mark all as read
router.put('/read-all', authenticate, async (req: AuthRequest, res) => {
  try {
    await pool.query(
      'UPDATE notifications SET read = TRUE WHERE user_id = $1 AND read = FALSE',
      [req.user!.id]
    );
    res.json({ message: 'All marked as read' });
  } catch (error) {
    console.error('Mark all read error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;
```

**Step 2: Register in index.ts**

Add import and `app.use('/api/notifications', notificationRoutes);`

**Step 3: Commit**

```bash
git add server/src/routes/notifications.ts server/src/index.ts
git commit -m "feat: add notification routes"
```

---

### Task 6: Backend — Socket.io User Tracking + Comment @Mention Notifications

**Files:**
- Modify: `server/src/index.ts` (user socket tracking)
- Modify: `server/src/routes/comments.ts` (@mention parsing + notifications)

**Step 1: Add user socket tracking to index.ts**

In `server/src/index.ts`, add a `Map<string, string[]>` to track userId→socketIds. Decode the JWT in the socket connection handler to get the userId:

```typescript
import jwt from 'jsonwebtoken';

// After io setup, before io.on('connection'):
const userSockets = new Map<string, string[]>();
app.set('userSockets', userSockets);

// Update io.use to store decoded user on socket:
io.use((socket, next) => {
  const token = socket.handshake.auth?.token;
  if (!token) return next(new Error('Authentication required'));
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

// Update io.on('connection'):
io.on('connection', (socket) => {
  const userId = (socket as any).userId;
  if (userId) {
    const existing = userSockets.get(userId) || [];
    existing.push(socket.id);
    userSockets.set(userId, existing);
  }

  // ... existing join-board, leave-board, board-updated handlers ...

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
```

Note: The existing `io.use` middleware already verifies JWT but doesn't store the decoded user — update it to do so.

**Step 2: Add @mention parsing to comments route**

In `server/src/routes/comments.ts`, after successfully inserting a comment, parse for @mentions:

```typescript
// After inserting and fetching the comment with username:
const text = comment.rows[0].text;
const mentions = [...text.matchAll(/@(\w+)/g)].map(m => m[1]);

if (mentions.length > 0) {
  // Find which mentions match board members
  // First get board_id from card
  const cardInfo = await pool.query(
    `SELECT c.id, c.title, col.board_id FROM cards c
     JOIN columns col ON c.column_id = col.id
     WHERE c.id = $1`,
    [cardId]
  );

  if (cardInfo.rows.length > 0) {
    const { title: cardTitle, board_id } = cardInfo.rows[0];

    // Get all board members (includes admins via users table + explicit members)
    const boardMembers = await pool.query(
      `SELECT DISTINCT u.id, u.username FROM users u
       LEFT JOIN board_members bm ON u.id = bm.user_id AND bm.board_id = $1
       WHERE u.role = 'ADMIN' OR bm.board_id = $1`,
      [board_id]
    );

    const memberMap = new Map<string, string>();
    boardMembers.rows.forEach((m: any) => memberMap.set(m.username.toLowerCase(), m.id));

    const io = req.app.get('io');
    const userSockets: Map<string, string[]> = req.app.get('userSockets');

    for (const mention of mentions) {
      const memberId = memberMap.get(mention.toLowerCase());
      if (memberId && memberId !== req.user!.id) {
        // Create notification
        const notif = await pool.query(
          `INSERT INTO notifications (user_id, type, card_id, board_id, actor_id, detail)
           VALUES ($1, 'mention_comment', $2, $3, $4, $5) RETURNING *`,
          [memberId, cardId, board_id, req.user!.id,
           JSON.stringify({ card_title: cardTitle, comment_text: text.substring(0, 200) })]
        );

        // Emit via socket
        if (io && userSockets) {
          const sockets = userSockets.get(memberId);
          if (sockets) {
            for (const sid of sockets) {
              io.to(sid).emit('notification:new', {
                ...notif.rows[0],
                actor_username: req.user!.username
              });
            }
          }
        }
      }
    }
  }
}
```

**Step 3: Commit**

```bash
git add server/src/index.ts server/src/routes/comments.ts
git commit -m "feat: add user socket tracking and comment @mention notifications"
```

---

### Task 7: Backend — Include Card Members in Board Fetch

**Files:**
- Modify: `server/src/routes/boards.ts`

**Step 1: Fetch card members alongside other card data**

In the `GET /:id` route (get single board with columns and cards), after the existing checklist query, add:

```typescript
// Fetch card members for all cards
const cardMembersResult = await pool.query(
  `SELECT cm.card_id, u.id, u.username
   FROM card_members cm
   INNER JOIN users u ON cm.user_id = u.id
   INNER JOIN cards c ON cm.card_id = c.id
   INNER JOIN columns col ON c.column_id = col.id
   WHERE col.board_id = $1`,
  [id]
);

// Group members by card_id
const membersByCard: Record<string, { id: string; username: string }[]> = {};
cardMembersResult.rows.forEach(row => {
  if (!membersByCard[row.card_id]) {
    membersByCard[row.card_id] = [];
  }
  membersByCard[row.card_id].push({ id: row.id, username: row.username });
});
```

Then include in the card mapping:

```typescript
const cards = cardsResult.rows.map(card => ({
  ...card,
  assignees: assigneesByCard[card.id] || [],
  labels: labelsByCard[card.id] || [],
  checklist: checklistByCard[card.id] || null,
  members: membersByCard[card.id] || []
}));
```

**Step 2: Also fetch board members for non-admin users**

The board members endpoint (`GET /:id/members`) is currently admin-only. We need all users to access board members for the autocomplete dropdown. Change `requireAdmin` to just `authenticate` on this route. (Or create a separate lightweight endpoint — but changing the existing one is simpler since READ users already have board access.)

Update the `GET /:id/members` route: remove `requireAdmin` from the middleware chain.

**Step 3: Commit**

```bash
git add server/src/routes/boards.ts
git commit -m "feat: include card members in board fetch, allow all users to list board members"
```

---

### Task 8: Frontend — Types + API Client Updates

**Files:**
- Modify: `client/src/types.ts`
- Modify: `client/src/api.ts`

**Step 1: Update types**

Add to `client/src/types.ts`:

```typescript
export interface CardMember {
  id: string;
  username: string;
}

export interface ActivityEntry {
  id: string;
  card_id: string;
  user_id: string;
  username: string;
  action: string;
  detail: Record<string, any> | null;
  created_at: string;
}

export interface Notification {
  id: string;
  user_id: string;
  type: 'mention_card' | 'mention_comment';
  card_id: string;
  board_id: string;
  actor_id: string;
  actor_username: string;
  board_name: string;
  detail: Record<string, any>;
  read: boolean;
  created_at: string;
}
```

Update the `Card` interface to add `members`:

```typescript
export interface Card {
  // ... existing fields ...
  members?: CardMember[];
}
```

**Step 2: Add API methods**

Add to the `ApiClient` class in `client/src/api.ts`:

```typescript
// Card Members
async getCardMembers(cardId: string): Promise<CardMember[]> {
  return this.fetch(`/cards/${cardId}/members`);
}

async setCardMembers(cardId: string, memberIds: string[]): Promise<CardMember[]> {
  return this.fetch(`/cards/${cardId}/members`, {
    method: 'PUT',
    body: JSON.stringify({ members: memberIds }),
  });
}

// Activity
async getCardActivity(cardId: string): Promise<ActivityEntry[]> {
  return this.fetch(`/cards/${cardId}/activity`);
}

// Notifications
async getNotifications(): Promise<Notification[]> {
  return this.fetch('/notifications');
}

async markNotificationRead(id: string): Promise<void> {
  return this.fetch(`/notifications/${id}/read`, { method: 'PUT' });
}

async markAllNotificationsRead(): Promise<void> {
  return this.fetch('/notifications/read-all', { method: 'PUT' });
}
```

Update the imports at the top of api.ts to include the new types.

**Step 3: Commit**

```bash
git add client/src/types.ts client/src/api.ts
git commit -m "feat: add types and API methods for activity, members, notifications"
```

---

### Task 9: Frontend — MentionText Component

**Files:**
- Create: `client/src/components/MentionText.tsx`

**Step 1: Create the component**

This component takes plain text and renders @mentions as colored chips.

```tsx
import { BoardMember } from '../types';

interface MentionTextProps {
  text: string;
  boardMembers: BoardMember[];
  assignees: { id: string; name: string }[];
}

export default function MentionText({ text, boardMembers, assignees }: MentionTextProps) {
  const parts = text.split(/(@\w+)/g);

  return (
    <span>
      {parts.map((part, i) => {
        if (part.startsWith('@')) {
          const name = part.substring(1);
          const isMember = boardMembers.some(
            m => m.username.toLowerCase() === name.toLowerCase()
          );
          const isAssignee = assignees.some(
            a => a.name.toLowerCase() === name.toLowerCase()
          );

          if (isMember) {
            return (
              <span key={i} className="mention-chip mention-member">
                {part}
              </span>
            );
          }
          if (isAssignee) {
            return (
              <span key={i} className="mention-chip mention-assignee">
                {part}
              </span>
            );
          }
        }
        return <span key={i}>{part}</span>;
      })}
    </span>
  );
}
```

**Step 2: Commit**

```bash
git add client/src/components/MentionText.tsx
git commit -m "feat: add MentionText component for @mention rendering"
```

---

### Task 10: Frontend — NotificationBell Component

**Files:**
- Create: `client/src/components/NotificationBell.tsx`

**Step 1: Create the component**

```tsx
import { useState, useEffect, useRef } from 'react';
import { Socket } from 'socket.io-client';
import { api } from '../api';
import { Notification } from '../types';

interface NotificationBellProps {
  socket: Socket | null;
  onNavigateToBoard: (boardId: string) => void;
}

function timeAgo(dateStr: string): string {
  const now = Date.now();
  const then = new Date(dateStr).getTime();
  const secs = Math.floor((now - then) / 1000);
  if (secs < 60) return 'just now';
  const mins = Math.floor(secs / 60);
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  return `${days}d ago`;
}

export default function NotificationBell({ socket, onNavigateToBoard }: NotificationBellProps) {
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [open, setOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    loadNotifications();
  }, []);

  useEffect(() => {
    if (!socket) return;
    const handler = (notif: Notification) => {
      setNotifications(prev => [notif, ...prev].slice(0, 50));
    };
    socket.on('notification:new', handler);
    return () => { socket.off('notification:new', handler); };
  }, [socket]);

  useEffect(() => {
    if (!open) return;
    const handleClick = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [open]);

  const loadNotifications = async () => {
    try {
      const data = await api.getNotifications();
      setNotifications(data);
    } catch (err) {
      console.error('Failed to load notifications:', err);
    }
  };

  const unreadCount = notifications.filter(n => !n.read).length;

  const handleClick = async (notif: Notification) => {
    if (!notif.read) {
      await api.markNotificationRead(notif.id);
      setNotifications(prev =>
        prev.map(n => n.id === notif.id ? { ...n, read: true } : n)
      );
    }
    setOpen(false);
    onNavigateToBoard(notif.board_id);
  };

  const handleMarkAllRead = async () => {
    await api.markAllNotificationsRead();
    setNotifications(prev => prev.map(n => ({ ...n, read: true })));
  };

  const getNotificationText = (notif: Notification) => {
    const cardTitle = notif.detail?.card_title || 'a card';
    if (notif.type === 'mention_card') {
      return { action: 'added you to', target: cardTitle };
    }
    return { action: 'mentioned you on', target: cardTitle };
  };

  return (
    <div className="notification-bell" ref={dropdownRef}>
      <button
        className="btn-icon notification-bell-btn"
        onClick={() => setOpen(!open)}
        aria-label="Notifications"
      >
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/>
          <path d="M13.73 21a2 2 0 0 1-3.46 0"/>
        </svg>
        {unreadCount > 0 && (
          <span className="notification-badge">{unreadCount > 9 ? '9+' : unreadCount}</span>
        )}
      </button>

      {open && (
        <div className="notification-dropdown">
          <div className="notification-header">
            <strong>Notifications</strong>
            {unreadCount > 0 && (
              <button onClick={handleMarkAllRead} className="notification-mark-all">
                Mark all read
              </button>
            )}
          </div>
          <div className="notification-list">
            {notifications.length === 0 ? (
              <div className="notification-empty">No notifications yet</div>
            ) : (
              notifications.map(notif => {
                const { action, target } = getNotificationText(notif);
                return (
                  <button
                    key={notif.id}
                    className={`notification-item ${!notif.read ? 'unread' : ''}`}
                    onClick={() => handleClick(notif)}
                  >
                    <div className="notification-content">
                      <span className="notification-text">
                        <strong>{notif.actor_username}</strong> {action} <strong>{target}</strong>
                        {notif.board_name && <span className="notification-board"> in {notif.board_name}</span>}
                      </span>
                      <span className="notification-time">{timeAgo(notif.created_at)}</span>
                    </div>
                  </button>
                );
              })
            )}
          </div>
        </div>
      )}
    </div>
  );
}
```

**Step 2: Commit**

```bash
git add client/src/components/NotificationBell.tsx
git commit -m "feat: add NotificationBell component"
```

---

### Task 11: Frontend — Combined Autocomplete in KanbanCard

**Files:**
- Modify: `client/src/components/KanbanCard.tsx`

This is the largest frontend change. The card edit form needs to:

1. Accept `boardMembers` prop (array of `{ id, username }`)
2. Track `editMembers` state (array of user IDs) alongside existing `editAssignees`
3. Show a grouped autocomplete dropdown with "Members (will notify)" and "Assignees" sections
4. Render selected members as blue chips and assignees as gray chips
5. Include `members` in the `handleSave` call
6. Load card members and activity when entering edit mode
7. Add a collapsible Activity section below Comments

**Step 1: Add new props and state**

Add to props interface:
```typescript
boardMembers?: { id: string; username: string }[];
```

Add state:
```typescript
const [editMembers, setEditMembers] = useState<string[]>(card.members?.map(m => m.id) || []);
const [activityEntries, setActivityEntries] = useState<ActivityEntry[]>([]);
const [loadingActivity, setLoadingActivity] = useState(false);
const [showActivity, setShowActivity] = useState(false);
```

Update useEffect that syncs card props to also sync members.

**Step 2: Update autocomplete to show grouped dropdown**

The existing `handleAssigneeInputChange` and `filteredAssignees` logic needs to be extended. The autocomplete dropdown should show:

1. **Members** section header with bell icon — filtered `boardMembers` not already in `editMembers`, matching the filter text
2. **Assignees** section header — filtered `assignees` not already in `editAssignees`, matching the filter text

Selection of a member adds to `editMembers`; selection of an assignee adds to `editAssignees`.

Replace the autocomplete dropdown JSX with the grouped version:

```tsx
{showAutocomplete && (filteredMembers.length > 0 || filteredAssignees.length > 0) && (
  <div className="mention-autocomplete">
    {filteredMembers.length > 0 && (
      <>
        <div className="mention-group-header">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.73 21a2 2 0 0 1-3.46 0"/></svg>
          Members
        </div>
        {filteredMembers.map((member, index) => (
          <div key={member.id}
            className={`mention-item mention-item-member ${index === selectedIndex ? 'selected' : ''}`}
            onClick={() => selectMember(member.id)}
            onMouseEnter={() => setSelectedIndex(index)}>
            @{member.username}
          </div>
        ))}
      </>
    )}
    {filteredAssigneesList.length > 0 && (
      <>
        <div className="mention-group-header">Assignees</div>
        {filteredAssigneesList.map((assignee, index) => {
          const adjustedIndex = filteredMembers.length + index;
          return (
            <div key={assignee.id}
              className={`mention-item mention-item-assignee ${adjustedIndex === selectedIndex ? 'selected' : ''}`}
              onClick={() => selectAssignee(assignee.name)}
              onMouseEnter={() => setSelectedIndex(adjustedIndex)}>
              @{assignee.name}
            </div>
          );
        })}
      </>
    )}
  </div>
)}
```

**Step 3: Render member chips (blue) and assignee chips (gray)**

In the chips section, render both:

```tsx
<div className="assignee-chips">
  {editMembers.map(id => {
    const member = boardMembers?.find(m => m.id === id);
    if (!member) return null;
    return (
      <div key={id} className="assignee-chip member-chip">
        <span className="chip-name">@{member.username}</span>
        <button type="button" onClick={() => removeMember(id)} className="chip-remove">×</button>
      </div>
    );
  })}
  {editAssignees.map((name, index) => (
    <div key={index} className="assignee-chip">
      <span className="chip-name">@{name}</span>
      <button type="button" onClick={() => removeAssignee(name)} className="chip-remove">×</button>
    </div>
  ))}
</div>
```

**Step 4: Update handleSave to include members**

After saving the card (existing `onUpdate` call), also call the card members API if members changed:

```typescript
const handleSave = async () => {
  if (!editTitle.trim()) return;
  onUpdate({
    title: editTitle,
    description: editDescription,
    assignees: editAssignees,
    labels: editLabels as any,
    due_date: editDueDate || null
  });
  // Save members separately
  const originalMemberIds = card.members?.map(m => m.id) || [];
  if (JSON.stringify(editMembers.sort()) !== JSON.stringify(originalMemberIds.sort())) {
    try {
      await api.setCardMembers(card.id, editMembers);
    } catch (err) {
      console.error('Failed to save members:', err);
    }
  }
  onEditEnd();
};
```

**Step 5: Add Activity section**

Load activity in `useEffect` when entering edit mode (alongside comments/checklist). Add a collapsible section below Comments:

```tsx
<div className="activity-section">
  <button type="button" className="section-toggle" onClick={() => setShowActivity(!showActivity)}>
    <span className="section-toggle-icon">{showActivity ? '▾' : '▸'}</span>
    <strong>Activity</strong>
    {activityEntries.length > 0 && (
      <span className="section-toggle-count">{activityEntries.length}</span>
    )}
  </button>
  {showActivity && (
    loadingActivity ? (
      <div className="loading-inline"><div className="spinner" style={{ width: 20, height: 20, borderWidth: 2 }}></div></div>
    ) : (
      <div className="activity-list">
        {activityEntries.length === 0 && <p className="empty-comments">No activity yet.</p>}
        {activityEntries.map(entry => (
          <div key={entry.id} className="activity-item">
            <span className="activity-text">
              <strong>{entry.username}</strong>{' '}
              {formatActivity(entry.action, entry.detail)}
            </span>
            <span className="activity-time">{timeAgo(entry.created_at)}</span>
          </div>
        ))}
      </div>
    )
  )}
</div>
```

Add a `formatActivity` helper:

```typescript
function formatActivity(action: string, detail: Record<string, any> | null): string {
  switch (action) {
    case 'created': return 'created this card';
    case 'moved': return `moved this card from ${detail?.from_column} to ${detail?.to_column}`;
    case 'archived': return 'archived this card';
    case 'unarchived': return 'restored this card';
    case 'title_changed': return `renamed this card from "${detail?.from}" to "${detail?.to}"`;
    case 'description_changed': return 'updated the description';
    case 'assignees_changed': {
      const parts: string[] = [];
      if (detail?.added?.length) parts.push(`added ${detail.added.join(', ')}`);
      if (detail?.removed?.length) parts.push(`removed ${detail.removed.join(', ')}`);
      return parts.join(' and ') || 'changed assignees';
    }
    case 'members_changed': {
      const parts: string[] = [];
      if (detail?.added?.length) parts.push(`added ${detail.added.join(', ')}`);
      if (detail?.removed?.length) parts.push(`removed ${detail.removed.join(', ')}`);
      return parts.join(' and ') || 'changed members';
    }
    case 'labels_changed': return 'changed labels';
    case 'due_date_changed': {
      if (!detail?.from && detail?.to) return `set due date to ${detail.to}`;
      if (detail?.from && !detail?.to) return 'removed the due date';
      return `changed due date from ${detail?.from} to ${detail?.to}`;
    }
    default: return action.replace(/_/g, ' ');
  }
}
```

**Step 6: Update comment rendering to use MentionText**

Import `MentionText` and replace `<p className="comment-text">{comment.text}</p>` with:

```tsx
<p className="comment-text">
  <MentionText text={comment.text} boardMembers={boardMembers || []} assignees={assignees} />
</p>
```

**Step 7: Commit**

```bash
git add client/src/components/KanbanCard.tsx
git commit -m "feat: add combined member/assignee autocomplete, activity section, mention rendering"
```

---

### Task 12: Frontend — Wire Up KanbanBoard + App

**Files:**
- Modify: `client/src/components/KanbanBoard.tsx`
- Modify: `client/src/App.tsx`

**Step 1: Pass boardMembers to KanbanCard in KanbanBoard**

Add state for board members:
```typescript
const [boardMembers, setBoardMembers] = useState<{ id: string; username: string }[]>([]);
```

Load them in `useEffect` alongside assignees/labels:
```typescript
const loadBoardMembers = async () => {
  try {
    const data = await api.getBoardMembers(boardId);
    setBoardMembers(data);
  } catch (error) {
    console.error('Failed to load board members:', error);
  }
};
```

Call `loadBoardMembers()` in the `useEffect` and on `board-updated`.

Pass `boardMembers` prop to each `<KanbanCard>`.

**Step 2: Pass socket and boardMembers to App for NotificationBell**

In `KanbanBoard`, expose the socket ref. Actually, the bell needs to live in App.tsx since it should show on all pages, not just the board view.

In `App.tsx`:
- Create a socket connection when user is authenticated (moved from KanbanBoard to App level for notifications)
- Actually, keep the board socket in KanbanBoard. Create a separate "notification socket" in App.tsx that only listens for notifications.
- Add `<NotificationBell socket={notifSocket} onNavigateToBoard={...} />` next to the Logout button in each page's header.

Simpler approach: Create the notification socket in App.tsx after login:

```typescript
const [notifSocket, setNotifSocket] = useState<Socket | null>(null);

useEffect(() => {
  if (user) {
    const token = api.getToken();
    const s = io('/', { auth: { token } });
    setNotifSocket(s);
    return () => { s.disconnect(); };
  }
}, [user]);
```

Pass `notifSocket` and a navigation callback to `NotificationBell`, which is rendered in each page component's header area. The cleanest way: render `<NotificationBell>` in App.tsx next to the `<ThemeToggle>` as a fixed position element, or pass it as a prop to each page component.

Since `KanbanBoard`, `BoardList`, and `UserManagement` each render their own headers, the simplest approach is to pass `notifSocket` and `onNavigateToBoard` as props to each, and let them render `<NotificationBell>` in their header.

Add to `KanbanBoardProps`, `BoardList` props, and `UserManagement` props:
```typescript
notifSocket?: Socket | null;
onNavigateToBoard?: (boardId: string) => void;
```

Each component renders `<NotificationBell>` in their header-actions area.

**Step 3: Handle notification navigation**

`onNavigateToBoard` in App.tsx navigates to the board. We need board name for URL slug. Fetch it if needed:

```typescript
const handleNavigateToBoard = async (boardId: string) => {
  try {
    const board = await api.getBoard(boardId);
    navigateTo('board', boardId, board.name);
  } catch {
    // Board may have been deleted
  }
};
```

**Step 4: Commit**

```bash
git add client/src/components/KanbanBoard.tsx client/src/App.tsx
git commit -m "feat: wire up NotificationBell in App and pass boardMembers to cards"
```

---

### Task 13: Frontend — Comment @Mention Autocomplete

**Files:**
- Modify: `client/src/components/KanbanCard.tsx`

**Step 1: Add @mention autocomplete to comment input**

The comment input currently is a simple text input. Add @mention autocomplete:

- Track cursor position and detect when user types `@` followed by characters
- Show the same grouped autocomplete dropdown (members + assignees) positioned above/below the comment input
- When a mention is selected, insert the `@username` text at the cursor position
- This is a text insertion (not a chip in the input) — the comment is stored as plain text

Replace the comment `<input>` with a component that:
1. Watches for `@` trigger character
2. Shows autocomplete dropdown
3. On selection, inserts `@username` into the text

Implementation approach: use the existing `newComment` state. Track whether we're in mention mode. On `@` keystroke, activate autocomplete. On selection, splice the username into `newComment` at the right position.

```typescript
const [commentMentionActive, setCommentMentionActive] = useState(false);
const [commentMentionFilter, setCommentMentionFilter] = useState('');
const [commentMentionIndex, setCommentMentionIndex] = useState(0);
const commentInputRef = useRef<HTMLInputElement>(null);
```

Handle input changes to detect `@`:
```typescript
const handleCommentChange = (e: React.ChangeEvent<HTMLInputElement>) => {
  const value = e.target.value;
  setNewComment(value);

  // Check for @ trigger
  const cursorPos = e.target.selectionStart || value.length;
  const textUpToCursor = value.substring(0, cursorPos);
  const lastAtIndex = textUpToCursor.lastIndexOf('@');

  if (lastAtIndex >= 0) {
    const charBefore = lastAtIndex > 0 ? textUpToCursor[lastAtIndex - 1] : ' ';
    if (charBefore === ' ' || charBefore === '\n' || lastAtIndex === 0) {
      const filterText = textUpToCursor.substring(lastAtIndex + 1);
      if (!/\s/.test(filterText)) {
        setCommentMentionActive(true);
        setCommentMentionFilter(filterText);
        setCommentMentionIndex(0);
        return;
      }
    }
  }
  setCommentMentionActive(false);
};
```

On mention selection, insert into text:
```typescript
const handleCommentMentionSelect = (name: string) => {
  const cursorPos = commentInputRef.current?.selectionStart || newComment.length;
  const textUpToCursor = newComment.substring(0, cursorPos);
  const lastAtIndex = textUpToCursor.lastIndexOf('@');
  const before = newComment.substring(0, lastAtIndex);
  const after = newComment.substring(cursorPos);
  setNewComment(`${before}@${name} ${after}`);
  setCommentMentionActive(false);
};
```

**Step 2: Commit**

```bash
git add client/src/components/KanbanCard.tsx
git commit -m "feat: add @mention autocomplete in comment input"
```

---

### Task 14: Frontend — CSS for New Components

**Files:**
- Modify: `client/src/index.css`

**Step 1: Add styles for all new elements**

Add to the end of `index.css` (before mobile media queries):

```css
/* ---- Notification Bell ---- */

.notification-bell {
  position: relative;
}

.notification-bell-btn {
  position: relative;
}

.notification-badge {
  position: absolute;
  top: 2px;
  right: 2px;
  background: var(--danger);
  color: white;
  font-size: 0.6rem;
  font-weight: 700;
  min-width: 16px;
  height: 16px;
  border-radius: 8px;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 0 3px;
  line-height: 1;
  border: 2px solid var(--card-bg);
}

.notification-dropdown {
  position: absolute;
  top: calc(100% + 8px);
  right: 0;
  width: 360px;
  max-height: 480px;
  background: var(--card-bg);
  border: 1px solid var(--border);
  border-radius: var(--radius-lg);
  box-shadow: var(--shadow-xl);
  z-index: 500;
  display: flex;
  flex-direction: column;
  animation: fadeIn 0.15s var(--ease);
}

.notification-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 0.75rem 1rem;
  border-bottom: 1px solid var(--border);
  font-size: 0.875rem;
}

.notification-mark-all {
  background: transparent;
  border: none;
  color: var(--primary);
  font-size: 0.75rem;
  font-weight: 500;
  cursor: pointer;
  padding: 0.25rem 0.5rem;
  border-radius: var(--radius-sm);
  transition: background 0.1s;
}

.notification-mark-all:hover {
  background: var(--primary-subtle);
}

.notification-list {
  overflow-y: auto;
  max-height: 400px;
}

.notification-item {
  display: block;
  width: 100%;
  padding: 0.75rem 1rem;
  background: transparent;
  border: none;
  border-bottom: 1px solid var(--border);
  cursor: pointer;
  text-align: left;
  font-family: var(--font-ui);
  transition: background 0.1s;
}

.notification-item:last-child {
  border-bottom: none;
}

.notification-item:hover {
  background: var(--bg);
}

.notification-item.unread {
  background: var(--primary-subtle);
}

.notification-item.unread:hover {
  background: rgba(87, 70, 175, 0.12);
}

[data-theme="dark"] .notification-item.unread:hover {
  background: rgba(139, 124, 247, 0.15);
}

.notification-content {
  display: flex;
  flex-direction: column;
  gap: 0.25rem;
}

.notification-text {
  font-size: 0.8125rem;
  color: var(--text);
  line-height: 1.4;
}

.notification-board {
  color: var(--text-secondary);
}

.notification-time {
  font-size: 0.7rem;
  color: var(--text-secondary);
}

.notification-empty {
  padding: 2rem;
  text-align: center;
  color: var(--text-secondary);
  font-size: 0.85rem;
}

/* ---- Mention Chips (in comments) ---- */

.mention-chip {
  display: inline;
  padding: 0.05rem 0.3rem;
  border-radius: var(--radius-sm);
  font-weight: 500;
  font-size: inherit;
}

.mention-member {
  background: rgba(87, 70, 175, 0.15);
  color: var(--primary);
}

[data-theme="dark"] .mention-member {
  background: rgba(139, 124, 247, 0.15);
}

.mention-assignee {
  background: var(--bg-raised);
  color: var(--text-secondary);
}

/* ---- Member Chip (blue, in card edit) ---- */

.member-chip {
  background: #2563eb;
}

/* ---- Grouped Autocomplete ---- */

.mention-group-header {
  padding: 0.35rem 0.75rem;
  font-size: 0.6875rem;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  color: var(--text-secondary);
  background: var(--bg);
  border-bottom: 1px solid var(--border);
  display: flex;
  align-items: center;
  gap: 0.375rem;
}

.mention-item-member.selected,
.mention-item-member:hover {
  background: #2563eb;
  color: white;
}

/* ---- Activity Section ---- */

.activity-section {
  border-top: 1px solid var(--border);
  padding-top: 0.25rem;
  margin-bottom: 0.5rem;
}

.activity-list {
  max-height: 200px;
  overflow-y: auto;
}

.activity-item {
  display: flex;
  justify-content: space-between;
  align-items: baseline;
  gap: 0.5rem;
  padding: 0.3rem 0;
  font-size: 0.75rem;
  color: var(--text-secondary);
  border-bottom: 1px solid var(--border);
}

.activity-item:last-child {
  border-bottom: none;
}

.activity-text {
  flex: 1;
  line-height: 1.4;
}

.activity-text strong {
  color: var(--text);
  font-weight: 600;
}

.activity-time {
  font-size: 0.6875rem;
  white-space: nowrap;
  flex-shrink: 0;
}
```

**Step 2: Mobile styles**

Inside the `@media (max-width: 768px)` block, add:

```css
.notification-dropdown {
  position: fixed;
  top: auto;
  bottom: 0;
  right: 0;
  left: 0;
  width: 100%;
  max-height: 70vh;
  max-height: 70dvh;
  border-radius: var(--radius-xl) var(--radius-xl) 0 0;
  animation: slideUpSheet 0.3s var(--ease-spring);
}
```

**Step 3: Commit**

```bash
git add client/src/index.css
git commit -m "feat: add CSS for notifications, mentions, and activity"
```

---

### Task 15: Integration Testing + Bug Fixes

**Step 1: Build check**

```bash
cd client && npx tsc --noEmit
cd ../server && npx tsc --noEmit
```

Fix any TypeScript errors.

**Step 2: Manual smoke test checklist**

- [ ] Create a card → activity shows "created this card"
- [ ] Move a card between columns → activity shows "moved from X to Y"
- [ ] Edit card title → activity logs the change
- [ ] Add/remove assignees → activity logs
- [ ] Add a member to a card → blue chip appears, notification sent
- [ ] Type `@` in comment → grouped autocomplete appears
- [ ] Select a member in comment → blue chip in rendered comment
- [ ] Select an assignee in comment → gray chip in rendered comment
- [ ] Post comment with @member → notification appears in bell
- [ ] Bell shows unread count, clicking marks read
- [ ] Mark all as read works
- [ ] Click notification → navigates to board

**Step 3: Final commit**

```bash
git add -A
git commit -m "fix: integration fixes for activity, mentions, notifications"
```
