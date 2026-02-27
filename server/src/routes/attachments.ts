import { Router } from 'express';
import multer from 'multer';
import crypto from 'crypto';
import pool from '../db';
import { authenticate } from '../middleware/auth';
import { AuthRequest } from '../types';
import { getStorageDriver } from '../storage/factory';

const router = Router();

const maxSizeMb = parseInt(process.env.MAX_ATTACHMENT_SIZE_MB || '25', 10);
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: maxSizeMb * 1024 * 1024 },
});

// Helper: get board_id from card_id and verify user has access
async function getBoardIdForCard(cardId: string, userId: string, userRole: string): Promise<{ boardId: string; boardRole: string } | null> {
  const result = await pool.query(
    `SELECT col.board_id FROM cards c
     JOIN columns col ON c.column_id = col.id
     WHERE c.id = $1`,
    [cardId]
  );
  if (result.rows.length === 0) return null;
  const boardId = result.rows[0].board_id;

  if (userRole === 'ADMIN') {
    return { boardId, boardRole: 'ADMIN' };
  }

  const member = await pool.query(
    'SELECT role FROM board_members WHERE board_id = $1 AND user_id = $2',
    [boardId, userId]
  );
  if (member.rows.length === 0) return null;
  return { boardId, boardRole: member.rows[0].role };
}

// POST /api/cards/:cardId/attachments — upload file
router.post('/cards/:cardId/attachments', authenticate, upload.single('file'), async (req: AuthRequest, res) => {
  try {
    const { cardId } = req.params;
    const user = req.user!;

    const access = await getBoardIdForCard(cardId, user.id, user.role);
    if (!access) {
      return res.status(404).json({ error: 'Card not found' });
    }
    if (access.boardRole === 'VIEWER') {
      return res.status(403).json({ error: 'Insufficient board permissions' });
    }

    if (!req.file) {
      return res.status(400).json({ error: 'No file uploaded' });
    }

    const id = crypto.randomUUID();
    const ext = req.file.originalname.includes('.') ? req.file.originalname.split('.').pop() : '';
    const filename = ext ? `${id}.${ext}` : id;
    const storagePath = `${cardId}/${filename}`;

    const driver = getStorageDriver();
    await driver.upload(req.file, storagePath);

    const result = await pool.query(
      `INSERT INTO card_attachments (id, card_id, filename, original_name, size, mime_type, storage_path, uploader_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING *`,
      [id, cardId, filename, req.file.originalname, req.file.size, req.file.mimetype, storagePath, user.id]
    );

    // Fetch with uploader name
    const attachment = await pool.query(
      `SELECT ca.*, u.username as uploader_name
       FROM card_attachments ca
       LEFT JOIN users u ON ca.uploader_id = u.id
       WHERE ca.id = $1`,
      [result.rows[0].id]
    );

    res.status(201).json(attachment.rows[0]);
  } catch (error: any) {
    if (error.code === 'LIMIT_FILE_SIZE') {
      return res.status(413).json({ error: `File exceeds ${maxSizeMb}MB limit` });
    }
    console.error('Upload attachment error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /api/cards/:cardId/attachments — list attachments
router.get('/cards/:cardId/attachments', authenticate, async (req: AuthRequest, res) => {
  try {
    const { cardId } = req.params;
    const user = req.user!;

    const access = await getBoardIdForCard(cardId, user.id, user.role);
    if (!access) {
      return res.status(404).json({ error: 'Card not found' });
    }

    const result = await pool.query(
      `SELECT ca.*, u.username as uploader_name
       FROM card_attachments ca
       LEFT JOIN users u ON ca.uploader_id = u.id
       WHERE ca.card_id = $1
       ORDER BY ca.created_at DESC`,
      [cardId]
    );

    res.json(result.rows);
  } catch (error) {
    console.error('List attachments error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /api/attachments/:id — stream file
router.get('/attachments/:id', authenticate, async (req: AuthRequest, res) => {
  try {
    const { id } = req.params;
    const user = req.user!;

    const result = await pool.query(
      'SELECT * FROM card_attachments WHERE id = $1',
      [id]
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Attachment not found' });
    }

    const attachment = result.rows[0];
    const access = await getBoardIdForCard(attachment.card_id.toString(), user.id, user.role);
    if (!access) {
      return res.status(404).json({ error: 'Attachment not found' });
    }

    const driver = getStorageDriver();
    const stream = await driver.getStream(attachment.storage_path);

    const isImage = attachment.mime_type.startsWith('image/');
    res.setHeader('Content-Type', attachment.mime_type);
    res.setHeader('Content-Length', attachment.size);
    res.setHeader(
      'Content-Disposition',
      `${isImage ? 'inline' : 'attachment'}; filename="${encodeURIComponent(attachment.original_name)}"`
    );

    (stream as any).pipe(res);
  } catch (error) {
    console.error('Stream attachment error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// DELETE /api/attachments/:id — delete attachment
router.delete('/attachments/:id', authenticate, async (req: AuthRequest, res) => {
  try {
    const { id } = req.params;
    const user = req.user!;

    const result = await pool.query(
      'SELECT * FROM card_attachments WHERE id = $1',
      [id]
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Attachment not found' });
    }

    const attachment = result.rows[0];

    const access = await getBoardIdForCard(attachment.card_id.toString(), user.id, user.role);
    if (!access || access.boardRole === 'VIEWER') {
      return res.status(403).json({ error: 'Permission denied' });
    }

    // Only uploader or board/global ADMIN can delete
    if (attachment.uploader_id?.toString() !== user.id && access.boardRole !== 'ADMIN') {
      return res.status(403).json({ error: 'Permission denied' });
    }

    const driver = getStorageDriver();
    await driver.delete(attachment.storage_path);
    await pool.query('DELETE FROM card_attachments WHERE id = $1', [id]);

    res.json({ message: 'Attachment deleted' });
  } catch (error) {
    console.error('Delete attachment error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;
