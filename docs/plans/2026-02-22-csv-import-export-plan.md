# CSV Import/Export Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add CSV export and import to Plank boards, accessible from the board settings menu (admin-only).

**Architecture:** Server-side approach — backend generates CSV for export and parses CSV for import. Import uses a two-step flow: upload for preview, then confirm with column mapping. Frontend adds a modal for import with drag-drop file upload, column mapping UI, and row preview.

**Tech Stack:** Express routes with `csv-stringify` and `csv-parse` (from the `csv` npm family), `multer` for file upload handling, existing modal/toast patterns in the frontend.

---

### Task 1: Install server dependencies

**Files:**
- Modify: `server/package.json`

**Step 1: Install csv and multer packages**

Run:
```bash
cd /home/bradley/cork/server && npm install csv-stringify csv-parse multer && npm install -D @types/multer
```

**Step 2: Verify installation**

Run: `cd /home/bradley/cork/server && node -e "require('csv-stringify'); require('csv-parse'); require('multer'); console.log('OK')"`
Expected: `OK`

**Step 3: Commit**

```bash
git add server/package.json server/package-lock.json
git commit -m "chore: add csv-stringify, csv-parse, and multer dependencies"
```

---

### Task 2: Create CSV export endpoint

**Files:**
- Create: `server/src/routes/csv.ts`
- Modify: `server/src/index.ts:25,69` (import and mount)

**Step 1: Create the route file with export endpoint**

Create `server/src/routes/csv.ts`:

```typescript
import { Router } from 'express';
import { stringify } from 'csv-stringify/sync';
import pool from '../db';
import { authenticate, requireAdmin } from '../middleware/auth';
import { AuthRequest } from '../types';

const router = Router();

// GET /api/boards/:boardId/csv/export
router.get('/boards/:boardId/csv/export', authenticate, requireAdmin, async (req: AuthRequest, res) => {
  try {
    const { boardId } = req.params;

    // Verify board exists
    const boardResult = await pool.query('SELECT name FROM boards WHERE id = $1', [boardId]);
    if (boardResult.rows.length === 0) {
      return res.status(404).json({ error: 'Board not found' });
    }
    const boardName = boardResult.rows[0].name;

    // Fetch columns
    const columnsResult = await pool.query(
      'SELECT id, name FROM columns WHERE board_id = $1 ORDER BY position',
      [boardId]
    );
    const columnMap = new Map(columnsResult.rows.map((c: any) => [c.id, c.name]));

    // Fetch non-archived cards ordered by column position, then card position
    const cardsResult = await pool.query(
      `SELECT c.id, c.title, c.description, c.column_id, c.position, c.due_date, c.start_date, c.created_at
       FROM cards c
       INNER JOIN columns col ON c.column_id = col.id
       WHERE col.board_id = $1 AND c.archived = false
       ORDER BY col.position, c.position`,
      [boardId]
    );

    // Fetch assignees for all cards
    const assigneesResult = await pool.query(
      `SELECT ca.card_id, ca.assignee_name
       FROM card_assignees ca
       INNER JOIN cards c ON ca.card_id = c.id
       INNER JOIN columns col ON c.column_id = col.id
       WHERE col.board_id = $1 AND c.archived = false`,
      [boardId]
    );
    const assigneesByCard = new Map<string, string[]>();
    for (const row of assigneesResult.rows) {
      const list = assigneesByCard.get(row.card_id) || [];
      list.push(row.assignee_name);
      assigneesByCard.set(row.card_id, list);
    }

    // Fetch labels for all cards
    const labelsResult = await pool.query(
      `SELECT cl.card_id, bl.name
       FROM card_labels cl
       INNER JOIN board_labels bl ON cl.label_id = bl.id
       INNER JOIN cards c ON cl.card_id = c.id
       INNER JOIN columns col ON c.column_id = col.id
       WHERE col.board_id = $1 AND c.archived = false`,
      [boardId]
    );
    const labelsByCard = new Map<string, string[]>();
    for (const row of labelsResult.rows) {
      const list = labelsByCard.get(row.card_id) || [];
      list.push(row.name);
      labelsByCard.set(row.card_id, list);
    }

    // Fetch custom field definitions
    const customFieldsResult = await pool.query(
      'SELECT id, name FROM board_custom_fields WHERE board_id = $1 ORDER BY position',
      [boardId]
    );
    const customFields = customFieldsResult.rows;

    // Fetch custom field values
    const cfValuesResult = await pool.query(
      `SELECT v.card_id, v.field_id, v.value
       FROM card_custom_field_values v
       JOIN board_custom_fields f ON v.field_id = f.id
       WHERE f.board_id = $1`,
      [boardId]
    );
    const cfValuesByCard = new Map<string, Map<string, string>>();
    for (const row of cfValuesResult.rows) {
      if (!cfValuesByCard.has(row.card_id)) {
        cfValuesByCard.set(row.card_id, new Map());
      }
      cfValuesByCard.get(row.card_id)!.set(row.field_id, row.value);
    }

    // Build CSV header
    const baseHeaders = ['Title', 'Description', 'Column', 'Position', 'Assignees', 'Labels', 'Due Date', 'Start Date', 'Created At'];
    const headers = [...baseHeaders, ...customFields.map((f: any) => f.name)];

    // Build CSV rows
    const rows = cardsResult.rows.map((card: any) => {
      const baseRow = [
        card.title || '',
        card.description || '',
        columnMap.get(card.column_id) || '',
        String(card.position),
        (assigneesByCard.get(card.id) || []).join(', '),
        (labelsByCard.get(card.id) || []).join(', '),
        card.due_date ? new Date(card.due_date).toISOString().split('T')[0] : '',
        card.start_date ? new Date(card.start_date).toISOString().split('T')[0] : '',
        card.created_at ? new Date(card.created_at).toISOString() : '',
      ];

      const cfValues = cfValuesByCard.get(card.id);
      const cfRow = customFields.map((f: any) => cfValues?.get(f.id) || '');

      return [...baseRow, ...cfRow];
    });

    // Generate CSV
    const csv = stringify([headers, ...rows]);

    // Sanitize board name for filename
    const safeName = boardName.replace(/[^a-zA-Z0-9-_ ]/g, '').replace(/\s+/g, '-').toLowerCase();
    const date = new Date().toISOString().split('T')[0];
    const filename = `${safeName}-${date}.csv`;

    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.send(csv);
  } catch (error) {
    console.error('CSV export error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;
```

