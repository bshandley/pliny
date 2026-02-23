# Custom Fields Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add board-scoped custom fields (text, number, date, dropdown, checkbox) with a field manager modal, inline card editors, collapsed card badges, and filter bar integration.

**Architecture:** Two new tables (`board_custom_fields` and `card_custom_field_values`) store field definitions and per-card values. A new Express route file handles CRUD for field definitions and bulk value updates. The existing board fetch in `server/src/routes/boards.ts` GET /:id (lines 37–174) is extended with two new queries to hydrate custom fields into the board and card responses. On the client, a `CustomFieldManager` modal (triggered from board settings) manages field definitions, while `CustomFieldEditor` renders type-specific inputs in the card detail view. Collapsed cards show `show_on_card` field values as compact badges.

**Tech Stack:** React, TypeScript, Express, PostgreSQL, existing API patterns (`pool.query` with `$N` params), existing modal/filter patterns from KanbanBoard.

---

### Task 1: Create Migration 012 — Custom Fields Schema

**Files:**
- Create: `server/src/migrations/012-custom-fields.sql`
- Modify: `server/src/migrations/run.ts`

**Step 1: Write the migration SQL**

Create `server/src/migrations/012-custom-fields.sql`:

```sql
-- Migration 012: Custom Fields

CREATE TABLE IF NOT EXISTS board_custom_fields (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  board_id UUID NOT NULL REFERENCES boards(id) ON DELETE CASCADE,
  name VARCHAR(100) NOT NULL,
  field_type VARCHAR(20) NOT NULL,
  options JSONB,
  position INTEGER NOT NULL DEFAULT 0,
  show_on_card BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT chk_field_type CHECK (field_type IN ('text', 'number', 'date', 'dropdown', 'checkbox'))
);

CREATE TABLE IF NOT EXISTS card_custom_field_values (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  card_id UUID NOT NULL REFERENCES cards(id) ON DELETE CASCADE,
  field_id UUID NOT NULL REFERENCES board_custom_fields(id) ON DELETE CASCADE,
  value TEXT,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT uq_card_field UNIQUE (card_id, field_id)
);

CREATE INDEX IF NOT EXISTS idx_custom_fields_board ON board_custom_fields(board_id);
CREATE INDEX IF NOT EXISTS idx_custom_field_values_card ON card_custom_field_values(card_id);
CREATE INDEX IF NOT EXISTS idx_custom_field_values_field ON card_custom_field_values(field_id);
```

**Step 2: Register in run.ts**

In `server/src/migrations/run.ts`, add a new block at the end of the `try` block (after the existing migration 011 block, before the `console.log` on line 84):

```typescript
// Custom fields
const customFields = fs.readFileSync(
  path.join(__dirname, '012-custom-fields.sql'),
  'utf-8'
);
await pool.query(customFields);
```

**Step 3: Commit**

```bash
git add server/src/migrations/012-custom-fields.sql server/src/migrations/run.ts
git commit -m "feat: Add migration 012 for custom fields schema"
```

---

### Task 2: Create Custom Fields API Routes

**Files:**
- Create: `server/src/routes/customFields.ts`
- Modify: `server/src/index.ts`

**Step 1: Create the route file**

Follow the pattern from `server/src/routes/checklists.ts` — Router with `authenticate` middleware, `pool.query` with `$N` params.

