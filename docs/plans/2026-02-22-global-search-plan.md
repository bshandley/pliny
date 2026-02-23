# Global Search Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add a command palette global search that finds cards, comments, and checklist items across all accessible boards.

**Architecture:** Single `GET /api/search` endpoint using PostgreSQL full-text search (`tsvector`/`tsquery` with GIN indexes) and a `UNION ALL` query across cards, comments, and checklist items. Frontend is a modal triggered by `Ctrl+K`/`Cmd+K` with debounced search, keyboard navigation, and result highlighting.

**Tech Stack:** PostgreSQL full-text search, Express route, React portal modal, CSS

**Design doc:** `docs/plans/2026-02-22-global-search-design.md`

---

### Task 1: Migration — GIN indexes for full-text search

**Files:**
- Create: `server/src/migrations/017-global-search.sql`

**Step 1: Write the migration**

```sql
-- Migration 017: GIN indexes for global search
-- Idempotent: safe to re-run

CREATE INDEX IF NOT EXISTS idx_cards_search
  ON cards USING GIN (to_tsvector('english', coalesce(title,'') || ' ' || coalesce(description,'')));

CREATE INDEX IF NOT EXISTS idx_comments_search
  ON card_comments USING GIN (to_tsvector('english', text));

CREATE INDEX IF NOT EXISTS idx_checklist_search
  ON card_checklist_items USING GIN (to_tsvector('english', text));
```

**Step 2: Verify migration runs**

Run: `cd /home/bradley/cork/server && npx ts-node src/migrations/run.ts`
Expected: Migration 017 runs without errors.

**Step 3: Commit**

```bash
git add server/src/migrations/017-global-search.sql
git commit -m "feat: add GIN indexes for global search (migration 017)"
```

---

### Task 2: Search API endpoint

**Files:**
- Create: `server/src/routes/search.ts`
- Modify: `server/src/index.ts:6-71` (add import + route registration)

**Step 1: Create the search route**

Create `server/src/routes/search.ts`:

```typescript
import { Router, Response } from 'express';
import pool from '../db';
import { authenticate } from '../middleware/auth';
import { AuthRequest } from '../types';

const router = Router();

router.get('/search', authenticate, async (req: AuthRequest, res: Response) => {
  try {
    const q = (req.query.q as string || '').trim();
    const limit = Math.min(parseInt(req.query.limit as string) || 20, 50);

    if (q.length < 2) {
      return res.json({ results: [], total: 0 });
    }

    const user = req.user!;
    const isAdmin = user.role === 'ADMIN';

    // Build tsquery from user input — prefix match for partial words
    const tsquery = q.split(/\s+/).filter(Boolean).map(w => `${w}:*`).join(' & ');

    // Board access clause: admins see all, others see only member boards
    const boardAccessJoin = isAdmin
      ? ''
      : 'INNER JOIN board_members bm ON b.id = bm.board_id AND bm.user_id = $2';

    const params: any[] = [tsquery];
    if (!isAdmin) params.push(user.id);
    const limitParam = `$${params.length + 1}`;
    params.push(limit);

    const query = `
      WITH search_results AS (
        -- Cards: title + description
        SELECT
          'card' as type,
          c.id as card_id,
          c.title as card_title,
          b.id as board_id,
          b.name as board_name,
          col.name as column_name,
          CASE
            WHEN to_tsvector('english', coalesce(c.title,'')) @@ to_tsquery('english', $1)
            THEN LEFT(c.title, 120)
            ELSE LEFT(coalesce(c.description, c.title), 120)
          END as match_text,
          ts_rank(
            setweight(to_tsvector('english', coalesce(c.title,'')), 'A') ||
            setweight(to_tsvector('english', coalesce(c.description,'')), 'B'),
            to_tsquery('english', $1)
          ) as rank
        FROM cards c
        INNER JOIN columns col ON c.column_id = col.id
        INNER JOIN boards b ON col.board_id = b.id
        ${boardAccessJoin}
        WHERE c.archived = false
          AND (
            to_tsvector('english', coalesce(c.title,'') || ' ' || coalesce(c.description,''))
            @@ to_tsquery('english', $1)
          )

        UNION ALL

        -- Comments
        SELECT
          'comment' as type,
          c.id as card_id,
          c.title as card_title,
          b.id as board_id,
          b.name as board_name,
          col.name as column_name,
          LEFT(cc.text, 120) as match_text,
          ts_rank(to_tsvector('english', cc.text), to_tsquery('english', $1)) as rank
        FROM card_comments cc
        INNER JOIN cards c ON cc.card_id = c.id
        INNER JOIN columns col ON c.column_id = col.id
        INNER JOIN boards b ON col.board_id = b.id
        ${boardAccessJoin}
        WHERE c.archived = false
          AND to_tsvector('english', cc.text) @@ to_tsquery('english', $1)

        UNION ALL

        -- Checklist items
        SELECT
          'checklist_item' as type,
          c.id as card_id,
          c.title as card_title,
          b.id as board_id,
          b.name as board_name,
          col.name as column_name,
          LEFT(ci.text, 120) as match_text,
          ts_rank(to_tsvector('english', ci.text), to_tsquery('english', $1)) as rank
        FROM card_checklist_items ci
        INNER JOIN cards c ON ci.card_id = c.id
        INNER JOIN columns col ON c.column_id = col.id
        INNER JOIN boards b ON col.board_id = b.id
        ${boardAccessJoin}
        WHERE c.archived = false
          AND to_tsvector('english', ci.text) @@ to_tsquery('english', $1)
      )
      SELECT * FROM search_results
      ORDER BY rank DESC
      LIMIT ${limitParam}
    `;

    const result = await pool.query(query, params);

    res.json({
      results: result.rows,
      total: result.rows.length,
    });
  } catch (err) {
    console.error('Search error:', err);
    res.status(500).json({ error: 'Search failed' });
  }
});

export default router;
```

**Step 2: Register the route in index.ts**

In `server/src/index.ts`, add after line 26 (`import csvRoutes`):
```typescript
import searchRoutes from './routes/search';
```

After line 71 (`app.use('/api', csvRoutes);`), add:
```typescript
app.use('/api', searchRoutes);
```

**Step 3: Verify server compiles**

Run: `cd /home/bradley/cork/server && npx tsc --noEmit`
Expected: No errors.

**Step 4: Commit**

```bash
git add server/src/routes/search.ts server/src/index.ts
git commit -m "feat: add global search API endpoint with full-text search"
```

---

### Task 3: Client API method

**Files:**
- Modify: `client/src/api.ts:438-460` (add search method before class closing brace)
- Modify: `client/src/types.ts` (add SearchResult type)

**Step 1: Add SearchResult type**

In `client/src/types.ts`, add after the `OidcAdminConfig` interface (after line 147):

```typescript
export interface SearchResult {
  type: 'card' | 'comment' | 'checklist_item';
  card_id: string;
  card_title: string;
  board_id: string;
  board_name: string;
  column_name: string;
  match_text: string;
  rank: number;
}

export interface SearchResponse {
  results: SearchResult[];
  total: number;
}
```

**Step 2: Add search method to ApiClient**

In `client/src/api.ts`, add before the closing brace of the class (before line 458 `}`):

```typescript
  // Search
  async search(q: string, limit: number = 20): Promise<SearchResponse> {
    return this.fetch(`/search?q=${encodeURIComponent(q)}&limit=${limit}`);
  }
```

Add `SearchResponse` to the imports on line 1.

**Step 3: Verify client compiles**

Run: `cd /home/bradley/cork/client && npx tsc --noEmit`
Expected: No errors.

**Step 4: Commit**

```bash
git add client/src/types.ts client/src/api.ts
git commit -m "feat: add search API client method and SearchResult type"
```

