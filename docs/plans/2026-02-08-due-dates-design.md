# Due Dates Design

Add optional due dates to cards for visual awareness of deadlines.

## Data Model

Nullable `due_date DATE` column on the `cards` table. No time component - date only. Sent as ISO string (`"2026-02-15"`) over the API, `null` to clear.

## API

No new endpoints. Existing card create/update accept optional `due_date` field.

## Frontend - Card Edit

Native `<input type="date">` in the card edit view, below the description. Clear button sets to null.

## Frontend - Board View Badge

Colored pill badge on cards with due dates, alongside assignee badges:

- **Gray** - due date more than 24 hours away (shows "Feb 15" format)
- **Orange** - due within 24 hours ("Today" / "Tomorrow")
- **Red** - overdue ("Overdue")

## File Changes

- `server/src/migrations/schema.sql` - `due_date DATE` in cards table
- `server/src/migrations/003-due-dates.sql` - ALTER TABLE for existing installs
- `server/src/migrations/run.ts` - run new migration
- `server/src/types.ts` - `due_date` on Card interface
- `server/src/routes/cards.ts` - include `due_date` in INSERT/UPDATE
- `client/src/types.ts` - `due_date` on Card interface
- `client/src/components/KanbanCard.tsx` - date picker + badge display
- `client/src/index.css` - badge styles with dark mode support