```typescript
import { Router, Request, Response } from 'express';
import pool from '../db';
import { authenticate, requireAdmin } from '../middleware/auth';

const router = Router();

// GET /boards/:boardId/custom-fields — list field definitions
router.get('/boards/:boardId/custom-fields', authenticate, async (req: Request, res: Response) => {
  const { boardId } = req.params;
  const result = await pool.query(
    'SELECT * FROM board_custom_fields WHERE board_id = $1 ORDER BY position',
    [boardId]
  );
  res.json(result.rows);
});

// POST /boards/:boardId/custom-fields — create field definition (admin only)
router.post('/boards/:boardId/custom-fields', authenticate, requireAdmin, async (req: Request, res: Response) => {
  const { boardId } = req.params;
  const { name, field_type, options, show_on_card } = req.body;

  if (!name || !name.trim()) return res.status(400).json({ error: 'Name is required' });
  if (name.length > 100) return res.status(400).json({ error: 'Name must be 100 characters or less' });
  if (!['text', 'number', 'date', 'dropdown', 'checkbox'].includes(field_type)) {
    return res.status(400).json({ error: 'Invalid field type' });
  }
  if (field_type === 'dropdown' && (!Array.isArray(options) || options.length === 0)) {
    return res.status(400).json({ error: 'Dropdown fields require at least one option' });
  }

  // Get next position
  const posResult = await pool.query(
    'SELECT COALESCE(MAX(position), -1) + 1 as next_pos FROM board_custom_fields WHERE board_id = $1',
    [boardId]
  );
  const position = posResult.rows[0].next_pos;

  const result = await pool.query(
    `INSERT INTO board_custom_fields (board_id, name, field_type, options, position, show_on_card)
     VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
    [boardId, name.trim(), field_type, field_type === 'dropdown' ? JSON.stringify(options) : null, position, show_on_card || false]
  );
  res.status(201).json(result.rows[0]);
});

// PUT /custom-fields/:fieldId — update field definition (admin only)
router.put('/custom-fields/:fieldId', authenticate, requireAdmin, async (req: Request, res: Response) => {
  const { fieldId } = req.params;
  const { name, options, position, show_on_card } = req.body;

  const updates: string[] = [];
  const values: any[] = [];
  let paramCount = 1;

  if (name !== undefined) {
    if (!name.trim()) return res.status(400).json({ error: 'Name is required' });
    if (name.length > 100) return res.status(400).json({ error: 'Name must be 100 characters or less' });
    updates.push(`name = $${paramCount++}`);
    values.push(name.trim());
  }
  if (options !== undefined) {
    updates.push(`options = $${paramCount++}`);
    values.push(JSON.stringify(options));
  }
  if (position !== undefined) {
    updates.push(`position = $${paramCount++}`);
    values.push(position);
  }
  if (show_on_card !== undefined) {
    updates.push(`show_on_card = $${paramCount++}`);
    values.push(show_on_card);
  }

  if (updates.length === 0) return res.status(400).json({ error: 'No fields to update' });

  values.push(fieldId);
  const result = await pool.query(
    `UPDATE board_custom_fields SET ${updates.join(', ')} WHERE id = $${paramCount} RETURNING *`,
    values
  );
  if (result.rows.length === 0) return res.status(404).json({ error: 'Field not found' });
  res.json(result.rows[0]);
});

// DELETE /custom-fields/:fieldId — delete field + all values (admin only)
router.delete('/custom-fields/:fieldId', authenticate, requireAdmin, async (req: Request, res: Response) => {
  const { fieldId } = req.params;
  const result = await pool.query('DELETE FROM board_custom_fields WHERE id = $1 RETURNING id', [fieldId]);
  if (result.rows.length === 0) return res.status(404).json({ error: 'Field not found' });
  res.json({ success: true });
});

// GET /cards/:cardId/custom-fields — get field values for a card
router.get('/cards/:cardId/custom-fields', authenticate, async (req: Request, res: Response) => {
  const { cardId } = req.params;
  const result = await pool.query(
    `SELECT v.*, f.name, f.field_type, f.options
     FROM card_custom_field_values v
     JOIN board_custom_fields f ON v.field_id = f.id
     WHERE v.card_id = $1
     ORDER BY f.position`,
    [cardId]
  );
  res.json(result.rows);
});

