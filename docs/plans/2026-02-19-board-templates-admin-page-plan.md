# Board Templates & Admin Page Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add board templates (JSON snapshot storage) and consolidate admin features into a tabbed admin page with Members, Templates, SSO, and General sections.

**Architecture:** New `board_templates` and `app_settings` tables (migration 015). New `AdminPage.tsx` wrapper replaces direct `UserManagement` rendering — it provides a left sidebar with tab navigation. Templates use JSONB snapshots of board structure. Built-in templates defined as server constants, seeded on startup.

**Tech Stack:** React + TypeScript frontend, Express + TypeScript backend, PostgreSQL 16

---

### Task 1: Migration 015 — board_templates + app_settings tables

**Files:**
- Create: `server/src/migrations/015-board-templates-app-settings.sql`

**Step 1: Write the migration**

```sql
-- Migration 015: Board templates and app settings

CREATE TABLE IF NOT EXISTS board_templates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name VARCHAR(255) NOT NULL,
  description TEXT,
  is_builtin BOOLEAN DEFAULT FALSE,
  data JSONB NOT NULL,
  created_by UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS app_settings (
  key VARCHAR(100) PRIMARY KEY,
  value JSONB NOT NULL,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

INSERT INTO app_settings (key, value)
VALUES ('registration_enabled', 'true'::jsonb)
ON CONFLICT (key) DO NOTHING;
```

**Step 2: Run migration on the dev database**

Run: `psql -U plank -d plank -f server/src/migrations/015-board-templates-app-settings.sql`
Expected: Tables created, setting inserted.

**Step 3: Commit**

```bash
git add server/src/migrations/015-board-templates-app-settings.sql
git commit -m "feat: add migration 015 for board_templates and app_settings tables"
```

---

### Task 2: Built-in template definitions

**Files:**
- Create: `server/src/templates/builtins.ts`

**Step 1: Create built-in template data**

```typescript
export interface TemplateData {
  columns: {
    name: string;
    position: number;
    cards: {
      title: string;
      description: string;
      position: number;
      checklist_items?: { text: string; position: number }[];
    }[];
  }[];
  labels: { name: string; color: string }[];
  custom_fields: {
    name: string;
    field_type: 'text' | 'number' | 'date' | 'dropdown' | 'checkbox';
    options?: string[];
    position: number;
    show_on_card: boolean;
  }[];
}

export interface BuiltinTemplate {
  name: string;
  description: string;
  data: TemplateData;
}

export const BUILTIN_TEMPLATES: BuiltinTemplate[] = [
  {
    name: 'Sprint Board',
    description: 'Agile sprint workflow with backlog, active work, review, and done columns.',
    data: {
      columns: [
        { name: 'Backlog', position: 0, cards: [
          { title: 'Define sprint goals', description: 'Outline what the team aims to accomplish this sprint.', position: 0, checklist_items: [
            { text: 'Review previous sprint outcomes', position: 0 },
            { text: 'Identify top priorities', position: 1 },
            { text: 'Set measurable goals', position: 2 },
          ]},
        ]},
        { name: 'In Progress', position: 1, cards: [] },
        { name: 'Review', position: 2, cards: [] },
        { name: 'Done', position: 3, cards: [] },
      ],
      labels: [
        { name: 'Feature', color: '#3b82f6' },
        { name: 'Bug', color: '#ef4444' },
        { name: 'Chore', color: '#8b5cf6' },
      ],
      custom_fields: [],
    },
  },
  {
    name: 'Bug Triage',
    description: 'Track bugs from report through resolution with severity labels.',
    data: {
      columns: [
        { name: 'Reported', position: 0, cards: [
          { title: 'Example bug report', description: 'Describe the issue, steps to reproduce, and expected behavior.', position: 0 },
        ]},
        { name: 'Confirmed', position: 1, cards: [] },
        { name: 'In Progress', position: 2, cards: [] },
        { name: 'Fixed', position: 3, cards: [] },
      ],
      labels: [
        { name: 'Critical', color: '#dc2626' },
        { name: 'Major', color: '#f97316' },
        { name: 'Minor', color: '#eab308' },
        { name: 'Cosmetic', color: '#6b7280' },
      ],
      custom_fields: [],
    },
  },
  {
    name: 'Project Tracker',
    description: 'Plan and track project phases from ideation to completion.',
    data: {
      columns: [
        { name: 'Ideas', position: 0, cards: [
          { title: 'Brainstorm features', description: 'Collect and evaluate potential features for the project.', position: 0 },
        ]},
        { name: 'Planning', position: 1, cards: [] },
        { name: 'Active', position: 2, cards: [] },
        { name: 'Complete', position: 3, cards: [] },
      ],
      labels: [
        { name: 'High Priority', color: '#ef4444' },
        { name: 'Medium Priority', color: '#f59e0b' },
        { name: 'Low Priority', color: '#22c55e' },
      ],
      custom_fields: [
        { name: 'Effort', field_type: 'dropdown', options: ['Small', 'Medium', 'Large'], position: 0, show_on_card: true },
      ],
    },
  },
];
```

**Step 2: Commit**

```bash
git add server/src/templates/builtins.ts
git commit -m "feat: add built-in board template definitions"
```

---

### Task 3: Template seeding on server startup

**Files:**
- Modify: `server/src/index.ts:42-58` (add import and seed call)
- Create: `server/src/templates/seed.ts`

**Step 1: Create the seed function**

Create `server/src/templates/seed.ts`:

```typescript
import pool from '../db';
import { BUILTIN_TEMPLATES } from './builtins';

export async function seedBuiltinTemplates() {
  for (const tpl of BUILTIN_TEMPLATES) {
    const exists = await pool.query(
      'SELECT 1 FROM board_templates WHERE name = $1 AND is_builtin = true',
      [tpl.name]
    );
    if (exists.rows.length === 0) {
      await pool.query(
        'INSERT INTO board_templates (name, description, is_builtin, data) VALUES ($1, $2, true, $3)',
        [tpl.name, tpl.description, JSON.stringify(tpl.data)]
      );
    }
  }
}
```

**Step 2: Call seed on startup**

In `server/src/index.ts`, add import at top with other imports:

```typescript
import { seedBuiltinTemplates } from './templates/seed';
```

Then in the listen callback (after `httpServer.listen`), call:

```typescript
seedBuiltinTemplates().catch(err => console.error('Failed to seed templates:', err));
```

**Step 3: Commit**

```bash
git add server/src/templates/seed.ts server/src/index.ts
git commit -m "feat: seed built-in templates on server startup"
```

---

### Task 4: Templates API routes

**Files:**
- Create: `server/src/routes/templates.ts`
- Modify: `server/src/index.ts` (mount route)

**Step 1: Create the templates router**

Create `server/src/routes/templates.ts`:

```typescript
import { Router } from 'express';
import pool from '../db';
import { authenticate, requireAdmin } from '../middleware/auth';
import { AuthRequest } from '../types';
import { TemplateData } from '../templates/builtins';

const router = Router();

// List all templates
router.get('/', authenticate, requireAdmin, async (_req: AuthRequest, res) => {
  try {
    const result = await pool.query(
      'SELECT id, name, description, is_builtin, data, created_by, created_at FROM board_templates ORDER BY is_builtin DESC, created_at'
    );
    // Add summary info (column count, card count) from data
    const templates = result.rows.map(row => {
      const data = row.data as TemplateData;
      return {
        ...row,
        column_count: data.columns?.length || 0,
        card_count: data.columns?.reduce((sum, col) => sum + (col.cards?.length || 0), 0) || 0,
      };
    });
    res.json(templates);
  } catch (error) {
    console.error('List templates error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Create template from a board
router.post('/', authenticate, requireAdmin, async (req: AuthRequest, res) => {
  try {
    const { board_id, name, description } = req.body;

    if (!name || name.length > 255) {
      return res.status(400).json({ error: 'Template name is required and must be 255 characters or fewer' });
    }
    if (description && description.length > 10000) {
      return res.status(400).json({ error: 'Description must be 10000 characters or fewer' });
    }

    let data: TemplateData;

    if (board_id) {
      // Snapshot from existing board
      data = await snapshotBoard(board_id);
    } else {
      return res.status(400).json({ error: 'board_id is required' });
    }

    const result = await pool.query(
      `INSERT INTO board_templates (name, description, is_builtin, data, created_by)
       VALUES ($1, $2, false, $3, $4) RETURNING *`,
      [name, description || null, JSON.stringify(data), req.user!.id]
    );

    res.status(201).json(result.rows[0]);
  } catch (error) {
    console.error('Create template error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Use template to create a new board
router.post('/:id/use', authenticate, requireAdmin, async (req: AuthRequest, res) => {
  try {
    const { id } = req.params;
    const { name, description } = req.body;

    if (!name || name.length > 255) {
      return res.status(400).json({ error: 'Board name is required and must be 255 characters or fewer' });
    }

    const tplResult = await pool.query('SELECT * FROM board_templates WHERE id = $1', [id]);
    if (tplResult.rows.length === 0) {
      return res.status(404).json({ error: 'Template not found' });
    }

    const data = tplResult.rows[0].data as TemplateData;
    const boardResult = await pool.query(
      'INSERT INTO boards (name, description, created_by) VALUES ($1, $2, $3) RETURNING *',
      [name, description || null, req.user!.id]
    );
    const board = boardResult.rows[0];

    // Create labels and build a name→id map for potential future use
    for (const label of (data.labels || [])) {
      await pool.query(
        'INSERT INTO board_labels (board_id, name, color) VALUES ($1, $2, $3)',
        [board.id, label.name, label.color]
      );
    }

    // Create custom fields
    for (const field of (data.custom_fields || [])) {
      await pool.query(
        'INSERT INTO board_custom_fields (board_id, name, field_type, options, position, show_on_card) VALUES ($1, $2, $3, $4, $5, $6)',
        [board.id, field.name, field.field_type, field.options ? JSON.stringify(field.options) : null, field.position, field.show_on_card]
      );
    }

    // Create columns and cards
    for (const col of (data.columns || [])) {
      const colResult = await pool.query(
        'INSERT INTO columns (board_id, name, position) VALUES ($1, $2, $3) RETURNING id',
        [board.id, col.name, col.position]
      );
      const columnId = colResult.rows[0].id;

      for (const card of (col.cards || [])) {
        const cardResult = await pool.query(
          'INSERT INTO cards (column_id, title, description, position) VALUES ($1, $2, $3, $4) RETURNING id',
          [columnId, card.title, card.description || '', card.position]
        );
        const cardId = cardResult.rows[0].id;

        for (const item of (card.checklist_items || [])) {
          await pool.query(
            'INSERT INTO card_checklist_items (card_id, text, position) VALUES ($1, $2, $3)',
            [cardId, item.text, item.position]
          );
        }
      }
    }

    res.status(201).json(board);
  } catch (error) {
    console.error('Use template error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Delete template (user-created only)
router.delete('/:id', authenticate, requireAdmin, async (_req: AuthRequest, res) => {
  try {
    const { id } = _req.params;
    const tpl = await pool.query('SELECT is_builtin FROM board_templates WHERE id = $1', [id]);
    if (tpl.rows.length === 0) {
      return res.status(404).json({ error: 'Template not found' });
    }
    if (tpl.rows[0].is_builtin) {
      return res.status(403).json({ error: 'Cannot delete built-in templates' });
    }
    await pool.query('DELETE FROM board_templates WHERE id = $1', [id]);
    res.json({ message: 'Template deleted' });
  } catch (error) {
    console.error('Delete template error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Helper: snapshot a board into TemplateData
async function snapshotBoard(boardId: string): Promise<TemplateData> {
  const colsResult = await pool.query(
    'SELECT name, position FROM columns WHERE board_id = $1 ORDER BY position', [boardId]
  );

  const columns = [];
  for (const col of colsResult.rows) {
    const cardsResult = await pool.query(
      `SELECT c.id, c.title, c.description, c.position FROM cards c
       INNER JOIN columns col ON c.column_id = col.id
       WHERE col.board_id = $1 AND col.name = $2 AND c.archived = false
       ORDER BY c.position`,
      [boardId, col.name]
    );

    const cards = [];
    for (const card of cardsResult.rows) {
      const checklistResult = await pool.query(
        'SELECT text, position FROM card_checklist_items WHERE card_id = $1 ORDER BY position',
        [card.id]
      );
      cards.push({
        title: card.title,
        description: card.description || '',
        position: card.position,
        checklist_items: checklistResult.rows.map((item: any) => ({
          text: item.text,
          position: item.position,
        })),
      });
    }

    columns.push({ name: col.name, position: col.position, cards });
  }

  const labelsResult = await pool.query(
    'SELECT name, color FROM board_labels WHERE board_id = $1', [boardId]
  );

  const fieldsResult = await pool.query(
    'SELECT name, field_type, options, position, show_on_card FROM board_custom_fields WHERE board_id = $1 ORDER BY position',
    [boardId]
  );

  return {
    columns,
    labels: labelsResult.rows,
    custom_fields: fieldsResult.rows.map((f: any) => ({
      name: f.name,
      field_type: f.field_type,
      options: f.options,
      position: f.position,
      show_on_card: f.show_on_card,
    })),
  };
}

export default router;
```

