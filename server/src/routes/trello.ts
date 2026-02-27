import { Router } from 'express';
import multer from 'multer';
import pool from '../db';
import { authenticate, requireMember } from '../middleware/auth';
import { AuthRequest } from '../types';

const router = Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 50 * 1024 * 1024 } });

// Trello color to Pliny hex mapping
const TRELLO_COLORS: Record<string, string> = {
  green: '#61bd4f',
  yellow: '#f2d600',
  orange: '#ff9f1a',
  red: '#eb5a46',
  purple: '#c377e0',
  blue: '#0079bf',
  sky: '#00c2e0',
  lime: '#51e898',
  pink: '#ff78cb',
  black: '#344563',
};
const DEFAULT_LABEL_COLOR = '#b3bac5';

interface TrelloList {
  id: string;
  name: string;
  closed: boolean;
  pos: number;
}

interface TrelloCard {
  id: string;
  name: string;
  desc: string;
  closed: boolean;
  due: string | null;
  idList: string;
  pos: number;
  idLabels: string[];
  idMembers: string[];
}

interface TrelloLabel {
  id: string;
  name: string;
  color: string | null;
}

interface TrelloMember {
  id: string;
  username: string;
  fullName: string;
}

interface TrelloChecklist {
  id: string;
  idCard: string;
  name: string;
  checkItems: { name: string; state: string; pos: number }[];
}

interface TrelloAction {
  type: string;
  date: string;
  memberCreator?: { username: string; fullName: string };
  data: { card?: { id: string }; text?: string };
}

interface TrelloBoardData {
  name: string;
  lists: TrelloList[];
  cards: TrelloCard[];
  labels: TrelloLabel[];
  members: TrelloMember[];
  checklists: TrelloChecklist[];
  actions: TrelloAction[];
}

interface MemberMatch {
  trelloUsername: string;
  fullName: string;
  matched: boolean;
  plinyUserId?: string;
  plinyUsername?: string;
}