**Step 2: Mount the route in index.ts**

In `server/src/index.ts`, add import after line 25:

```typescript
import csvRoutes from './routes/csv';
```

Add mount after line 69 (after `appSettingsRoutes`):

```typescript
app.use('/api', csvRoutes);
```

**Step 3: Build and verify**

Run: `cd /home/bradley/cork/server && npx tsc --noEmit`
Expected: No errors

**Step 4: Commit**

```bash
git add server/src/routes/csv.ts server/src/index.ts
git commit -m "feat: add CSV export endpoint for boards"
```

---

### Task 3: Add CSV export to frontend

**Files:**
- Modify: `client/src/api.ts` (add export method)
- Modify: `client/src/components/KanbanBoard.tsx` (add menu button + handler)

**Step 1: Add exportBoardCsv method to ApiClient**

In `client/src/api.ts`, add before the closing `}` of the class (before line 438):

```typescript
  // CSV
  async exportBoardCsv(boardId: string): Promise<void> {
    const token = this.getToken();
    const response = await fetch(`${API_URL}/boards/${boardId}/csv/export`, {
      headers: token ? { 'Authorization': `Bearer ${token}` } : {},
    });
    if (!response.ok) {
      const error = await response.json().catch(() => ({ error: 'Export failed' }));
      throw new Error(error.error || 'Export failed');
    }
    const blob = await response.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = response.headers.get('Content-Disposition')?.match(/filename="(.+)"/)?.[1] || 'export.csv';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }
```

**Step 2: Add export button to board settings menu**

In `client/src/components/KanbanBoard.tsx`, add an `exportStatus` state near line 48:

```typescript
const [exportStatus, setExportStatus] = useState<string | null>(null);
```

Add handler function inside the component (near other handlers):

```typescript
const handleExportCsv = async () => {
  setShowSettingsDropdown(false);
  setMobileMenuOpen(false);
  try {
    await api.exportBoardCsv(boardId);
    setExportStatus('Export complete');
    setTimeout(() => setExportStatus(null), 3000);
  } catch (err: any) {
    setExportStatus(err.message || 'Export failed');
    setTimeout(() => setExportStatus(null), 5000);
  }
};
```

Add button in the board-settings-menu div, after the "Custom Fields" button (after line 628):

```jsx
<div className="board-settings-divider" />
<button onClick={handleExportCsv}>Export CSV</button>
```

Add a toast display near the bottom of the component JSX, before the closing `</div>` (before line 996):

```jsx
{exportStatus && (
  <div className="csv-toast">{exportStatus}</div>
)}
```

**Step 3: Add toast CSS**

In `client/src/index.css`, add at the end:

```css
/* CSV toast */
.csv-toast {
  position: fixed;
  bottom: 1.5rem;
  right: 1.5rem;
  background: var(--card-bg);
  border: 1px solid var(--border);
  padding: 0.75rem 1.25rem;
  border-radius: var(--radius);
  box-shadow: var(--shadow-lg);
  font-size: 0.875rem;
  z-index: 1100;
  animation: modalIn 0.25s var(--ease-spring);
}
```