**Step 2: Mount in index.ts**

In `server/src/index.ts`, add import:

```typescript
import templateRoutes from './routes/templates';
```

Add route mount after the analytics line (~line 58):

```typescript
app.use('/api/templates', templateRoutes);
```

**Step 3: Commit**

```bash
git add server/src/routes/templates.ts server/src/index.ts
git commit -m "feat: add templates API routes (CRUD + use template)"
```

---

### Task 5: App settings API routes

**Files:**
- Create: `server/src/routes/appSettings.ts`
- Modify: `server/src/index.ts` (mount route)

**Step 1: Create the app settings router**

Create `server/src/routes/appSettings.ts`:

```typescript
import { Router } from 'express';
import pool from '../db';
import { authenticate, requireAdmin } from '../middleware/auth';
import { AuthRequest } from '../types';

const router = Router();

// Get all app settings (admin only)
router.get('/', authenticate, requireAdmin, async (_req: AuthRequest, res) => {
  try {
    const result = await pool.query('SELECT key, value FROM app_settings');
    const settings: Record<string, any> = {};
    result.rows.forEach(row => {
      settings[row.key] = row.value;
    });
    res.json(settings);
  } catch (error) {
    console.error('Get settings error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Update a setting (admin only)
router.put('/:key', authenticate, requireAdmin, async (req: AuthRequest, res) => {
  try {
    const { key } = req.params;
    const { value } = req.body;

    const ALLOWED_KEYS = ['registration_enabled'];
    if (!ALLOWED_KEYS.includes(key)) {
      return res.status(400).json({ error: `Unknown setting: ${key}` });
    }

    await pool.query(
      `INSERT INTO app_settings (key, value, updated_at)
       VALUES ($1, $2, CURRENT_TIMESTAMP)
       ON CONFLICT (key) DO UPDATE SET value = $2, updated_at = CURRENT_TIMESTAMP`,
      [key, JSON.stringify(value)]
    );

    res.json({ key, value });
  } catch (error) {
    console.error('Update setting error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;
```

**Step 2: Mount in index.ts**

Add import:

```typescript
import appSettingsRoutes from './routes/appSettings';
```

Add mount:

```typescript
app.use('/api/app-settings', appSettingsRoutes);
```

**Step 3: Commit**

```bash
git add server/src/routes/appSettings.ts server/src/index.ts
git commit -m "feat: add app settings API routes"
```

---

### Task 6: Client types and API methods for templates + settings

**Files:**
- Modify: `client/src/types.ts` (add BoardTemplate, AppSettings interfaces)
- Modify: `client/src/api.ts` (add template + settings API methods)

**Step 1: Add types**

Add to the end of `client/src/types.ts`:

```typescript
export interface BoardTemplate {
  id: string;
  name: string;
  description?: string;
  is_builtin: boolean;
  data: {
    columns: {
      name: string;
      position: number;
      cards: {
        title: string;
        description: string;
        position: number;
        checklist_items?: { text: string; position: number }[];
      }[];
    }[];
    labels: { name: string; color: string }[];
    custom_fields: {
      name: string;
      field_type: string;
      options?: string[];
      position: number;
      show_on_card: boolean;
    }[];
  };
  column_count?: number;
  card_count?: number;
  created_by?: string;
  created_at: string;
}
```

**Step 2: Add API methods**

Add to `ApiClient` class in `client/src/api.ts` (after the OIDC methods around line 348):

