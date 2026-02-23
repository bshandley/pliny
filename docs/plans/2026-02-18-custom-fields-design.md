# Custom Fields Design

## Problem

Plank boards have a fixed set of card properties (title, description, assignees, due date, labels, checklist). Different teams need different metadata — priority levels, story points, URLs, approval status, cost estimates. Without custom fields, users resort to abusing description text or label hacks to track structured data.

## Design

### Data Model

Two new tables (Migration 012):

**`board_custom_fields`** — field definitions scoped to a board:

| Column | Type | Notes |
|--------|------|-------|
| id | UUID PK | |
| board_id | UUID FK → boards | |
| name | VARCHAR(100) | Display name |
| field_type | VARCHAR(20) | `text`, `number`, `date`, `dropdown`, `checkbox` |
| options | JSONB | For dropdown: `["Option A", "Option B"]`. NULL for other types |
| position | INTEGER | Display order |
| show_on_card | BOOLEAN | Whether to show on collapsed card view |
| created_at | TIMESTAMP | |

**`card_custom_field_values`** — values per card per field:

| Column | Type | Notes |
|--------|------|-------|
| id | UUID PK | |
| card_id | UUID FK → cards | ON DELETE CASCADE |
| field_id | UUID FK → board_custom_fields | ON DELETE CASCADE |
| value | TEXT | All types stored as TEXT, parsed by field_type on read |
| created_at | TIMESTAMP | |
| updated_at | TIMESTAMP | |

Unique constraint on `(card_id, field_id)` — one value per field per card.

**Storage format by type:**
- `text`: raw string
- `number`: numeric string (e.g. `"42"`, `"3.14"`)
- `date`: ISO date string `YYYY-MM-DD`
- `dropdown`: exact string matching one of the `options` array entries
- `checkbox`: `"true"` or `"false"`

### API Endpoints

All under `/api/boards/:boardId/custom-fields` (authenticate + requireAdmin for mutations):

| Method | Path | Action |
|--------|------|--------|
| GET | `/api/boards/:boardId/custom-fields` | List field definitions |
| POST | `/api/boards/:boardId/custom-fields` | Create field definition |
| PUT | `/api/custom-fields/:fieldId` | Update field definition |
| DELETE | `/api/custom-fields/:fieldId` | Delete field + all values |

Card field values:

| Method | Path | Action |
|--------|------|--------|
| GET | `/api/cards/:cardId/custom-fields` | Get all field values for a card |
| PUT | `/api/cards/:cardId/custom-fields` | Bulk set field values (JSON object `{ fieldId: value }`) |

### Board Fetch Enhancement

The existing `GET /boards/:id` response is extended:
- `board.custom_fields`: array of field definitions (sorted by position)
- Each `card.custom_field_values`: object `{ fieldId: { value, field_type, name } }` — hydrated with field metadata for easy rendering

This avoids N+1 queries — everything comes down in the single board fetch.

### UI: Field Manager

Accessible from the board settings dropdown (gear icon), similar to the existing BoardLabels modal.

**Field Manager Modal:**
- Header: "Custom Fields" + close button
- List of existing fields with drag handle, name, type badge, "Show on card" toggle, edit/delete buttons
- "Add field" row at bottom: name input + type dropdown + "Add" button
- Edit mode: inline editing of name, type (immutable after creation if values exist), options list (for dropdown type)
- Delete: confirmation prompt, deletes field + all card values

**Dropdown options editor:**
- When field_type is `dropdown`, show an options list below the field row
- Each option: text input + delete button
- "Add option" button at bottom
- Options stored as JSONB array, order preserved

### UI: Card Detail View

In the expanded card (KanbanCard editing mode), custom fields render below the description and above the checklist:

**Section: "Custom Fields"**
- One row per field definition (ordered by position)
- Type-specific editors:
  - `text`: inline text input
  - `number`: number input with step
  - `date`: date input (same native `<input type="date">` pattern as due date)
  - `dropdown`: `<select>` with field options
  - `checkbox`: toggle checkbox
- Values auto-save on blur/change (PUT to bulk endpoint)
- Empty fields show placeholder text ("Set value...")
- Read-only for non-admin users (display value, no input)

### UI: Collapsed Card Display

Fields with `show_on_card: true` display as compact badges below the card title:
- `text`: truncated to 20 chars with ellipsis
- `number`: formatted number
- `date`: "Mon DD" format
- `dropdown`: option text as pill badge
- `checkbox`: small check/uncheck icon

Maximum 3 fields shown on collapsed card; if more, show "+N" indicator.

### Filter Bar Integration

New filter in the filter bar: "Custom Fields" dropdown.
- Renders a dropdown with all field definitions
- Selecting a field shows a type-appropriate value selector:
  - `text`: text input (substring match)
  - `number`: min/max range inputs
  - `dropdown`: select from options
  - `checkbox`: true/false toggle
  - `date`: before/after date inputs
- Multiple field filters combine with AND logic
- `filterCard` function extended to check custom field values

### Files

**New:**
- `server/src/migrations/012-custom-fields.sql` — schema
- `server/src/routes/customFields.ts` — API routes
- `client/src/components/CustomFieldManager.tsx` — field definition modal
- `client/src/components/CustomFieldEditor.tsx` — type-specific editors for card detail

**Modified:**
- `server/src/routes/boards.ts` — extend GET /boards/:id to include custom fields
- `server/src/index.ts` — mount custom fields routes
- `client/src/types.ts` — add CustomField, CustomFieldValue types
- `client/src/api.ts` — add custom field API methods
- `client/src/components/KanbanBoard.tsx` — field manager modal trigger, filter bar extension
- `client/src/components/KanbanCard.tsx` — render custom fields in detail + collapsed views
- `client/src/index.css` — custom field styles

### What Stays the Same

- All existing card properties and behavior
- Board fetch pattern (single GET, extended not replaced)
- Card CRUD endpoints (custom fields have separate endpoints)
- Existing filter logic (extended, not replaced)
- DnD, views (board/calendar), and all other features

### Key Interactions

| Action | Result |
|--------|--------|
| Admin opens field manager | Modal with field definitions list |
| Admin adds a text field "Priority" | Field created, appears in all card details |
| Admin sets field to "show on card" | Collapsed cards display the value as badge |
| User clicks text field in card detail | Inline editor appears (admin only) |
| User selects dropdown value | Value saved via PUT, card updates |
| User filters by custom field | Cards filtered by field value match |
| Admin deletes a field | Field + all values removed after confirmation |
| Dropdown field options changed | Existing values that no longer match show as-is (not auto-cleared) |