// PUT /cards/:cardId/custom-fields — bulk set field values
router.put('/cards/:cardId/custom-fields', authenticate, requireAdmin, async (req: Request, res: Response) => {
  const { cardId } = req.params;
  const fields = req.body; // { fieldId: value, fieldId: value, ... }

  for (const [fieldId, value] of Object.entries(fields)) {
    if (value === null || value === '') {
      await pool.query('DELETE FROM card_custom_field_values WHERE card_id = $1 AND field_id = $2', [cardId, fieldId]);
    } else {
      await pool.query(
        `INSERT INTO card_custom_field_values (card_id, field_id, value)
         VALUES ($1, $2, $3)
         ON CONFLICT (card_id, field_id)
         DO UPDATE SET value = $3, updated_at = CURRENT_TIMESTAMP`,
        [cardId, fieldId, String(value)]
      );
    }
  }
  res.json({ success: true });
});

export default router;
```

**Step 2: Mount routes in index.ts**

In `server/src/index.ts`, add after the existing route mounts (around line 54):

```typescript
import customFieldRoutes from './routes/customFields';
// ...
app.use('/api', customFieldRoutes);
```

**Step 3: Commit**

```bash
git add server/src/routes/customFields.ts server/src/index.ts
git commit -m "feat: Add custom fields API routes"
```

---

### Task 3: Extend Board Fetch to Include Custom Fields

**Files:**
- Modify: `server/src/routes/boards.ts`

**Step 1: Add custom field queries to GET /:id**

In `server/src/routes/boards.ts`, after the existing card_members query (around line 107), add two new queries:

```typescript
// Query 7: Custom field definitions for this board
const customFieldsResult = await pool.query(
  'SELECT * FROM board_custom_fields WHERE board_id = $1 ORDER BY position',
  [id]
);

// Query 8: Custom field values for all cards in this board
const customFieldValuesResult = await pool.query(
  `SELECT v.card_id, v.field_id, v.value, f.name, f.field_type
   FROM card_custom_field_values v
   JOIN board_custom_fields f ON v.field_id = f.id
   WHERE f.board_id = $1`,
  [id]
);
```

**Step 2: Build grouping map**

After the existing grouping maps (around line 151), add:

```typescript
const customFieldValuesByCard: Record<string, Record<string, { value: string; field_type: string; name: string }>> = {};
customFieldValuesResult.rows.forEach((row: any) => {
  if (!customFieldValuesByCard[row.card_id]) customFieldValuesByCard[row.card_id] = {};
  customFieldValuesByCard[row.card_id][row.field_id] = {
    value: row.value,
    field_type: row.field_type,
    name: row.name,
  };
});
```

**Step 3: Add to card assembly**

In the card mapping (around line 155), add:

```typescript
custom_field_values: customFieldValuesByCard[card.id] || {},
```

**Step 4: Add custom_fields to board response**

In the response object (around line 168), add:

```typescript
custom_fields: customFieldsResult.rows,
```

**Step 5: Commit**

```bash
git add server/src/routes/boards.ts
git commit -m "feat: Extend board fetch to include custom fields and values"
```

---

### Task 4: Add Client Types and API Methods

**Files:**
- Modify: `client/src/types.ts`
- Modify: `client/src/api.ts`

**Step 1: Add TypeScript interfaces**

In `client/src/types.ts`, add after the existing `Notification` interface (line 89):

```typescript
export interface CustomField {
  id: string;
  board_id: string;
  name: string;
  field_type: 'text' | 'number' | 'date' | 'dropdown' | 'checkbox';
  options: string[] | null;
  position: number;
  show_on_card: boolean;
}

export interface CustomFieldValue {
  value: string;
  field_type: string;
  name: string;
}
```

Update the `Board` interface (line 11) to include:

```typescript
custom_fields?: CustomField[];
```

Update the `Card` interface (line 91) to include:

```typescript
custom_field_values?: Record<string, CustomFieldValue>;
```

**Step 2: Add API methods**

In `client/src/api.ts`, add a new section after the existing checklist methods (around line 256):

```typescript
// Custom Fields
async getCustomFields(boardId: string): Promise<CustomField[]> {
  return this.fetch(`/boards/${boardId}/custom-fields`);
}