```typescript
  // Templates
  async getTemplates(): Promise<BoardTemplate[]> {
    return this.fetch('/templates');
  }

  async createTemplateFromBoard(boardId: string, name: string, description?: string): Promise<BoardTemplate> {
    return this.fetch('/templates', {
      method: 'POST',
      body: JSON.stringify({ board_id: boardId, name, description }),
    });
  }

  async useTemplate(templateId: string, name: string, description?: string): Promise<Board> {
    return this.fetch(`/templates/${templateId}/use`, {
      method: 'POST',
      body: JSON.stringify({ name, description }),
    });
  }

  async deleteTemplate(templateId: string): Promise<void> {
    return this.fetch(`/templates/${templateId}`, { method: 'DELETE' });
  }

  // App Settings
  async getAppSettings(): Promise<Record<string, any>> {
    return this.fetch('/app-settings');
  }

  async updateAppSetting(key: string, value: any): Promise<void> {
    return this.fetch(`/app-settings/${key}`, {
      method: 'PUT',
      body: JSON.stringify({ value }),
    });
  }
```

Also add the `BoardTemplate` import to the import line at the top of `api.ts`.

**Step 3: Commit**

```bash
git add client/src/types.ts client/src/api.ts
git commit -m "feat: add client types and API methods for templates and app settings"
```

---

### Task 7: AdminPage wrapper component

**Files:**
- Create: `client/src/components/AdminPage.tsx`
- Modify: `client/src/App.tsx` (import AdminPage, render it instead of UserManagement)

**Step 1: Create AdminPage.tsx**

This component provides the sidebar navigation and renders the active tab content. It receives `subRoute` from App.tsx and determines which tab is active.

```typescript
import { User } from '../types';
import AppBar from './AppBar';
import UserManagement from './UserManagement';
import OidcSettings from './OidcSettings';
import TemplateGallery from './TemplateGallery';
import GeneralSettings from './GeneralSettings';

interface AdminPageProps {
  onBack: () => void;
  currentUser: User;
  subRoute: string | null;
  onNavigate: (sub: string | null) => void;
}

type AdminTab = 'members' | 'templates' | 'sso' | 'general';

function getActiveTab(subRoute: string | null): AdminTab {
  if (!subRoute) return 'members';
  if (subRoute === 'templates') return 'templates';
  if (subRoute === 'sso') return 'sso';
  if (subRoute === 'general') return 'general';
  // sub-routes like 'new', username, 'settings' are legacy — 'new' and username belong to members
  return 'members';
}

const TABS: { key: AdminTab; label: string; route: string | null }[] = [
  { key: 'members', label: 'Members', route: null },
  { key: 'templates', label: 'Templates', route: 'templates' },
  { key: 'sso', label: 'SSO', route: 'sso' },
  { key: 'general', label: 'General', route: 'general' },
];

export default function AdminPage({ onBack, currentUser, subRoute, onNavigate }: AdminPageProps) {
  const activeTab = getActiveTab(subRoute);

  // For members tab, pass through the subRoute for create/edit flows
  const memberSubRoute = activeTab === 'members' ? subRoute : null;

  return (
    <div className="admin-page">
      <AppBar title="Admin" onBack={onBack} />
      <div className="admin-layout">
        <nav className="admin-sidebar">
          {TABS.map(tab => (
            <button
              key={tab.key}
              className={`admin-tab${activeTab === tab.key ? ' active' : ''}`}
              onClick={() => onNavigate(tab.route)}
            >
              {tab.label}
            </button>
          ))}
        </nav>
        <div className="admin-content">
          {activeTab === 'members' && (
            <UserManagement
              currentUser={currentUser}
              subRoute={memberSubRoute}
              onNavigate={onNavigate}
            />
          )}
          {activeTab === 'templates' && (
            <TemplateGallery />
          )}
          {activeTab === 'sso' && (
            <OidcSettings />
          )}
          {activeTab === 'general' && (
            <GeneralSettings />
          )}
        </div>
      </div>
    </div>
  );
}
```

**Step 2: Update App.tsx**

In `client/src/App.tsx`:

1. Replace the `UserManagement` import (line 10) with `AdminPage`:
   ```typescript
   import AdminPage from './components/AdminPage';
   ```

2. Replace the rendering block (lines 472-478):
   ```typescript
   ) : page === 'users' && user?.role === 'ADMIN' ? (
     <AdminPage
       onBack={handleBackToBoards}
       currentUser={user}
       subRoute={adminSubRoute}
       onNavigate={handleAdminNavigate}
     />
   ```

3. Update `resolveUrlRoute` (line 90) — the existing sub-route parsing already handles `/admin/templates`, `/admin/sso`, `/admin/general` as `sub = 'templates'` etc. No changes needed.

**Step 3: Stub out TemplateGallery and GeneralSettings**

Create placeholder components so the app compiles. These will be filled in in later tasks.

`client/src/components/TemplateGallery.tsx`:
```typescript
export default function TemplateGallery() {
  return <div className="template-gallery"><p>Templates coming soon...</p></div>;
}
```

`client/src/components/GeneralSettings.tsx`:
```typescript
export default function GeneralSettings() {
  return <div className="general-settings"><p>General settings coming soon...</p></div>;
}
```

**Step 4: Commit**

```bash
git add client/src/components/AdminPage.tsx client/src/components/TemplateGallery.tsx client/src/components/GeneralSettings.tsx client/src/App.tsx
git commit -m "feat: add AdminPage wrapper with tab navigation"
```

---

### Task 8: Refactor UserManagement into a tab panel

**Files:**
- Modify: `client/src/components/UserManagement.tsx`

**Step 1: Remove AppBar and onBack from UserManagement**

UserManagement currently renders its own `<AppBar>` for three cases (SSO settings view at line 198, form page at line 183, and main list at line 214). Since AdminPage now provides the AppBar and sidebar, UserManagement should:

1. Remove the `onBack` prop from the interface (line 9). It's no longer needed — AdminPage handles back navigation.
2. Remove the SSO settings sub-route handling (lines 195-206) — SSO is now its own tab.
3. Remove the "SSO Settings" button from the main list AppBar (lines 215-217).
4. For the main user list view (line 212-275): Remove the outer `<AppBar>` since AdminPage provides it. Keep the "+" button as a standalone button above the table instead.
5. For the form pages (create/edit user at lines 164-193): Keep the inner AppBar for back-to-list navigation within the Members tab (uses `onNavigate(null)` to go back to user list).

Updated interface:
```typescript
interface UserManagementProps {
  currentUser: User;
  subRoute: string | null;
  onNavigate: (sub: string | null) => void;
}
```

Updated main list (when `subRoute === null`):
```tsx
return (
  <div className="user-management-panel">
    <div className="panel-header">
      <h2>Members</h2>
      <button onClick={() => onNavigate('new')} className="btn-primary btn-sm">+ New User</button>
    </div>
    <div className="users-table-container">
      {/* existing table unchanged */}
    </div>
  </div>
);
```

Updated form page: Keep the `<AppBar title={title} onBack={() => onNavigate(null)}>` — this provides a back arrow within the Members tab to return to the user list. This is a nested navigation, not the top-level admin navigation.

Remove the SSO conditional (lines 195-206) entirely since SSO is its own tab now.

**Step 2: Refactor OidcSettings to remove onBack**

In `client/src/components/OidcSettings.tsx`, remove the `onBack` prop from the interface (line 4-6) and remove any usage of it. The component just renders its settings form directly. AdminPage handles navigation.

Updated interface:
```typescript
// No props needed — standalone panel
export default function OidcSettings() {
```

**Step 3: Commit**

```bash
git add client/src/components/UserManagement.tsx client/src/components/OidcSettings.tsx
git commit -m "refactor: convert UserManagement and OidcSettings to tab panels"
```

---

### Task 9: Admin page CSS

**Files:**
- Modify: `client/src/index.css` (add admin layout styles)

**Step 1: Add admin page styles**

Add to `client/src/index.css`:

```css
/* Admin Page Layout */
.admin-page {
  height: 100vh;
  display: flex;
  flex-direction: column;
}

.admin-layout {
  flex: 1;
  display: flex;
  overflow: hidden;
}

.admin-sidebar {
  width: 180px;
  flex-shrink: 0;
  border-right: 1px solid var(--border);
  padding: 12px 0;
  display: flex;
  flex-direction: column;
  gap: 2px;
  background: var(--surface);
}

.admin-tab {
  display: block;
  width: 100%;
  padding: 10px 20px;
  text-align: left;
  background: none;
  border: none;
  font-size: 14px;
  color: var(--text-secondary);
  cursor: pointer;
  border-left: 3px solid transparent;
}

.admin-tab:hover {
  background: var(--hover);
  color: var(--text);
}

.admin-tab.active {
  color: var(--text);
  font-weight: 600;
  border-left-color: var(--accent);
  background: var(--hover);
}

.admin-content {
  flex: 1;
  overflow-y: auto;
  padding: 24px;
}

/* Panel header used by Members and other tabs */
.panel-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 16px;
}

.panel-header h2 {
  margin: 0;
  font-size: 18px;
  font-weight: 600;
}

/* Mobile: horizontal tabs instead of sidebar */
@media (max-width: 768px) {
  .admin-layout {
    flex-direction: column;
  }

  .admin-sidebar {
    width: 100%;
    flex-direction: row;
    border-right: none;
    border-bottom: 1px solid var(--border);
    padding: 0;
    overflow-x: auto;
    -webkit-overflow-scrolling: touch;
  }

  .admin-tab {
    white-space: nowrap;
    padding: 10px 16px;
    border-left: none;
    border-bottom: 3px solid transparent;
  }

  .admin-tab.active {
    border-left-color: transparent;
    border-bottom-color: var(--accent);
  }

  .admin-content {
    padding: 16px;
  }
}
```

**Step 2: Commit**

```bash
git add client/src/index.css
git commit -m "style: add admin page layout CSS with responsive sidebar"
```

---

### Task 10: TemplateGallery component

**Files:**
- Modify: `client/src/components/TemplateGallery.tsx` (replace stub)

**Step 1: Implement the full component**

The template gallery shows a grid of template cards with name, description, column/card counts, and action buttons. It has two actions per template: "Use Template" and "Delete" (only for user-created). Plus a "Save Board as Template" button at the top.