**Step 4: Verify build**

Run: `cd /home/bradley/cork/client && npx tsc --noEmit`
Expected: No errors

**Step 5: Commit**

```bash
git add client/src/api.ts client/src/components/KanbanBoard.tsx client/src/index.css
git commit -m "feat: add CSV export button to board settings menu"
```

---

### Task 4: Create CSV import preview endpoint

**Files:**
- Modify: `server/src/routes/csv.ts` (add preview endpoint)

**Step 1: Add multer and preview endpoint to csv.ts**

Add these imports at the top of `server/src/routes/csv.ts`:

```typescript
import multer from 'multer';
import { parse } from 'csv-parse/sync';
```

Add multer config after the imports:

```typescript
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 5 * 1024 * 1024 } });
```

Add a module-level Map to store parsed data temporarily:

```typescript
// Temporary storage for parsed CSV data, keyed by a random ID
const pendingImports = new Map<string, { rows: Record<string, string>[]; headers: string[]; boardId: string; userId: string; expiresAt: number }>();

// Clean up expired entries every 5 minutes
setInterval(() => {
  const now = Date.now();
  for (const [key, value] of pendingImports) {
    if (value.expiresAt < now) pendingImports.delete(key);
  }
}, 5 * 60 * 1000);
```

Add the preview endpoint after the export endpoint:

```typescript
// POST /api/boards/:boardId/csv/import/preview
router.post('/boards/:boardId/csv/import/preview', authenticate, requireAdmin, upload.single('file'), async (req: AuthRequest, res) => {
  try {
    const { boardId } = req.params;

    // Verify board exists
    const boardResult = await pool.query('SELECT id FROM boards WHERE id = $1', [boardId]);
    if (boardResult.rows.length === 0) {
      return res.status(404).json({ error: 'Board not found' });
    }

    if (!req.file) {
      return res.status(400).json({ error: 'No file uploaded' });
    }

    const csvContent = req.file.buffer.toString('utf-8');
    let records: Record<string, string>[];
    try {
      records = parse(csvContent, { columns: true, skip_empty_lines: true, trim: true });
    } catch (parseErr: any) {
      return res.status(400).json({ error: `Invalid CSV: ${parseErr.message}` });
    }

    if (records.length === 0) {
      return res.status(400).json({ error: 'CSV file is empty (no data rows)' });
    }

    const headers = Object.keys(records[0]);

    // Auto-map headers to Plank fields
    const fieldAliases: Record<string, string[]> = {
      title: ['title', 'name', 'card', 'card title', 'card name', 'task', 'task name'],
      description: ['description', 'desc', 'details', 'body', 'notes'],
      column: ['column', 'list', 'status', 'stage', 'column name'],
      assignees: ['assignees', 'assignee', 'assigned', 'assigned to', 'owner', 'owners'],
      labels: ['labels', 'label', 'tags', 'tag', 'category', 'categories'],
      due_date: ['due date', 'due_date', 'duedate', 'deadline', 'due'],
      start_date: ['start date', 'start_date', 'startdate', 'start'],
      position: ['position', 'order', 'sort', 'index'],
    };

    // Fetch board custom fields for mapping
    const customFieldsResult = await pool.query(
      'SELECT id, name, field_type FROM board_custom_fields WHERE board_id = $1 ORDER BY position',
      [boardId]
    );

    const suggestedMapping: Record<string, string> = {};
    for (const header of headers) {
      const lowerHeader = header.toLowerCase().trim();
      let matched = false;

      // Check built-in fields
      for (const [field, aliases] of Object.entries(fieldAliases)) {
        if (aliases.includes(lowerHeader)) {
          suggestedMapping[header] = field;
          matched = true;
          break;
        }
      }

      // Check custom fields
      if (!matched) {
        for (const cf of customFieldsResult.rows) {
          if (cf.name.toLowerCase() === lowerHeader) {
            suggestedMapping[header] = `custom:${cf.id}`;
            matched = true;
            break;
          }
        }
      }

      if (!matched) {
        suggestedMapping[header] = 'skip';
      }
    }

    // Store parsed data for the confirm step
    const importId = crypto.randomUUID();
    pendingImports.set(importId, {
      rows: records,
      headers,
      boardId,
      userId: req.user!.id,
      expiresAt: Date.now() + 10 * 60 * 1000, // 10 minute expiry
    });

    res.json({
      importId,
      headers,
      suggestedMapping,
      sampleRows: records.slice(0, 5),
      rowCount: records.length,
      customFields: customFieldsResult.rows,
    });
  } catch (error) {
    console.error('CSV import preview error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});
```

