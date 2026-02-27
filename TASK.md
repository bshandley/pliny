# Pliny: Trello JSON Import

Read CLAUDE_CONTEXT.md first.

## Overview
Add Trello board JSON import. UI flow mirrors existing CSV import: upload → preview → confirm → import. Server-side only; no new dependencies needed.

## Trello JSON Structure (what we care about)

```json
{
  "name": "Board Name",
  "lists": [{ "id": "...", "name": "To Do", "closed": false, "pos": 1 }],
  "cards": [{
    "id": "...", "name": "Card title", "desc": "description",
    "closed": false, "due": "2026-03-01T00:00:00.000Z",
    "idList": "...", "pos": 65536,
    "idLabels": ["..."],
    "idMembers": ["..."],
    "checklists": [{ ... }]
  }],
  "labels": [{ "id": "...", "name": "", "color": "green" }],
  "members": [{ "id": "...", "username": "jsmith", "fullName": "John Smith" }],
  "checklists": [{
    "id": "...", "idCard": "...", "name": "Checklist",
    "checkItems": [{ "name": "Item text", "state": "complete", "pos": 1 }]
  }],
  "actions": [{
    "type": "commentCard",
    "date": "2026-01-15T10:00:00.000Z",
    "memberCreator": { "username": "jsmith", "fullName": "John Smith" },
    "data": { "card": { "id": "..." }, "text": "Comment text" }
  }]
}
```

## Color Mapping (Trello → Pliny hex)
```
green      → #61bd4f
yellow     → #f2d600
orange     → #ff9f1a
red        → #eb5a46
purple     → #c377e0
blue       → #0079bf
sky        → #00c2e0
lime       → #51e898
pink       → #ff78cb
black      → #344563
(null/none) → #b3bac5
```

---

## Backend

### New route file: `server/src/routes/trello.ts`

**`POST /api/trello/preview`** — `authenticate, requireMember` (uses multer, single JSON file upload)
- Parse the uploaded JSON
- Return a summary: board name, list count, card count (total / archived), label count, member count, comment count, checklist item count
- Return member matching: for each Trello member, check if a Pliny user exists with that username. Return `{ trelloUsername, fullName, matched: bool, plinyUserId? }` array
- Return `{ summary, members }` — no DB writes

**`POST /api/trello/import`** — `authenticate, requireMember` (JSON body, not multipart — client sends parsed data from preview step)
- Body: `{ boardData: <full trello JSON>, targetBoardId?: string }`
- If `targetBoardId` provided: import into existing board (add columns/cards to it)
- If not: create a new board named after the Trello board, creator auto-added as board ADMIN

Import order (use a DB transaction):
1. Create board (or use existing)
2. Create labels — map Trello label id → new Pliny label id
3. Create columns from `lists` (skip `closed: true` lists — archive those as well, or just skip closed lists for simplicity)
4. Create cards: map `idList` → column id, set `archived = card.closed`, convert `due` ISO string → date, preserve `pos`
5. Create card assignees: match `idMembers` to Pliny users by username (case-insensitive). If matched, use `user_id`. If not, use `display_name = fullName` (unlinked assignee).
6. Apply labels to cards: `idLabels` → mapped Pliny label ids
7. Create checklists: from top-level `checklists` array, match to card by `idCard`, create `card_checklist_items` with `checked = (state === 'complete')`, preserve `pos`
8. Create comments: from `actions` where `type === 'commentCard'`, insert into `card_comments` with `text = "[Trello: @username] comment text"`, use importing user's id as `user_id` (since we don't know who owns the Pliny account)

Return: `{ boardId, boardName, stats: { columns, cards, labels, comments, checklistItems, assignees } }`

### Register in `server/src/index.ts`
```typescript
import trelloRouter from './routes/trello';
app.use('/api/trello', trelloRouter);
```

### Multer setup
Use same pattern as CSV import (`multer({ storage: multer.memoryStorage() })`). Parse buffer as JSON in the route handler.

---

## Frontend

### New component: `client/src/components/TrelloImport.tsx`

Three-step UI (mirrors CSV import pattern):

**Step 1: Upload**
- Simple drag-and-drop or file picker (`.json` only)
- "Export from Trello: Board → Share, print, and export → Export as JSON"
- On file select: POST to `/api/trello/preview`, show loading state

**Step 2: Preview**
Show a summary card:
```
Board: "My Trello Board"
├── 5 columns
├── 47 cards (3 archived)
├── 8 labels
├── 12 members (9 matched, 3 unmatched → imported as guest assignees)
├── 23 comments
└── 104 checklist items
```

Below summary, show member matching table:
| Trello username | Full Name | Status |
|---|---|---|
| jsmith | John Smith | ✅ Matched to jsmith |
| cooluser99 | Alex Wang | ⚠️ No match — will import as guest |

"Import" button (primary) and "Cancel" button.

**Step 3: Done**
Show stats of what was imported. "Go to board" button → navigate to new board.

### Hook into existing UI

Add a "Import from Trello" option in the board list page (wherever CSV import is accessible, or next to "Create board"). 

If there's already an import button/menu, add Trello as an option alongside CSV. If not, add a simple "Import" dropdown button on the board list page.

---

## No Migration Needed
All data goes into existing tables. No schema changes.

---

## Error Handling
- Invalid JSON → "This doesn't look like a valid Trello export file"
- File too large (>50MB) → "File too large. Trello exports are usually under 10MB."
- Import transaction failure → rollback entire import, return error (don't leave partial data)

---

## Commit & Notify
When complete:
- Commit: `feat: Trello JSON import (preview + confirm flow)`
- Push to origin/main
- Run: `openclaw system event --text "Done: Trello import feature complete" --mode now`