```typescript
import { useState, useEffect } from 'react';
import { api } from '../api';
import { BoardTemplate, Board } from '../types';
import { useConfirm } from '../contexts/ConfirmContext';

export default function TemplateGallery() {
  const confirm = useConfirm();
  const [templates, setTemplates] = useState<BoardTemplate[]>([]);
  const [boards, setBoards] = useState<Board[]>([]);
  const [loading, setLoading] = useState(true);

  // "Use template" modal state
  const [usingTemplate, setUsingTemplate] = useState<BoardTemplate | null>(null);
  const [newBoardName, setNewBoardName] = useState('');
  const [newBoardDesc, setNewBoardDesc] = useState('');

  // "Save as template" modal state
  const [showSaveModal, setShowSaveModal] = useState(false);
  const [saveBoardId, setSaveBoardId] = useState('');
  const [saveTemplateName, setSaveTemplateName] = useState('');
  const [saveTemplateDesc, setSaveTemplateDesc] = useState('');

  const [error, setError] = useState('');

  useEffect(() => {
    loadTemplates();
    loadBoards();
  }, []);

  const loadTemplates = async () => {
    try {
      const data = await api.getTemplates();
      setTemplates(data);
    } catch (err) {
      console.error('Failed to load templates:', err);
    } finally {
      setLoading(false);
    }
  };

  const loadBoards = async () => {
    try {
      const data = await api.getBoards();
      setBoards(data.filter((b: Board) => !b.archived));
    } catch (err) {
      console.error('Failed to load boards:', err);
    }
  };

  const handleUseTemplate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!usingTemplate) return;
    setError('');
    try {
      await api.useTemplate(usingTemplate.id, newBoardName, newBoardDesc);
      setUsingTemplate(null);
      setNewBoardName('');
      setNewBoardDesc('');
      // Navigate to boards list to see new board
      window.location.href = '/';
    } catch (err: any) {
      setError(err.message || 'Failed to create board from template');
    }
  };

  const handleSaveAsTemplate = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    try {
      await api.createTemplateFromBoard(saveBoardId, saveTemplateName, saveTemplateDesc);
      setShowSaveModal(false);
      setSaveBoardId('');
      setSaveTemplateName('');
      setSaveTemplateDesc('');
      loadTemplates();
    } catch (err: any) {
      setError(err.message || 'Failed to save template');
    }
  };

  const handleDeleteTemplate = async (tpl: BoardTemplate) => {
    if (!await confirm(`Delete template "${tpl.name}"? This cannot be undone.`, { confirmLabel: 'Delete' })) return;
    try {
      await api.deleteTemplate(tpl.id);
      loadTemplates();
    } catch (err: any) {
      alert(err.message || 'Failed to delete template');
    }
  };

  if (loading) {
    return <div className="loading"><div className="spinner"></div></div>;
  }

  return (
    <div className="template-gallery">
      <div className="panel-header">
        <h2>Templates</h2>
        <button onClick={() => setShowSaveModal(true)} className="btn-primary btn-sm">
          + Save Board as Template
        </button>
      </div>

      {templates.length === 0 ? (
        <div className="empty-state"><p>No templates yet.</p></div>
      ) : (
        <div className="templates-grid">
          {templates.map(tpl => (
            <div key={tpl.id} className="template-card">
              <div className="template-card-header">
                <h3>{tpl.name}</h3>
                {tpl.is_builtin && <span className="template-badge">Built-in</span>}
              </div>
              {tpl.description && <p className="template-desc">{tpl.description}</p>}
              <div className="template-meta">
                {tpl.column_count} columns · {tpl.card_count} cards
              </div>
              <div className="template-actions">
                <button
                  className="btn-primary btn-sm"
                  onClick={() => { setUsingTemplate(tpl); setNewBoardName(''); setNewBoardDesc(''); setError(''); }}
                >
                  Use Template
                </button>
                {!tpl.is_builtin && (
                  <button
                    className="btn-danger btn-sm"
                    onClick={() => handleDeleteTemplate(tpl)}
                  >
                    Delete
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Use Template Modal */}
      {usingTemplate && (
        <div className="modal-overlay" onClick={() => setUsingTemplate(null)}>
          <div className="modal" onClick={e => e.stopPropagation()}>
            <h3>Create Board from "{usingTemplate.name}"</h3>
            <form onSubmit={handleUseTemplate}>
              <div className="form-group">
                <label htmlFor="tpl-board-name">Board Name</label>
                <input
                  id="tpl-board-name"
                  type="text"
                  value={newBoardName}
                  onChange={e => setNewBoardName(e.target.value)}
                  required
                  maxLength={255}
                  autoFocus
                />
              </div>
              <div className="form-group">
                <label htmlFor="tpl-board-desc">Description (optional)</label>
                <textarea
                  id="tpl-board-desc"
                  value={newBoardDesc}
                  onChange={e => setNewBoardDesc(e.target.value)}
                  maxLength={10000}
                  rows={3}
                />
              </div>
              {error && <div className="error">{error}</div>}
              <div className="modal-actions">
                <button type="button" className="btn-secondary" onClick={() => setUsingTemplate(null)}>Cancel</button>
                <button type="submit" className="btn-primary">Create Board</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Save Board as Template Modal */}
      {showSaveModal && (
        <div className="modal-overlay" onClick={() => setShowSaveModal(false)}>
          <div className="modal" onClick={e => e.stopPropagation()}>
            <h3>Save Board as Template</h3>
            <form onSubmit={handleSaveAsTemplate}>
              <div className="form-group">
                <label htmlFor="save-board-select">Board</label>
                <select
                  id="save-board-select"
                  value={saveBoardId}
                  onChange={e => {
                    setSaveBoardId(e.target.value);
                    if (!saveTemplateName) {
                      const board = boards.find(b => b.id === e.target.value);
                      if (board) setSaveTemplateName(board.name + ' Template');
                    }
                  }}
                  required
                >
                  <option value="">Select a board...</option>
                  {boards.map(b => (
                    <option key={b.id} value={b.id}>{b.name}</option>
                  ))}
                </select>
              </div>
              <div className="form-group">
                <label htmlFor="save-tpl-name">Template Name</label>
                <input
                  id="save-tpl-name"
                  type="text"
                  value={saveTemplateName}
                  onChange={e => setSaveTemplateName(e.target.value)}
                  required
                  maxLength={255}
                />
              </div>
              <div className="form-group">
                <label htmlFor="save-tpl-desc">Description (optional)</label>
                <textarea
                  id="save-tpl-desc"
                  value={saveTemplateDesc}
                  onChange={e => setSaveTemplateDesc(e.target.value)}
                  maxLength={10000}
                  rows={3}
                />
              </div>
              {error && <div className="error">{error}</div>}
              <div className="modal-actions">
                <button type="button" className="btn-secondary" onClick={() => setShowSaveModal(false)}>Cancel</button>
                <button type="submit" className="btn-primary">Save Template</button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
```

