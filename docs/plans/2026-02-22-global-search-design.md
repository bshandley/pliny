# Global Search Design

## Overview

Command palette modal (`Ctrl+K` / `Cmd+K`) that searches cards, comments, and checklist items across all boards the user has access to. Uses PostgreSQL full-text search with GIN indexes. Selecting a result navigates to the board and opens the card.

## API

**Endpoint:** `GET /api/search?q=<term>&limit=20`

**Auth:** `authenticate` middleware. Non-admin users see only results from boards they're members of (via `board_members` JOIN). Admins see all boards.

**Query:** Single `UNION ALL` across three sources:

| Source | Searchable fields | Result type |
|---|---|---|
| `cards` | `title`, `description` | `card` |
| `card_comments` | `text` | `comment` |
| `card_checklist_items` | `text` | `checklist_item` |

**Full-text search:** `tsvector` with GIN indexes. `ts_rank` for relevance ordering. Card title weighted higher than description (weight A vs B). Minimum 2 character query length.

**Response:**

```typescript
{
  results: [{
    type: 'card' | 'comment' | 'checklist_item',
    card_id: string,
    card_title: string,
    board_id: string,
    board_name: string,
    column_name: string,
    match_text: string,
    rank: number
  }],
  total: number
}
```

## Frontend

**`GlobalSearchModal.tsx`** — command palette modal via `createPortal` to `document.body`.

**Triggers:**
- `Ctrl+K` / `Cmd+K` keyboard shortcut (global listener in `App.tsx`)
- Search icon button in AppBar (between title and notification bell)

**Behavior:**
- Centered overlay with backdrop dimming
- Auto-focused text input
- 300ms debounced search, minimum 2 characters
- Results list with keyboard navigation (arrow keys + Enter)
- `Escape` closes modal
- Recent searches from localStorage (last 5) shown when input is empty

**Result row layout:**

```
[type icon]  Card Title                    Board Name
             matched text snippet...       Column Name
```

- Match highlighting: client-side bold wrapping of query term in snippet (~120 char snippets)
- Type icons differentiate card / comment / checklist results

**On select:** Close modal, navigate to board, open card detail view.

**Mobile:** Full-width modal, triggered via AppBar icon only.

## Database (Migration 017)

GIN indexes only — no new tables or columns:

```sql
CREATE INDEX IF NOT EXISTS idx_cards_search
  ON cards USING GIN (to_tsvector('english', coalesce(title,'') || ' ' || coalesce(description,'')));

CREATE INDEX IF NOT EXISTS idx_comments_search
  ON card_comments USING GIN (to_tsvector('english', text));

CREATE INDEX IF NOT EXISTS idx_checklist_search
  ON card_checklist_items USING GIN (to_tsvector('english', text));
```

## RBAC

```sql
-- Non-admin: restrict to member boards
INNER JOIN board_members bm ON b.id = bm.board_id AND bm.user_id = $1

-- Admin: no board_members join, sees everything
```

## Files

**New:**
- `server/src/routes/search.ts` — search endpoint
- `server/src/migrations/017.sql` — GIN indexes
- `client/src/components/GlobalSearchModal.tsx` — search modal

**Modified:**
- `server/src/index.ts` — register search route
- `client/src/App.tsx` — `Ctrl+K` listener, render modal
- `client/src/components/AppBar.tsx` — search icon button

## Constraints

- 20 result limit, no pagination (refine query instead)
- No filter chips for MVP (pure text search)
- No saved searches for MVP