async createCustomField(boardId: string, data: { name: string; field_type: string; options?: string[]; show_on_card?: boolean }): Promise<CustomField> {
  return this.fetch(`/boards/${boardId}/custom-fields`, {
    method: 'POST',
    body: JSON.stringify(data),
  });
}

async updateCustomField(fieldId: string, data: Partial<{ name: string; options: string[]; position: number; show_on_card: boolean }>): Promise<CustomField> {
  return this.fetch(`/custom-fields/${fieldId}`, {
    method: 'PUT',
    body: JSON.stringify(data),
  });
}

async deleteCustomField(fieldId: string): Promise<void> {
  return this.fetch(`/custom-fields/${fieldId}`, { method: 'DELETE' });
}

async getCardCustomFields(cardId: string): Promise<any[]> {
  return this.fetch(`/cards/${cardId}/custom-fields`);
}

async setCardCustomFields(cardId: string, values: Record<string, string | null>): Promise<void> {
  return this.fetch(`/cards/${cardId}/custom-fields`, {
    method: 'PUT',
    body: JSON.stringify(values),
  });
}
```

Add the import for `CustomField` at the top of `api.ts`.

**Step 3: Commit**

```bash
git add client/src/types.ts client/src/api.ts
git commit -m "feat: Add custom field types and API methods"
```

---

### Task 5: Create Custom Field Manager Modal

**Files:**
- Create: `client/src/components/CustomFieldManager.tsx`
- Modify: `client/src/components/KanbanBoard.tsx`
- Modify: `client/src/index.css`

**Step 1: Create CustomFieldManager component**

Follow the same modal pattern as the existing label management. The component receives the board's custom fields array, and provides CRUD operations:

```typescript
import { useState } from 'react';
import { CustomField } from '../types';
import { api } from '../api';

interface CustomFieldManagerProps {
  boardId: string;
  fields: CustomField[];
  onClose: () => void;
  onFieldsChanged: () => void;
}
```

**Modal structure:**
- Header: "Custom Fields" + close button (same pattern as label manager)
- List of existing fields, each row showing: name, type badge, "Show on card" toggle, edit/delete buttons
- For dropdown-type fields in edit mode: options list with add/remove
- "Add field" row at bottom: name input + type `<select>` + "Add" button
- Delete triggers `window.confirm()` before calling `api.deleteCustomField()`

**Step 2: Add trigger in KanbanBoard**

In `client/src/components/KanbanBoard.tsx`, add state:

```typescript
const [showFieldManager, setShowFieldManager] = useState(false);
```

Add a "Custom Fields" button in the board settings dropdown or header actions area (near the existing filter/menu buttons around line 503). Render the modal conditionally:

```typescript
{showFieldManager && board && (
  <CustomFieldManager
    boardId={board.id}
    fields={board.custom_fields || []}
    onClose={() => setShowFieldManager(false)}
    onFieldsChanged={() => { loadBoard(); setShowFieldManager(false); }}
  />
)}
```

**Step 3: Add CSS**

```css
/* ---- Custom Field Manager ---- */

.field-manager-overlay {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.5);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 200;
}

.field-manager-modal {
  background: var(--card-bg);
  border-radius: var(--radius);
  box-shadow: var(--shadow-lg);
  width: 480px;
  max-width: 90vw;
  max-height: 80vh;
  display: flex;
  flex-direction: column;
}

.field-manager-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 1rem;
  border-bottom: 1px solid var(--border);
}

.field-manager-list {
  flex: 1;
  overflow-y: auto;
  padding: 0.5rem;
}

.field-row {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  padding: 0.5rem;
  border-radius: var(--radius-sm);
}

.field-row:hover {
  background: var(--bg-raised);
}

.field-type-badge {
  font-size: 0.65rem;
  font-weight: 600;
  text-transform: uppercase;
  padding: 0.125rem 0.375rem;
  border-radius: var(--radius-sm);
  background: var(--bg-raised);
  color: var(--text-secondary);
  letter-spacing: 0.04em;
}