**Step 2: Commit**

```bash
git add client/src/components/TemplateGallery.tsx
git commit -m "feat: implement TemplateGallery component with use and save-as-template"
```

---

### Task 11: Template gallery CSS

**Files:**
- Modify: `client/src/index.css`

**Step 1: Add template gallery styles**

```css
/* Template Gallery */
.templates-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
  gap: 16px;
}

.template-card {
  border: 1px solid var(--border);
  border-radius: 8px;
  padding: 16px;
  background: var(--surface);
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.template-card-header {
  display: flex;
  align-items: center;
  gap: 8px;
}

.template-card-header h3 {
  margin: 0;
  font-size: 16px;
  font-weight: 600;
}

.template-badge {
  font-size: 11px;
  padding: 2px 6px;
  border-radius: 4px;
  background: var(--accent);
  color: white;
  font-weight: 500;
}

.template-desc {
  margin: 0;
  font-size: 13px;
  color: var(--text-secondary);
  line-height: 1.4;
}

.template-meta {
  font-size: 12px;
  color: var(--text-tertiary);
}

.template-actions {
  display: flex;
  gap: 8px;
  margin-top: 4px;
}
```

**Step 2: Commit**

```bash
git add client/src/index.css
git commit -m "style: add template gallery card grid styles"
```

---

### Task 12: GeneralSettings component

**Files:**
- Modify: `client/src/components/GeneralSettings.tsx` (replace stub)

**Step 1: Implement the component**

```typescript
import { useState, useEffect } from 'react';
import { api } from '../api';

export default function GeneralSettings() {
  const [registrationEnabled, setRegistrationEnabled] = useState(true);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    loadSettings();
  }, []);

  const loadSettings = async () => {
    try {
      const settings = await api.getAppSettings();
      setRegistrationEnabled(settings.registration_enabled ?? true);
    } catch (err) {
      console.error('Failed to load settings:', err);
    } finally {
      setLoading(false);
    }
  };

  const handleToggleRegistration = async () => {
    const newValue = !registrationEnabled;
    setSaving(true);
    try {
      await api.updateAppSetting('registration_enabled', newValue);
      setRegistrationEnabled(newValue);
    } catch (err) {
      console.error('Failed to update setting:', err);
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return <div className="loading"><div className="spinner"></div></div>;
  }

  return (
    <div className="general-settings">
      <div className="panel-header">
        <h2>General</h2>
      </div>

      <div className="settings-section">
        <h3>Registration</h3>
        <div className="setting-row">
          <div className="setting-info">
            <div className="setting-label">Open registration</div>
            <div className="setting-desc">When enabled, anyone can create an account. When disabled, only admins can create users.</div>
          </div>
          <button
            className={`toggle-switch${registrationEnabled ? ' active' : ''}`}
            onClick={handleToggleRegistration}
            disabled={saving}
            role="switch"
            aria-checked={registrationEnabled}
          >
            <span className="toggle-knob" />
          </button>
        </div>
      </div>

      <div className="settings-section disabled-section">
        <h3>Email (SMTP)</h3>
        <p className="coming-soon-label">Coming soon</p>
        <div className="setting-row disabled">
          <div className="setting-info">
            <div className="setting-label">SMTP Host</div>
          </div>
          <input type="text" disabled placeholder="smtp.example.com" />
        </div>
        <div className="setting-row disabled">
          <div className="setting-info">
            <div className="setting-label">Port</div>
          </div>
          <input type="text" disabled placeholder="587" />
        </div>
        <div className="setting-row disabled">
          <div className="setting-info">
            <div className="setting-label">Username</div>
          </div>
          <input type="text" disabled placeholder="user@example.com" />
        </div>
        <div className="setting-row disabled">
          <div className="setting-info">
            <div className="setting-label">From Address</div>
          </div>
          <input type="text" disabled placeholder="noreply@example.com" />
        </div>
      </div>
    </div>
  );
}
```

**Step 2: Commit**

```bash
git add client/src/components/GeneralSettings.tsx
git commit -m "feat: implement GeneralSettings with registration toggle and SMTP stub"
```

---

### Task 13: General settings CSS

**Files:**
- Modify: `client/src/index.css`

**Step 1: Add general settings styles**

```css
/* General Settings */
.settings-section {
  margin-bottom: 32px;
}

.settings-section h3 {
  font-size: 15px;
  font-weight: 600;
  margin: 0 0 12px;
}

.setting-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 12px 0;
  border-bottom: 1px solid var(--border);
  gap: 16px;
}

.setting-row.disabled {
  opacity: 0.5;
  pointer-events: none;
}

.setting-info {
  flex: 1;
}

.setting-label {
  font-size: 14px;
  font-weight: 500;
}

.setting-desc {
  font-size: 12px;
  color: var(--text-secondary);
  margin-top: 2px;
}

.coming-soon-label {
  font-size: 12px;
  color: var(--text-tertiary);
  font-style: italic;
  margin: 0 0 8px;
}

.disabled-section input {
  width: 200px;
  padding: 6px 10px;
  border: 1px solid var(--border);
  border-radius: 4px;
  background: var(--surface);
  font-size: 13px;
}

/* Toggle switch */
.toggle-switch {
  position: relative;
  width: 44px;
  height: 24px;
  border-radius: 12px;
  background: var(--border);
  border: none;
  cursor: pointer;
  padding: 0;
  flex-shrink: 0;
  transition: background 0.2s;
}

.toggle-switch.active {
  background: var(--accent);
}

.toggle-knob {
  position: absolute;
  top: 2px;
  left: 2px;
  width: 20px;
  height: 20px;
  border-radius: 50%;
  background: white;
  transition: transform 0.2s;
  box-shadow: 0 1px 3px rgba(0,0,0,0.2);
}

.toggle-switch.active .toggle-knob {
  transform: translateX(20px);
}
```