**Step 2: Add crypto import at top of file**

```typescript
import crypto from 'crypto';
```

**Step 3: Build and verify**

Run: `cd /home/bradley/cork/server && npx tsc --noEmit`
Expected: No errors

**Step 4: Commit**

```bash
git add server/src/routes/csv.ts
git commit -m "feat: add CSV import preview endpoint with auto column mapping"
```

---

### Task 5: Create CSV import confirm endpoint

**Files:**
- Modify: `server/src/routes/csv.ts` (add confirm endpoint)

**Step 1: Add confirm endpoint after the preview endpoint**

```typescript
// POST /api/boards/:boardId/csv/import/confirm
router.post('/boards/:boardId/csv/import/confirm', authenticate, requireAdmin, async (req: AuthRequest, res) => {
  try {
    const { boardId } = req.params;
    const { importId, mapping } = req.body as { importId: string; mapping: Record<string, string> };

    if (!importId || !mapping) {
      return res.status(400).json({ error: 'importId and mapping are required' });
    }

    const pending = pendingImports.get(importId);
    if (!pending) {
      return res.status(400).json({ error: 'Import session expired or not found. Please re-upload the file.' });
    }
    if (pending.boardId !== boardId || pending.userId !== req.user!.id) {
      return res.status(403).json({ error: 'Import session mismatch' });
    }

    // Clean up the pending import
    pendingImports.delete(importId);

    // Verify title mapping exists
    const titleHeader = Object.entries(mapping).find(([_, field]) => field === 'title')?.[0];
    if (!titleHeader) {
      return res.status(400).json({ error: 'A column must be mapped to Title' });
    }

    // Fetch columns for the board
    const columnsResult = await pool.query(
      'SELECT id, name, position FROM columns WHERE board_id = $1 ORDER BY position',
      [boardId]
    );
    if (columnsResult.rows.length === 0) {
      return res.status(400).json({ error: 'Board has no columns' });
    }
    const columns = columnsResult.rows;
    const columnByName = new Map(columns.map((c: any) => [c.name.toLowerCase(), c.id]));
    const firstColumnId = columns[0].id;

    // Fetch existing labels
    const existingLabels = await pool.query(
      'SELECT id, name FROM board_labels WHERE board_id = $1',
      [boardId]
    );
    const labelByName = new Map(existingLabels.rows.map((l: any) => [l.name.toLowerCase(), l.id]));

    // Fetch existing assignees
    const existingAssignees = await pool.query(
      'SELECT name FROM board_assignees WHERE board_id = $1',
      [boardId]
    );
    const assigneeSet = new Set(existingAssignees.rows.map((a: any) => a.name.toLowerCase()));

    // Get max positions per column
    const positionsResult = await pool.query(
      `SELECT c.column_id, COALESCE(MAX(c.position), -1) as max_pos
       FROM cards c INNER JOIN columns col ON c.column_id = col.id
       WHERE col.board_id = $1 GROUP BY c.column_id`,
      [boardId]
    );
    const maxPositions = new Map(positionsResult.rows.map((r: any) => [r.column_id, r.max_pos]));

    const client = await pool.connect();
    const errors: { row: number; field: string; message: string }[] = [];
    let created = 0;

    try {
      await client.query('BEGIN');

      for (let i = 0; i < pending.rows.length; i++) {
        const row = pending.rows[i];
        const rowNum = i + 2; // +2 for 1-indexed + header row

        // Extract mapped values
        let title = '';
        let description = '';
        let columnName = '';
        let assigneesStr = '';
        let labelsStr = '';
        let dueDate: string | null = null;
        let startDate: string | null = null;
        let position: number | null = null;
        const customFieldValues: { fieldId: string; value: string }[] = [];

        for (const [header, field] of Object.entries(mapping)) {
          if (field === 'skip') continue;
          const value = (row[header] || '').trim();
          if (!value) continue;

          switch (field) {
            case 'title': title = value; break;
            case 'description': description = value; break;
            case 'column': columnName = value; break;
            case 'assignees': assigneesStr = value; break;
            case 'labels': labelsStr = value; break;
            case 'due_date': {
              const d = new Date(value);
              if (isNaN(d.getTime())) {
                errors.push({ row: rowNum, field: 'due_date', message: `Invalid date: "${value}"` });
              } else {
                dueDate = d.toISOString().split('T')[0];
              }
              break;
            }
            case 'start_date': {
              const d = new Date(value);
              if (isNaN(d.getTime())) {
                errors.push({ row: rowNum, field: 'start_date', message: `Invalid date: "${value}"` });
              } else {
                startDate = d.toISOString().split('T')[0];
              }
              break;
            }
            case 'position': {
              const p = parseInt(value, 10);
              if (!isNaN(p)) position = p;
              break;
            }
            default: {
              if (field.startsWith('custom:')) {
                customFieldValues.push({ fieldId: field.slice(7), value });
              }
            }
          }
        }

        // Skip rows with no title
        if (!title) {
          errors.push({ row: rowNum, field: 'title', message: 'Missing title, row skipped' });
          continue;
        }

        // Validate title length
        if (title.length > 255) {
          title = title.substring(0, 255);
          errors.push({ row: rowNum, field: 'title', message: 'Title truncated to 255 characters' });
        }

        // Validate description length
        if (description.length > 10000) {
          description = description.substring(0, 10000);
          errors.push({ row: rowNum, field: 'description', message: 'Description truncated to 10000 characters' });
        }

        // Resolve column
        const columnId = columnName ? (columnByName.get(columnName.toLowerCase()) || firstColumnId) : firstColumnId;
        if (columnName && !columnByName.has(columnName.toLowerCase())) {
          errors.push({ row: rowNum, field: 'column', message: `Column "${columnName}" not found, using "${columns[0].name}"` });
        }

        // Determine position
        if (position === null) {
          const maxPos = maxPositions.get(columnId) ?? -1;
          position = maxPos + 1;
          maxPositions.set(columnId, position);
        }

        // Insert card
        const cardResult = await client.query(
          `INSERT INTO cards (column_id, title, description, position, due_date, start_date)
           VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
          [columnId, title, description, position, dueDate, startDate]
        );
        const cardId = cardResult.rows[0].id;

        // Handle assignees (comma-separated)
        if (assigneesStr) {
          const names = assigneesStr.split(',').map(n => n.trim()).filter(Boolean);
          for (const name of names) {
            // Auto-create board assignee if not exists
            if (!assigneeSet.has(name.toLowerCase())) {
              await client.query(
                'INSERT INTO board_assignees (board_id, name) VALUES ($1, $2) ON CONFLICT DO NOTHING',
                [boardId, name]
              );
              assigneeSet.add(name.toLowerCase());
            }
            await client.query(
              'INSERT INTO card_assignees (card_id, assignee_name) VALUES ($1, $2) ON CONFLICT DO NOTHING',
              [cardId, name]
            );
          }
        }

        // Handle labels (comma-separated)
        if (labelsStr) {
          const labelNames = labelsStr.split(',').map(n => n.trim()).filter(Boolean);
          for (const labelName of labelNames) {
            let labelId = labelByName.get(labelName.toLowerCase());
            if (!labelId) {
              // Auto-create label with a default color
              const colors = ['#5746af', '#2563eb', '#059669', '#d97706', '#dc2626', '#7c3aed', '#0891b2'];
              const color = colors[labelByName.size % colors.length];
              const newLabel = await client.query(
                'INSERT INTO board_labels (board_id, name, color) VALUES ($1, $2, $3) RETURNING id',
                [boardId, labelName, color]
              );
              labelId = newLabel.rows[0].id;
              labelByName.set(labelName.toLowerCase(), labelId);
            }
            await client.query(
              'INSERT INTO card_labels (card_id, label_id) VALUES ($1, $2) ON CONFLICT DO NOTHING',
              [cardId, labelId]
            );
          }
        }

        // Handle custom field values
        for (const { fieldId, value } of customFieldValues) {
          await client.query(
            `INSERT INTO card_custom_field_values (card_id, field_id, value)
             VALUES ($1, $2, $3)
             ON CONFLICT (card_id, field_id) DO UPDATE SET value = $3, updated_at = NOW()`,
            [cardId, fieldId, value]
          );
        }

        created++;
      }

      await client.query('COMMIT');
    } catch (txError) {
      await client.query('ROLLBACK');
      throw txError;
    } finally {
      client.release();
    }

    // Emit socket update so board refreshes
    const io = req.app.get('io');
    io.to(`board:${boardId}`).emit('board-updated');

    res.json({ created, errors });
  } catch (error) {
    console.error('CSV import confirm error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});
```

**Step 2: Build and verify**

Run: `cd /home/bradley/cork/server && npx tsc --noEmit`
Expected: No errors

**Step 3: Commit**

```bash
git add server/src/routes/csv.ts
git commit -m "feat: add CSV import confirm endpoint with auto-create labels/assignees"
```

---

### Task 6: Create CSV import modal component

**Files:**
- Create: `client/src/components/CSVImportModal.tsx`

**Step 1: Create the modal component**

Create `client/src/components/CSVImportModal.tsx`:

```tsx
import { useState, useRef } from 'react';
import { api } from '../api';

interface CSVImportModalProps {
  boardId: string;
  onClose: () => void;
  onImportComplete: () => void;
}

interface PreviewData {
  importId: string;
  headers: string[];
  suggestedMapping: Record<string, string>;
  sampleRows: Record<string, string>[];
  rowCount: number;
  customFields: { id: string; name: string; field_type: string }[];
}

const PLANK_FIELDS = [
  { value: 'skip', label: 'Skip' },
  { value: 'title', label: 'Title' },
  { value: 'description', label: 'Description' },
  { value: 'column', label: 'Column' },
  { value: 'assignees', label: 'Assignees' },
  { value: 'labels', label: 'Labels' },
  { value: 'due_date', label: 'Due Date' },
  { value: 'start_date', label: 'Start Date' },
  { value: 'position', label: 'Position' },
];

export default function CSVImportModal({ boardId, onClose, onImportComplete }: CSVImportModalProps) {
  const [step, setStep] = useState<'upload' | 'map'>('upload');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [preview, setPreview] = useState<PreviewData | null>(null);
  const [mapping, setMapping] = useState<Record<string, string>>({});
  const [dragOver, setDragOver] = useState(false);
  const [importResult, setImportResult] = useState<{ created: number; errors: { row: number; field: string; message: string }[] } | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleFile = async (file: File) => {
    if (!file.name.toLowerCase().endsWith('.csv')) {
      setError('Please select a CSV file');
      return;
    }
    if (file.size > 5 * 1024 * 1024) {
      setError('File size must be under 5MB');
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const formData = new FormData();
      formData.append('file', file);

      const token = api.getToken();
      const response = await fetch(`/api/boards/${boardId}/csv/import/preview`, {
        method: 'POST',
        headers: token ? { 'Authorization': `Bearer ${token}` } : {},
        body: formData,
      });

      if (!response.ok) {
        const err = await response.json().catch(() => ({ error: 'Upload failed' }));
        throw new Error(err.error || 'Upload failed');
      }

      const data: PreviewData = await response.json();
      setPreview(data);
      setMapping(data.suggestedMapping);
      setStep('map');
    } catch (err: any) {
      setError(err.message || 'Failed to parse CSV');
    } finally {
      setLoading(false);
    }
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    const file = e.dataTransfer.files[0];
    if (file) handleFile(file);
  };

  const handleConfirm = async () => {
    if (!preview) return;

    setLoading(true);
    setError(null);

    try {
      const token = api.getToken();
      const response = await fetch(`/api/boards/${boardId}/csv/import/confirm`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { 'Authorization': `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({ importId: preview.importId, mapping }),
      });

      if (!response.ok) {
        const err = await response.json().catch(() => ({ error: 'Import failed' }));
        throw new Error(err.error || 'Import failed');
      }

      const result = await response.json();
      setImportResult(result);

      // Auto-close after showing result
      setTimeout(() => {
        onImportComplete();
        onClose();
      }, 3000);
    } catch (err: any) {
      setError(err.message || 'Import failed');
    } finally {
      setLoading(false);
    }
  };

  const updateMapping = (header: string, field: string) => {
    setMapping(prev => ({ ...prev, [header]: field }));
  };

  // Build field options including custom fields
  const fieldOptions = [
    ...PLANK_FIELDS,
    ...(preview?.customFields || []).map(cf => ({
      value: `custom:${cf.id}`,
      label: cf.name,
    })),
  ];

  const mappedTitleCount = Object.values(mapping).filter(v => v === 'title').length;

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className={`modal ${step === 'map' ? 'modal-csv-import' : ''}`} onClick={(e) => e.stopPropagation()}>
        <h2>Import Cards from CSV</h2>

        {step === 'upload' && (
          <>
            <p className="modal-subtitle">Upload a CSV file to import cards into this board.</p>
            <div
              className={`csv-drop-zone${dragOver ? ' drag-over' : ''}`}
              onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
              onDragLeave={() => setDragOver(false)}
              onDrop={handleDrop}
              onClick={() => fileInputRef.current?.click()}
            >
              <input
                ref={fileInputRef}
                type="file"
                accept=".csv"
                onChange={(e) => e.target.files?.[0] && handleFile(e.target.files[0])}
                style={{ display: 'none' }}
              />
              {loading ? (
                <div className="loading-inline"><div className="spinner"></div></div>
              ) : (
                <>
                  <p style={{ margin: '0 0 0.5rem', fontWeight: 500 }}>Drop CSV file here</p>
                  <p style={{ margin: 0, fontSize: '0.8rem', color: 'var(--text-secondary)' }}>or click to browse (max 5MB)</p>
                </>
              )}
            </div>
          </>
        )}

        {step === 'map' && preview && !importResult && (
          <>
            <p className="modal-subtitle">{preview.rowCount} rows found. Map CSV columns to card fields.</p>

            <div className="csv-mapping-table">
              <div className="csv-mapping-header">
                <span>CSV Column</span>
                <span>Maps To</span>
              </div>
              {preview.headers.map(header => (
                <div key={header} className={`csv-mapping-row${mapping[header] !== 'skip' ? ' mapped' : ''}`}>
                  <span className="csv-header-name">{header}</span>
                  <select
                    value={mapping[header] || 'skip'}
                    onChange={(e) => updateMapping(header, e.target.value)}
                  >
                    {fieldOptions.map(opt => (
                      <option key={opt.value} value={opt.value}>{opt.label}</option>
                    ))}
                  </select>
                </div>
              ))}
            </div>

            {preview.sampleRows.length > 0 && (
              <div className="csv-preview">
                <p style={{ fontWeight: 500, fontSize: '0.85rem', marginBottom: '0.5rem' }}>Preview (first {preview.sampleRows.length} rows)</p>
                <div className="csv-preview-scroll">
                  <table>
                    <thead>
                      <tr>
                        {preview.headers.filter(h => mapping[h] !== 'skip').map(h => (
                          <th key={h}>{fieldOptions.find(f => f.value === mapping[h])?.label || h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {preview.sampleRows.map((row, i) => (
                        <tr key={i}>
                          {preview.headers.filter(h => mapping[h] !== 'skip').map(h => (
                            <td key={h}>{row[h] || ''}</td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </>
        )}

        {importResult && (
          <div className="csv-import-result">
            <p style={{ fontWeight: 600, fontSize: '1.1rem', color: 'var(--primary)' }}>
              Imported {importResult.created} card{importResult.created !== 1 ? 's' : ''}
            </p>
            {importResult.errors.length > 0 && (
              <div className="csv-import-warnings">
                <p style={{ fontWeight: 500, fontSize: '0.85rem', marginBottom: '0.25rem' }}>{importResult.errors.length} warning{importResult.errors.length !== 1 ? 's' : ''}:</p>
                <ul>
                  {importResult.errors.slice(0, 10).map((err, i) => (
                    <li key={i}>Row {err.row}: {err.message}</li>
                  ))}
                  {importResult.errors.length > 10 && <li>...and {importResult.errors.length - 10} more</li>}
                </ul>
              </div>
            )}
          </div>
        )}

        {error && (
          <div className="csv-error">{error}</div>
        )}

        <div className="modal-actions">
          {step === 'map' && !importResult && (
            <button onClick={() => { setStep('upload'); setPreview(null); setError(null); }} className="btn-secondary" style={{ marginRight: 'auto' }}>
              Back
            </button>
          )}
          <button onClick={onClose} className="btn-secondary">
            {importResult ? 'Close' : 'Cancel'}
          </button>
          {step === 'map' && !importResult && (
            <button
              onClick={handleConfirm}
              className="btn-primary"
              disabled={loading || mappedTitleCount !== 1}
            >
              {loading ? 'Importing...' : `Import ${preview?.rowCount || 0} Cards`}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
```

**Step 2: Verify build**

Run: `cd /home/bradley/cork/client && npx tsc --noEmit`
Expected: No errors

**Step 3: Commit**

```bash
git add client/src/components/CSVImportModal.tsx
git commit -m "feat: add CSV import modal with drag-drop, column mapping, and preview"
```

---

### Task 7: Wire up CSV import modal in KanbanBoard

**Files:**
- Modify: `client/src/components/KanbanBoard.tsx` (import component, add state, add menu button, render modal)

**Step 1: Add import and state**

In `client/src/components/KanbanBoard.tsx`, add import after line 17:

```typescript
import CSVImportModal from './CSVImportModal';
```

Add state near line 48 (after `showSettingsDropdown`):

```typescript
const [showCsvImport, setShowCsvImport] = useState(false);
```

**Step 2: Add Import CSV button to board settings menu**

In the board-settings-menu, after the "Export CSV" button added in Task 3:

```jsx
<button onClick={() => { setShowCsvImport(true); setShowSettingsDropdown(false); setMobileMenuOpen(false); }}>Import CSV</button>
```

**Step 3: Render the modal**

After the `CustomFieldManager` modal rendering (after line 995), add:

```jsx
{showCsvImport && (
  <CSVImportModal
    boardId={boardId}
    onClose={() => setShowCsvImport(false)}
    onImportComplete={() => loadBoard()}
  />
)}
```

**Step 4: Verify build**

Run: `cd /home/bradley/cork/client && npx tsc --noEmit`
Expected: No errors

**Step 5: Commit**

```bash
git add client/src/components/KanbanBoard.tsx
git commit -m "feat: wire up CSV import modal in board settings menu"
```

---

### Task 8: Add CSS for CSV import modal

**Files:**
- Modify: `client/src/index.css` (add CSV-specific styles)

**Step 1: Add CSS at the end of index.css**

```css
/* CSV Import Modal */
.modal-csv-import {
  max-width: 640px;
}

.csv-drop-zone {
  border: 2px dashed var(--border);
  border-radius: var(--radius);
  padding: 2.5rem 1.5rem;
  text-align: center;
  cursor: pointer;
  transition: all 0.2s var(--ease);
  margin-bottom: 1rem;
}

.csv-drop-zone:hover,
.csv-drop-zone.drag-over {
  border-color: var(--primary);
  background: rgba(87, 70, 175, 0.04);
}

.csv-mapping-table {
  margin-bottom: 1rem;
  max-height: 240px;
  overflow-y: auto;
}

.csv-mapping-header {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 0.75rem;
  padding: 0.5rem 0;
  font-size: 0.75rem;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  color: var(--text-secondary);
  border-bottom: 1px solid var(--border);
}

.csv-mapping-row {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 0.75rem;
  align-items: center;
  padding: 0.4rem 0;
  border-bottom: 1px solid var(--border-light, rgba(0,0,0,0.06));
}

.csv-mapping-row.mapped {
  background: rgba(87, 70, 175, 0.03);
}

.csv-header-name {
  font-size: 0.85rem;
  font-weight: 500;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.csv-mapping-row select {
  font-size: 0.85rem;
  padding: 0.3rem 0.5rem;
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  background: var(--card-bg);
}

.csv-preview {
  margin-bottom: 1rem;
}

.csv-preview-scroll {
  overflow-x: auto;
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
}

.csv-preview table {
  width: 100%;
  border-collapse: collapse;
  font-size: 0.8rem;
}

.csv-preview th {
  background: var(--bg);
  font-weight: 600;
  text-align: left;
  padding: 0.4rem 0.6rem;
  border-bottom: 1px solid var(--border);
  white-space: nowrap;
}

.csv-preview td {
  padding: 0.35rem 0.6rem;
  border-bottom: 1px solid var(--border-light, rgba(0,0,0,0.06));
  max-width: 200px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.csv-import-result {
  text-align: center;
  padding: 1.5rem 0;
}

.csv-import-warnings {
  text-align: left;
  margin-top: 1rem;
  font-size: 0.8rem;
  color: var(--text-secondary);
}

.csv-import-warnings ul {
  margin: 0;
  padding-left: 1.25rem;
}

.csv-import-warnings li {
  margin-bottom: 0.15rem;
}

.csv-error {
  padding: 0.6rem 1rem;
  border-radius: var(--radius-sm);
  font-size: 0.85rem;
  background: rgba(197, 48, 48, 0.08);
  color: var(--danger);
  border-left: 3px solid var(--danger);
  margin-bottom: 1rem;
}

@media (max-width: 768px) {
  .modal-csv-import {
    max-width: 100%;
  }

  .csv-mapping-table {
    max-height: 200px;
  }
}
```

**Step 2: Verify build**

Run: `cd /home/bradley/cork/client && npx tsc --noEmit`
Expected: No errors

**Step 3: Commit**

```bash
git add client/src/index.css
git commit -m "feat: add CSS for CSV import modal, mapping table, and preview"
```

---

### Task 9: Manual testing and polish

**Step 1: Start the dev environment**

Run: `cd /home/bradley/cork && docker-compose up -d` (or however the dev env starts)

**Step 2: Test CSV export**

- Navigate to any board with cards
- Click Board menu > Export CSV
- Verify CSV downloads with correct filename (`board-name-YYYY-MM-DD.csv`)
- Open in a spreadsheet — verify all columns present, data accurate, custom fields included
- Verify archived cards are excluded

**Step 3: Test CSV import — happy path**

- Create a test CSV file with headers: `Title,Description,Column,Assignees,Labels,Due Date`
- Add 3-5 test rows with valid data
- Click Board menu > Import CSV
- Upload file, verify auto-mapping, check preview table
- Confirm import, verify cards created in correct columns
- Verify new labels/assignees auto-created

**Step 4: Test CSV import — edge cases**

- File with no Title column mapped → should show disabled Import button
- File with invalid dates → should show warnings but still create cards
- File with unknown column names → should default to first column
- Empty file → should show error
- File > 5MB → should show error
- Non-CSV file → should show error
- Re-upload after expired session → should show helpful message

**Step 5: Test round-trip**

- Export a board to CSV
- Import the CSV into a different board (or the same board)
- Verify all fields preserved correctly

**Step 6: Commit any fixes**

```bash
git add -A
git commit -m "fix: CSV import/export polish from manual testing"
```