// POST /api/trello/preview - Parse Trello JSON and return summary
router.post('/preview', authenticate, requireMember, upload.single('file'), async (req: AuthRequest, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No file uploaded' });
    }

    if (req.file.size > 50 * 1024 * 1024) {
      return res.status(400).json({ error: 'File too large. Trello exports are usually under 10MB.' });
    }

    let boardData: TrelloBoardData;
    try {
      const content = req.file.buffer.toString('utf-8');
      boardData = JSON.parse(content);
    } catch {
      return res.status(400).json({ error: "This doesn't look like a valid Trello export file" });
    }

    // Validate it looks like a Trello export
    if (!boardData.name || !Array.isArray(boardData.lists) || !Array.isArray(boardData.cards)) {
      return res.status(400).json({ error: "This doesn't look like a valid Trello export file" });
    }

    // Count stats
    const lists = boardData.lists || [];
    const cards = boardData.cards || [];
    const labels = boardData.labels || [];
    const members = boardData.members || [];
    const checklists = boardData.checklists || [];
    const actions = boardData.actions || [];

    const activeCards = cards.filter(c => !c.closed);
    const archivedCards = cards.filter(c => c.closed);
    const activeLists = lists.filter(l => !l.closed);
    const comments = actions.filter(a => a.type === 'commentCard');
    const checklistItems = checklists.reduce((sum, cl) => sum + (cl.checkItems?.length || 0), 0);

    // Match Trello members to Pliny users (case-insensitive username match)
    const memberMatches: MemberMatch[] = [];
    for (const member of members) {
      const userResult = await pool.query(
        'SELECT id, username FROM users WHERE LOWER(username) = LOWER($1)',
        [member.username]
      );
      if (userResult.rows.length > 0) {
        memberMatches.push({
          trelloUsername: member.username,
          fullName: member.fullName,
          matched: true,
          plinyUserId: userResult.rows[0].id,
          plinyUsername: userResult.rows[0].username,
        });
      } else {
        memberMatches.push({
          trelloUsername: member.username,
          fullName: member.fullName,
          matched: false,
        });
      }
    }

    const summary = {
      boardName: boardData.name,
      listCount: activeLists.length,
      cardCount: activeCards.length,
      archivedCardCount: archivedCards.length,
      labelCount: labels.filter(l => l.name || l.color).length,
      memberCount: members.length,
      matchedMemberCount: memberMatches.filter(m => m.matched).length,
      commentCount: comments.length,
      checklistItemCount: checklistItems,
    };

    res.json({ summary, members: memberMatches, boardData });
  } catch (error) {
    console.error('Trello preview error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /api/trello/import - Import Trello data into Pliny
router.post('/import', authenticate, requireMember, async (req: AuthRequest, res) => {
  try {
    const { boardData, targetBoardId } = req.body as { boardData: TrelloBoardData; targetBoardId?: string };

    if (!boardData || !boardData.name || !Array.isArray(boardData.lists) || !Array.isArray(boardData.cards)) {
      return res.status(400).json({ error: 'Invalid board data' });
    }

    const client = await pool.connect();
    const stats = {
      columns: 0,
      cards: 0,
      labels: 0,
      comments: 0,
      checklistItems: 0,
      assignees: 0,
    };

    try {
      await client.query('BEGIN');

      // 1. Create or use existing board
      let boardId: string;
      let boardName: string;

      if (targetBoardId) {
        const boardCheck = await client.query('SELECT id, name FROM boards WHERE id = $1', [targetBoardId]);
        if (boardCheck.rows.length === 0) {
          await client.query('ROLLBACK');
          return res.status(404).json({ error: 'Target board not found' });
        }
        boardId = targetBoardId;
        boardName = boardCheck.rows[0].name;
      } else {
        const boardResult = await client.query(
          'INSERT INTO boards (name, created_by) VALUES ($1, $2) RETURNING id, name',
          [boardData.name, req.user!.id]
        );
        boardId = boardResult.rows[0].id;
        boardName = boardResult.rows[0].name;

        // Add creator as board ADMIN
        await client.query(
          'INSERT INTO board_members (board_id, user_id, role) VALUES ($1, $2, $3)',
          [boardId, req.user!.id, 'ADMIN']
        );
      }

      // 2. Create labels - map Trello label id to Pliny label id
      const labelIdMap = new Map<string, string>();
      const trelloLabels = boardData.labels || [];

      for (const label of trelloLabels) {
        // Skip labels with no name and no color
        if (!label.name && !label.color) continue;

        const color = label.color ? (TRELLO_COLORS[label.color] || DEFAULT_LABEL_COLOR) : DEFAULT_LABEL_COLOR;
        const name = label.name || label.color || 'Unlabeled';

        const labelResult = await client.query(
          'INSERT INTO board_labels (board_id, name, color) VALUES ($1, $2, $3) RETURNING id',
          [boardId, name, color]
        );
        labelIdMap.set(label.id, labelResult.rows[0].id);
        stats.labels++;
      }

      // 3. Create columns from lists (skip closed lists)
      const columnIdMap = new Map<string, string>();
      const trelloLists = (boardData.lists || [])
        .filter(l => !l.closed)
        .sort((a, b) => a.pos - b.pos);

      // Get max column position for existing board
      let columnPosition = 0;
      if (targetBoardId) {
        const maxPosResult = await client.query(
          'SELECT COALESCE(MAX(position), -1) as max_pos FROM columns WHERE board_id = $1',
          [boardId]
        );
        columnPosition = maxPosResult.rows[0].max_pos + 1;
      }

      for (const list of trelloLists) {
        const columnResult = await client.query(
          'INSERT INTO columns (board_id, name, position) VALUES ($1, $2, $3) RETURNING id',
          [boardId, list.name, columnPosition++]
        );
        columnIdMap.set(list.id, columnResult.rows[0].id);
        stats.columns++;
      }

      // 4. Build member lookup: Trello member id -> Pliny user id (or null)
      const memberIdMap = new Map<string, { userId: string | null; displayName: string }>();
      const trelloMembers = boardData.members || [];

      for (const member of trelloMembers) {
        const userResult = await client.query(
          'SELECT id FROM users WHERE LOWER(username) = LOWER($1)',
          [member.username]
        );
        if (userResult.rows.length > 0) {
          memberIdMap.set(member.id, { userId: userResult.rows[0].id, displayName: member.fullName });
        } else {
          memberIdMap.set(member.id, { userId: null, displayName: member.fullName });
        }
      }

      // 5. Create cards
      const cardIdMap = new Map<string, string>();
      const trelloCards = (boardData.cards || []).sort((a, b) => a.pos - b.pos);

      // Group cards by column for position calculation
      const cardsByColumn = new Map<string, typeof trelloCards>();
      for (const card of trelloCards) {
        const columnId = columnIdMap.get(card.idList);
        if (!columnId) continue; // Skip cards in closed lists

        if (!cardsByColumn.has(columnId)) {
          cardsByColumn.set(columnId, []);
        }
        cardsByColumn.get(columnId)!.push(card);
      }

      for (const [columnId, cards] of cardsByColumn) {
        // Get max card position for this column
        let cardPosition = 0;
        if (targetBoardId) {
          const maxPosResult = await client.query(
            'SELECT COALESCE(MAX(position), -1) as max_pos FROM cards WHERE column_id = $1',
            [columnId]
          );
          cardPosition = maxPosResult.rows[0].max_pos + 1;
        }

        for (const card of cards) {
          const dueDate = card.due ? new Date(card.due).toISOString().split('T')[0] : null;

          const cardResult = await client.query(
            `INSERT INTO cards (column_id, title, description, position, due_date, archived)
             VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
            [columnId, card.name, card.desc || '', cardPosition++, dueDate, card.closed]
          );
          cardIdMap.set(card.id, cardResult.rows[0].id);
          stats.cards++;

          // 6. Create card assignees
          const cardAssignees = card.idMembers || [];
          for (const memberId of cardAssignees) {
            const memberInfo = memberIdMap.get(memberId);
            if (!memberInfo) continue;

            if (memberInfo.userId) {
              await client.query(
                'INSERT INTO card_assignees (card_id, user_id) VALUES ($1, $2) ON CONFLICT DO NOTHING',
                [cardResult.rows[0].id, memberInfo.userId]
              );
            } else {
              await client.query(
                'INSERT INTO card_assignees (card_id, display_name) VALUES ($1, $2) ON CONFLICT DO NOTHING',
                [cardResult.rows[0].id, memberInfo.displayName]
              );
            }
            stats.assignees++;
          }

          // 7. Apply labels to cards
          const cardLabelIds = card.idLabels || [];
          for (const trelloLabelId of cardLabelIds) {
            const plinyLabelId = labelIdMap.get(trelloLabelId);
            if (plinyLabelId) {
              await client.query(
                'INSERT INTO card_labels (card_id, label_id) VALUES ($1, $2) ON CONFLICT DO NOTHING',
                [cardResult.rows[0].id, plinyLabelId]
              );
            }
          }
        }
      }

      // 8. Create checklists
      const trelloChecklists = boardData.checklists || [];
      for (const checklist of trelloChecklists) {
        const plinyCardId = cardIdMap.get(checklist.idCard);
        if (!plinyCardId) continue; // Card wasn't imported (maybe in closed list)

        const items = (checklist.checkItems || []).sort((a, b) => a.pos - b.pos);
        let itemPosition = 0;

        // Get max position for existing checklist items
        const maxPosResult = await client.query(
          'SELECT COALESCE(MAX(position), -1) as max_pos FROM card_checklist_items WHERE card_id = $1',
          [plinyCardId]
        );
        itemPosition = maxPosResult.rows[0].max_pos + 1;

        for (const item of items) {
          const checked = item.state === 'complete';
          // Prefix with checklist name if there are multiple checklists on this card
          const text = items.length > 1 || checklist.name !== 'Checklist'
            ? `[${checklist.name}] ${item.name}`
            : item.name;

          await client.query(
            'INSERT INTO card_checklist_items (card_id, text, checked, position) VALUES ($1, $2, $3, $4)',
            [plinyCardId, text.substring(0, 500), checked, itemPosition++]
          );
          stats.checklistItems++;
        }
      }

      // 9. Create comments
      const trelloActions = boardData.actions || [];
      const commentActions = trelloActions
        .filter(a => a.type === 'commentCard' && a.data?.card?.id && a.data?.text)
        .sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());

      for (const action of commentActions) {
        const plinyCardId = cardIdMap.get(action.data.card!.id);
        if (!plinyCardId) continue;

        const author = action.memberCreator?.fullName || action.memberCreator?.username || 'Unknown';
        const commentText = `[Trello: @${author}] ${action.data.text}`;

        await client.query(
          'INSERT INTO card_comments (card_id, user_id, text, created_at) VALUES ($1, $2, $3, $4)',
          [plinyCardId, req.user!.id, commentText, action.date]
        );
        stats.comments++;
      }

      await client.query('COMMIT');

      // Emit socket update if importing to existing board
      if (targetBoardId) {
        const io = req.app.get('io');
        io.to(`board:${boardId}`).emit('board-updated');
      }

      res.json({ boardId, boardName, stats });
    } catch (txError) {
      await client.query('ROLLBACK');
      console.error('Trello import transaction error:', txError);
      res.status(500).json({ error: 'Import failed. No data was saved.' });
    } finally {
      client.release();
    }
  } catch (error) {
    console.error('Trello import error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;