**Step 2: Commit**

```bash
git add client/src/index.css
git commit -m "style: add general settings and toggle switch styles"
```

---

### Task 14: "Save as Template" in BoardList kebab menu

**Files:**
- Modify: `client/src/components/BoardList.tsx` (add menu item + modal)

**Step 1: Add "Save as Template" to the kebab dropdown**

In `BoardList.tsx`, in the kebab dropdown (around line 164-175), add a new button between "Archive" and the divider:

```tsx
<button onClick={(e) => { e.stopPropagation(); setOpenMenuId(null); handleSaveAsTemplate(board); }}>Save as Template</button>
```

Add state for the save-as-template modal:

```typescript
const [savingBoard, setSavingBoard] = useState<Board | null>(null);
const [saveTemplateName, setSaveTemplateName] = useState('');
const [saveTemplateDesc, setSaveTemplateDesc] = useState('');
```

Add the handler:

```typescript
const handleSaveAsTemplate = (board: Board) => {
  setSavingBoard(board);
  setSaveTemplateName(board.name + ' Template');
  setSaveTemplateDesc('');
};

const handleConfirmSaveTemplate = async (e: React.FormEvent) => {
  e.preventDefault();
  if (!savingBoard) return;
  try {
    await api.createTemplateFromBoard(savingBoard.id, saveTemplateName, saveTemplateDesc);
    setSavingBoard(null);
    alert('Template saved!');
  } catch (err: any) {
    alert(err.message || 'Failed to save template');
  }
};
```

Add the modal markup at the end of the component (alongside the existing create/edit modals):

```tsx
{savingBoard && (
  <div className="modal-overlay" onClick={() => setSavingBoard(null)}>
    <div className="modal" onClick={e => e.stopPropagation()}>
      <h3>Save "{savingBoard.name}" as Template</h3>
      <form onSubmit={handleConfirmSaveTemplate}>
        <div className="form-group">
          <label htmlFor="save-tpl-name">Template Name</label>
          <input
            id="save-tpl-name"
            type="text"
            value={saveTemplateName}
            onChange={e => setSaveTemplateName(e.target.value)}
            required
            maxLength={255}
            autoFocus
          />
        </div>
        <div className="form-group">
          <label htmlFor="save-tpl-desc">Description (optional)</label>
          <textarea
            id="save-tpl-desc"
            value={saveTemplateDesc}
            onChange={e => setSaveTemplateDesc(e.target.value)}
            maxLength={10000}
            rows={3}
          />
        </div>
        <div className="modal-actions">
          <button type="button" className="btn-secondary" onClick={() => setSavingBoard(null)}>Cancel</button>
          <button type="submit" className="btn-primary">Save Template</button>
        </div>
      </form>
    </div>
  </div>
)}
```

**Step 2: Commit**

```bash
git add client/src/components/BoardList.tsx
git commit -m "feat: add 'Save as Template' to board kebab menu"
```

---

### Task 15: Update BoardList AppBar — replace "Users" with "Admin"

**Files:**
- Modify: `client/src/components/BoardList.tsx`

**Step 1: Change the button text and behavior**

In `BoardList.tsx` (line 126-128), change "Users" to "Admin":

```tsx
<button onClick={onGoToUsers} className="btn-secondary btn-sm">
  Admin
</button>
```

No other changes needed — `onGoToUsers` already navigates to `/admin` which now renders AdminPage.

**Step 2: Commit**

```bash
git add client/src/components/BoardList.tsx
git commit -m "feat: rename 'Users' button to 'Admin' in board list header"
```

---

### Task 16: Wire registration_enabled setting into auth

**Files:**
- Modify: `server/src/routes/auth.ts` (check setting before allowing registration)

**Step 1: Add registration check**

This task is about making the `registration_enabled` setting actually do something. Currently `POST /api/auth/register` is admin-only (`requireAdmin` middleware), so open registration isn't implemented yet. For now, just add a comment noting where the check would go when a public registration endpoint is added. No code changes needed — the setting is stored and editable from the UI, and the admin-only register endpoint bypasses it (admins can always create users).

If the app already has or later adds a public registration route, it should check:

```typescript
const setting = await pool.query("SELECT value FROM app_settings WHERE key = 'registration_enabled'");
const enabled = setting.rows.length > 0 ? setting.rows[0].value : true;
if (!enabled) {
  return res.status(403).json({ error: 'Registration is currently disabled' });
}
```

**Step 2: Commit** — no commit needed, this is documentation only.

---

### Task 17: Build, test, and verify

**Step 1: Build the server**

Run: `cd /home/bradley/cork/server && npx tsc --noEmit`
Expected: No type errors.

**Step 2: Build the client**

Run: `cd /home/bradley/cork/client && npx tsc --noEmit`
Expected: No type errors.

**Step 3: Run the dev server and verify**

Start the app and verify:
1. `/admin` shows the admin page with sidebar (Members, Templates, SSO, General)
2. Members tab shows the user list with "+ New User" button
3. Templates tab shows built-in templates (Sprint Board, Bug Triage, Project Tracker)
4. "Use Template" creates a board with correct columns/cards/labels/custom fields
5. "Save Board as Template" from templates tab and from board kebab menu both work
6. SSO tab shows OIDC settings form
7. General tab shows registration toggle
8. Mobile view shows horizontal tabs
9. Back button from admin returns to boards list

**Step 4: Final commit**

Fix any issues found during testing, then:

```bash
git add -A
git commit -m "feat: board templates and admin page with Members, Templates, SSO, General tabs"
```