---

### Task 4: GlobalSearchModal component

**Files:**
- Create: `client/src/components/GlobalSearchModal.tsx`

**Step 1: Create the modal component**

Create `client/src/components/GlobalSearchModal.tsx`. This is the main UI — a command palette modal with:

- `createPortal` to `document.body`
- Auto-focused search input with 300ms debounce
- Minimum 2 character query length
- Loading spinner during API call
- Results list with type icons, card title, match snippet, board/column context
- Keyboard navigation: ArrowUp/ArrowDown to select, Enter to confirm, Escape to close
- Client-side bold highlighting of query terms in match_text
- Recent searches stored in localStorage (`global-search-recent`, last 5)
- On result click: call `onNavigate(boardId, cardId)` and close

**Props interface:**
```typescript
interface GlobalSearchModalProps {
  isOpen: boolean;
  onClose: () => void;
  onNavigate: (boardId: string, cardId: string) => void;
}
```

**Key implementation details:**
- Use `useRef` for the input to auto-focus on open
- Use `useState` for query, results, loading, selectedIndex
- Use `useEffect` with debounce timer (setTimeout/clearTimeout pattern) to call `api.search(query)`
- Render via `createPortal(modal, document.body)` — same pattern as other portal components in the project
- Result highlighting: split `match_text` on query term (case-insensitive), wrap matches in `<strong>`
- Recent searches: read from `localStorage.getItem('global-search-recent')`, parse as `string[]`, display as clickable chips when input is empty
- On search execution, prepend query to recent list, deduplicate, keep last 5, save to localStorage

**CSS classes** (add to existing `client/src/index.css`):
- `.search-modal-backdrop` — fixed overlay, dark transparent background, z-index above everything
- `.search-modal` — centered white box, rounded corners, max-width 600px, max-height 70vh
- `.search-modal-input` — full-width input at top, large font, no border
- `.search-modal-results` — scrollable results list
- `.search-result-item` — flex row with hover/selected state highlighting
- `.search-result-icon` — small type icon (card/comment/checkbox SVG)
- `.search-result-content` — card title + match snippet
- `.search-result-meta` — board name + column name, right-aligned, muted
- `.search-result-item.selected` — keyboard-selected highlight (same as hover)
- `.search-highlight` — bold styling on matched text
- `.search-recent` — recent search chips section
- `.search-empty` — "No results" message styling
- Mobile: `.search-modal` goes full-width at `max-width: 640px` breakpoint

**Step 2: Verify it compiles**

Run: `cd /home/bradley/cork/client && npx tsc --noEmit`
Expected: No errors.

**Step 3: Commit**

```bash
git add client/src/components/GlobalSearchModal.tsx
git commit -m "feat: add GlobalSearchModal command palette component"
```

---

### Task 5: CSS styles for the search modal

**Files:**
- Modify: `client/src/index.css` (add search modal styles at the end)

**Step 1: Add CSS**

Append search modal styles to `client/src/index.css`. Follow existing project patterns:
- Use CSS custom properties from the theme (`var(--bg)`, `var(--text)`, `var(--border)`, etc.)
- Support dark mode via `[data-theme="dark"]` selectors or existing custom properties
- Mobile responsive at 640px breakpoint (same as rest of the project)

Key styles needed:
- Backdrop: fixed, full-screen, semi-transparent black
- Modal: centered, white bg, border-radius, box-shadow, overflow hidden
- Input: large, padded, border-bottom separator, no outline ring
- Results: overflow-y auto, max-height fills remaining modal space
- Result items: padding, flex layout, hover/selected background change
- Meta (board/column): smaller font, muted color, right-aligned
- Recent searches: horizontal chip layout with subtle background
- Mobile: full-width modal, larger touch targets

**Step 2: Verify styles render correctly**

Run: `cd /home/bradley/cork/client && npm run dev`
Open browser, press Ctrl+K, verify modal appearance.