.field-add-row {
  display: flex;
  gap: 0.5rem;
  padding: 0.75rem 1rem;
  border-top: 1px solid var(--border);
}
```

**Step 4: Commit**

```bash
git add client/src/components/CustomFieldManager.tsx client/src/components/KanbanBoard.tsx client/src/index.css
git commit -m "feat: Add custom field manager modal"
```

---

### Task 6: Add Custom Field Editors in Card Detail

**Files:**
- Create: `client/src/components/CustomFieldEditor.tsx`
- Modify: `client/src/components/KanbanCard.tsx`
- Modify: `client/src/index.css`

**Step 1: Create CustomFieldEditor component**

Renders type-specific inputs for a single custom field:

```typescript
interface CustomFieldEditorProps {
  field: CustomField;
  value: string | null;
  onChange: (value: string | null) => void;
  readOnly: boolean;
}
```

**Type-specific editors:**
- `text`: `<input type="text">` — save on blur
- `number`: `<input type="number">` — save on blur
- `date`: `<input type="date">` — same native date picker pattern as due date
- `dropdown`: `<select>` with field.options as `<option>` elements — save on change
- `checkbox`: `<input type="checkbox">` — save on change

Read-only mode: display the value as text (no input).

**Step 2: Render in KanbanCard detail view**

In `client/src/components/KanbanCard.tsx`, within `renderEditFields()` (around line 611), add a "Custom Fields" section below the description and above the checklist section. Use the board's `custom_fields` array (passed as a prop) and the card's `custom_field_values`:

```tsx
{board?.custom_fields && board.custom_fields.length > 0 && (
  <div className="custom-fields-section">
    <h4 className="section-label">Custom Fields</h4>
    {board.custom_fields.map(field => (
      <div key={field.id} className="custom-field-row">
        <label className="custom-field-label">{field.name}</label>
        <CustomFieldEditor
          field={field}
          value={card.custom_field_values?.[field.id]?.value || null}
          onChange={(val) => handleCustomFieldChange(field.id, val)}
          readOnly={!canWrite}
        />
      </div>
    ))}
  </div>
)}
```

Add handler:

```typescript
const handleCustomFieldChange = async (fieldId: string, value: string | null) => {
  try {
    await api.setCardCustomFields(card.id, { [fieldId]: value });
    onUpdate();
  } catch (err) {
    console.error('Failed to update custom field:', err);
  }
};
```

**Step 3: Add CSS**

```css
/* ---- Custom Field Editors ---- */

.custom-fields-section {
  margin: 0.75rem 0;
}

.custom-field-row {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  padding: 0.25rem 0;
}

.custom-field-label {
  font-size: 0.8rem;
  font-weight: 500;
  color: var(--text-secondary);
  width: 120px;
  flex-shrink: 0;
}

.custom-field-input {
  flex: 1;
  font-size: 0.85rem;
  padding: 0.25rem 0.5rem;
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  background: var(--bg);
  color: var(--text);
}

