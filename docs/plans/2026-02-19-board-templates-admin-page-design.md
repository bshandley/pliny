# Board Templates & Admin Page Design

**Date**: 2026-02-19

## Overview

Add board templates (JSON snapshot approach) and consolidate admin features into a dedicated admin page with tabbed navigation.

## Scope

1. **Migration 015**: `board_templates` table + `app_settings` table
2. **Admin page**: New `AdminPage.tsx` with 4 tabs (Members, Templates, SSO, General)
3. **Templates**: JSON snapshot storage, built-in templates, save-from-board, create-board-from-template
4. **General settings**: Registration toggle + SMTP stub UI
5. **Refactor**: Move UserManagement and OidcSettings into tab panels

## Schema

### `board_templates`

```sql
CREATE TABLE board_templates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name VARCHAR(255) NOT NULL,
  description TEXT,
  is_builtin BOOLEAN DEFAULT FALSE,
  data JSONB NOT NULL,
  created_by UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
```

The `data` JSONB column holds:

```json
{
  "columns": [
    {
      "name": "To Do",
      "position": 0,
      "cards": [
        {
          "title": "Example task",
          "description": "...",
          "position": 0,
          "checklist_items": [
            { "text": "Step 1", "position": 0 }
          ]
        }
      ]
    }
  ],
  "labels": [
    { "name": "Bug", "color": "#ef4444" }
  ],
  "custom_fields": [
    { "name": "Priority", "field_type": "dropdown", "options": ["Low", "Medium", "High"], "position": 0, "show_on_card": true }
  ]
}
```

No assignees, due dates, checked state, or IDs — just structure.

### `app_settings`

```sql
CREATE TABLE app_settings (
  key VARCHAR(100) PRIMARY KEY,
  value JSONB NOT NULL,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
```

Initial seed: `{ key: 'registration_enabled', value: true }`.

## API Endpoints

### Templates

| Method | Route | Description |
|--------|-------|-------------|
| `GET` | `/api/templates` | List all templates (admin only) |
| `POST` | `/api/templates` | Create template (from scratch or from board via `{ board_id }`) |
| `POST` | `/api/templates/:id/use` | Create a new board from a template |
| `DELETE` | `/api/templates/:id` | Delete user-created template (can't delete built-ins) |

**Save as template**: `POST /api/templates` with `{ board_id }` — server fetches the board's columns/cards/labels/custom fields/checklists, strips runtime data (IDs, dates, assignees), stores the snapshot.

**Use template**: `POST /api/templates/:id/use` with `{ name, description }` — server creates a new board, then inserts columns, cards, labels, custom fields, and checklist items from the JSON data, generating fresh UUIDs.

### Settings

| Method | Route | Description |
|--------|-------|-------------|
| `GET` | `/api/settings` | Get all app settings |
| `PUT` | `/api/settings/:key` | Update a setting (admin only) |

### Built-in Templates

Defined as constants in `server/src/templates/builtins.ts`. Seeded on startup with `is_builtin = true`. Examples:

- **Sprint Board** — Backlog, In Progress, Review, Done
- **Bug Triage** — Reported, Confirmed, In Progress, Fixed, Closed
- **Project Tracker** — Ideas, Planning, Active, Complete

## Admin Page Layout

```
┌─────────────────────────────────────────────┐
│  AppBar  [← Boards]              [UserMenu] │
├────────────┬────────────────────────────────┤
│            │                                │
│  Members ● │   Active tab content           │
│  Templates │                                │
│  SSO       │                                │
│  General   │                                │
│            │                                │
├────────────┴────────────────────────────────┤
```

- Left sidebar with tab links, active tab highlighted
- Mobile: tabs become horizontal scrollable strip above content
- URLs: `/admin` → Members, `/admin/templates` → Templates, `/admin/sso` → SSO, `/admin/general` → General
- Members tab preserves `/admin/new` and `/admin/{username}` sub-routes

### Component Structure

- `AdminPage.tsx` — new wrapper, renders sidebar + active tab content
- `UserManagement.tsx` — refactored to tab panel (remove own AppBar)
- `OidcSettings.tsx` — refactored to tab panel (remove `onBack`)
- `TemplateGallery.tsx` — new, templates tab
- `GeneralSettings.tsx` — new, general settings tab
- `App.tsx` — `/admin/*` renders `AdminPage` instead of `UserManagement`

### "Save as Template" Entry Point

Board kebab menu on board list page gets a "Save as Template" option (admin only). Calls `POST /api/templates` with `{ board_id }`.

## General Settings Tab

**Registration**: Toggle switch — open (anyone can register) vs closed (admin creates accounts). Stored in `app_settings` as `registration_enabled`.

**SMTP (stub)**: Form fields for host, port, username, password, from address — all disabled with "Coming soon" label. No backend wiring.

## Permissions

All admin page access and template operations are admin-only (`requireAdmin` middleware).