**Step 3: Commit**

```bash
git add client/src/index.css
git commit -m "style: add global search modal CSS"
```

---

### Task 6: Wire up modal in App.tsx and AppBar.tsx

**Files:**
- Modify: `client/src/App.tsx:1-13` (imports), `client/src/App.tsx:43-55` (state), `client/src/App.tsx:460-525` (render)
- Modify: `client/src/components/AppBar.tsx:28-84` (add search button)

**Step 1: Add keyboard shortcut and modal state to App.tsx**

In `client/src/App.tsx`:

1. Add import at top (after line 12):
```typescript
import GlobalSearchModal from './components/GlobalSearchModal';
```

2. Add state in the `App` function (after line 55, the `sso2faTicket` state):
```typescript
const [searchOpen, setSearchOpen] = useState(false);
```

3. Add `useEffect` for the `Ctrl+K` / `Cmd+K` keyboard shortcut (after the theme effect around line 257):
```typescript
useEffect(() => {
  const handleKeyDown = (e: KeyboardEvent) => {
    if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
      e.preventDefault();
      setSearchOpen(true);
    }
  };
  window.addEventListener('keydown', handleKeyDown);
  return () => window.removeEventListener('keydown', handleKeyDown);
}, []);
```

4. Add `onSearchOpen` to the `appBarContext` useMemo (around line 415):
```typescript
onSearchOpen: () => setSearchOpen(true),
```

5. Render the modal inside the `AppBarContext.Provider`, right before the closing `</AppBarContext.Provider>` tag (before line 524):
```typescript
<GlobalSearchModal
  isOpen={searchOpen}
  onClose={() => setSearchOpen(false)}
  onNavigate={handleNavigateToBoard}
/>
```

**Step 2: Add search button to AppBar.tsx**

In `client/src/components/AppBar.tsx`:

1. Add `onSearchOpen` to the destructured context (line 15-26):
```typescript
const { ..., onSearchOpen } = useAppBar();
```

2. Add a search icon button inside `.app-bar-global`, before the notification bell (before line 48):
```typescript
<button
  className="app-bar-icon-btn"
  onClick={onSearchOpen}
  aria-label="Search"
  title="Search (Ctrl+K)"
>
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>
  </svg>
</button>
```

**Step 3: Update AppBarContext type**

In `client/src/contexts/AppBarContext.ts` (or wherever the context type is defined), add `onSearchOpen: () => void` to the context interface.

**Step 4: Verify everything works end-to-end**

Run: `cd /home/bradley/cork/client && npm run dev` and `cd /home/bradley/cork/server && npm run dev`

1. Press `Ctrl+K` — modal should open
2. Click search icon in AppBar — modal should open
3. Type a query (2+ chars) — results should appear after 300ms
4. Arrow keys navigate results, Enter selects
5. Clicking a result navigates to the board and opens the card
6. Escape closes the modal
7. Recent searches appear when input is empty

**Step 5: Commit**

```bash
git add client/src/App.tsx client/src/components/AppBar.tsx client/src/contexts/AppBarContext.ts
git commit -m "feat: wire up global search modal with Ctrl+K shortcut"
```

---

### Task 7: Final integration test and polish

**Files:**
- Possibly modify: any of the above files for bug fixes

**Step 1: Test cross-board search**

1. Create cards on multiple boards with distinct content
2. Search for a term that exists on different boards
3. Verify results show correct board names and navigate correctly

**Step 2: Test RBAC**

1. Log in as a non-admin user
2. Search — should only see results from boards they're a member of
3. Log in as admin — should see results from all boards

**Step 3: Test edge cases**

1. Empty query — should show recent searches, no API call
2. Single character — should not trigger search
3. Special characters in query — should not crash
4. No results — should show "No results found" message
5. Very long results — match_text should be truncated at ~120 chars

**Step 4: Commit any fixes**

```bash
git add -A
git commit -m "fix: polish global search edge cases"
```
