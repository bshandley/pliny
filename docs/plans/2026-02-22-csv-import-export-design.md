# CSV Import/Export Design

## Overview

Add CSV export and import functionality to Plank, accessible from the board settings menu. Admin-only. Cards-level data scope (no checklists or comments). Server-side approach for both export and import.

## Export

**Endpoint:** `GET /api/boards/:id/export/csv`

- Admin-only
- Returns `Content-Type: text/csv` with `Content-Disposition: attachment; filename="board-name-YYYY-MM-DD.csv"`
- Archived cards excluded
- Cards ordered by column position, then card position

**CSV Columns:**

| CSV Column | Source |
|---|---|
| Title | `cards.title` |
| Description | `cards.description` |
| Column | `columns.name` (resolved from `column_id`) |
| Position | `cards.position` |
| Assignees | Comma-separated from `card_assignees` |
| Labels | Comma-separated label names from `card_labels` + `board_labels` |
| Due Date | `cards.due_date` (ISO format YYYY-MM-DD) |
| Start Date | `cards.start_date` (ISO format) |
| Created At | `cards.created_at` |
| *Custom fields* | One column per custom field, named by field name |

## Import — Backend

Two-step server-side flow.

### Step 1: Parse & Preview

`POST /api/boards/:id/import/csv/preview`

- Accepts multipart file upload (5MB max)
- Parses CSV, returns JSON response:
  - `headers`: array of CSV column names found
  - `suggestedMapping`: auto-matched headers to Plank fields (fuzzy match — "title", "due date", "due_date", "dueDate" all map to `due_date`)
  - `sampleRows`: first 5 rows for preview
  - `rowCount`: total row count
  - `customFields`: board's custom fields available for mapping
- Parsed data stored temporarily (in-memory or temp file, discarded after confirm or timeout)

### Step 2: Confirm & Create

`POST /api/boards/:id/import/csv/confirm`

- Accepts final column mapping + reference to parsed data
- Validates all values (dates, labels, assignees)
- Creates cards in a single database transaction
- Returns: `{ created: number, errors: [{ row: number, field: string, message: string }] }`

**Key behaviors:**
- Unknown labels/assignees in CSV → auto-create them on the board
- No "Column" mapping → cards go into leftmost column
- Invalid dates → skip that field, include in error report, still create the card
- Cards placed at bottom of target column
- Admin-only access

## Import — Frontend UI

### Entry Point

New menu items in the board settings dropdown (alongside Add Column, Archived, Members, etc.):
- "Export to CSV"
- "Import from CSV"

Both visible to admins only.

### Export Flow

Click "Export to CSV" → immediate file download. Toast notification: "Exported N cards."

### Import Flow — Modal

**State 1: Upload**
- Modal title: "Import Cards from CSV"
- Drag-and-drop zone + file picker button
- Accepts `.csv` files only
- On file select → calls preview endpoint → transitions to State 2

**State 2: Map & Preview**
- Left side: Column mapping table
  - Each CSV header as a row
  - Dropdown next to each: map to a Plank field or "Skip"
  - Auto-mapped fields pre-selected and highlighted
- Right side: Preview table showing first 5 rows with mapped field names as headers
- Bottom: "Import X cards" button + "Cancel"
- On confirm → calls confirm endpoint → result toast ("Imported N cards, M rows had warnings") → close modal, board refreshes via socket

## Technical Details

**Dependencies:**
- `csv-parse` and `csv-stringify` packages for CSV parsing/generation
- No database migration needed — uses existing card tables and APIs

**Permissions:** Admin-only for both import and export.

**File size limit:** 5MB max CSV upload.

**Error handling:**
- Malformed CSV → reject at preview step with clear message
- Partial failures on import → transaction rolls back, return full error list
- Empty CSV → reject at preview step