.custom-field-value {
  font-size: 0.85rem;
  color: var(--text);
}
```

**Step 4: Commit**

```bash
git add client/src/components/CustomFieldEditor.tsx client/src/components/KanbanCard.tsx client/src/index.css
git commit -m "feat: Add custom field editors in card detail view"
```

---

### Task 7: Add Custom Field Badges to Collapsed Card

**Files:**
- Modify: `client/src/components/KanbanCard.tsx`
- Modify: `client/src/index.css`

**Step 1: Render badges in collapsed card**

In the collapsed card JSX (around line 1112, in the card footer area), add custom field badges for fields with `show_on_card: true`:

```tsx
{board?.custom_fields?.filter(f => f.show_on_card).slice(0, 3).map(field => {
  const val = card.custom_field_values?.[field.id];
  if (!val?.value) return null;
  return (
    <span key={field.id} className={`custom-field-badge field-type-${field.field_type}`}>
      {formatFieldBadge(field, val.value)}
    </span>
  );
})}
```

**Step 2: Add formatFieldBadge helper**

```typescript
function formatFieldBadge(field: CustomField, value: string): string {
  switch (field.field_type) {
    case 'text': return value.length > 20 ? value.slice(0, 20) + '...' : value;
    case 'number': return value;
    case 'date': {
      const d = new Date(value + 'T12:00:00');
      return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
    }
    case 'dropdown': return value;
    case 'checkbox': return value === 'true' ? '✓' : '✗';
    default: return value;
  }
}
```

**Step 3: Add badge CSS**

```css
.custom-field-badge {
  font-size: 0.65rem;
  padding: 0.0625rem 0.375rem;
  border-radius: var(--radius-sm);
  background: var(--bg-raised);
  color: var(--text-secondary);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  max-width: 100px;
}
```

**Step 4: Commit**

```bash
git add client/src/components/KanbanCard.tsx client/src/index.css
git commit -m "feat: Show custom field badges on collapsed cards"
```

---

### Task 8: Extend Filter Bar for Custom Fields

**Files:**
- Modify: `client/src/components/KanbanBoard.tsx`
- Modify: `client/src/index.css`

**Step 1: Add custom field filter state**

In KanbanBoard (around line 54, near existing filter state):

```typescript
const [customFieldFilters, setCustomFieldFilters] = useState<Record<string, string>>({});
```

**Step 2: Extend filterCard function**

In the `filterCard` function (lines 203–226), add custom field filtering after the existing checks:

```typescript
// Custom field filters
for (const [fieldId, filterValue] of Object.entries(customFieldFilters)) {
  if (!filterValue) continue;
  const cardValue = card.custom_field_values?.[fieldId]?.value;
  const field = board?.custom_fields?.find(f => f.id === fieldId);
  if (!field) continue;

  switch (field.field_type) {
    case 'text':
      if (!cardValue || !cardValue.toLowerCase().includes(filterValue.toLowerCase())) return false;
      break;
    case 'number':
      if (!cardValue || cardValue !== filterValue) return false;
      break;
    case 'dropdown':
      if (!cardValue || cardValue !== filterValue) return false;
      break;
    case 'checkbox':
      if (!cardValue || cardValue !== filterValue) return false;
      break;
    case 'date':
      if (!cardValue || cardValue !== filterValue) return false;
      break;
  }
}
```

**Step 3: Add filter UI**

In the filter bar area, add a "Custom Fields" dropdown that lists field definitions. Selecting a field shows a type-appropriate value input. Each active filter shows as a removable chip.

**Step 4: Commit**

```bash
git add client/src/components/KanbanBoard.tsx client/src/index.css
git commit -m "feat: Extend filter bar for custom field filtering"
```

---

### Task 9: Manual Testing Checklist

**No code changes — just verification.**

**Step 1: Test field management**
- Open field manager from board settings
- Create fields of each type (text, number, date, dropdown, checkbox)
- Edit field name and options
- Toggle "show on card"
- Delete a field → confirm values are removed

**Step 2: Test card detail editing**
- Open a card → custom fields section visible
- Set values for each field type
- Verify values persist on reload
- Non-admin users see read-only values

**Step 3: Test collapsed card badges**
- Set `show_on_card` on a field → badge appears on collapsed card
- Maximum 3 badges displayed
- Each type renders correctly (text truncated, date formatted, etc.)

**Step 4: Test filter bar**
- Select a custom field in filter dropdown
- Enter filter value → cards filter correctly
- Multiple field filters combine with AND logic
- Clear filters → all cards return

**Step 5: Test board fetch**
- Verify `custom_fields` array in board response
- Verify `custom_field_values` hydrated on each card
- No N+1 queries — single board fetch includes everything

**Step 6: Test edge cases**
- Dropdown field: set value, then remove that option from field → value persists (not auto-cleared)
- Delete field → all card values for that field removed
- New cards have no custom field values (empty object)
