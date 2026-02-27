# Markdown Live Preview Editor — Design

## Goal

Replace the plain `<textarea>` card description editor with a tabbed markdown editor (Write/Preview toggle) with live preview and a formatting toolbar.

## Decisions

- **Layout**: Toggle tabs (Write/Preview) on all screen sizes. Card modal is too narrow for side-by-side split-pane.
- **Approach**: Custom `<MarkdownEditor>` component. No new dependencies — reuses existing `marked` + `dompurify` via `MarkdownRenderer`.
- **Toolbar buttons**: Bold, Italic, Heading, Inline Code, Code Block, Bullet List, Link.

## Component: `MarkdownEditor`

**Props**: `value`, `onChange`, `placeholder`, `maxLength` — controlled input, drop-in replacement for the textarea.

**Internal structure**:
- Header row with Write/Preview tab buttons (`btn-secondary btn-sm`) + toolbar icons (visible in Write mode only)
- Body: textarea (Write tab) or rendered markdown preview (Preview tab)

### Toolbar Behavior

| Button | No selection | With selection |
|--------|-------------|----------------|
| Bold | Insert `**bold**` | Wrap: `**selection**` |
| Italic | Insert `*italic*` | Wrap: `*selection*` |
| Heading | Insert `## ` at line start | Prepend `## ` to line |
| Inline Code | Insert `` `code` `` | Wrap: `` `selection` `` |
| Code Block | Insert fenced block | Wrap in fenced block |
| Bullet List | Insert `- ` at line start | Prepend `- ` to each line |
| Link | Insert `[text](url)` | Wrap: `[selection](url)` |

Cursor repositioned after insertion for natural typing flow.

### Styling

- Header: tab buttons use `btn-secondary btn-sm`, active tab gets `--primary` background. Toolbar icons in monospace font, right-aligned.
- Preview pane: `var(--bg-raised)` background, `.prose` styling from `MarkdownRenderer`.
- Textarea keeps existing `card-edit-description` styling, no border/shadow inside the editor container.

### Integration

Replace textarea in `KanbanCard.tsx` (~line 807) with:
```tsx
<MarkdownEditor
  value={editDescription}
  onChange={setEditDescription}
  placeholder="Description (optional)"
  maxLength={10000}
/>
```

"Save description" button stays in `KanbanCard.tsx`, outside the editor.

## Files Affected

- `client/src/components/MarkdownEditor.tsx` — new component
- `client/src/components/KanbanCard.tsx` — replace textarea with `<MarkdownEditor>`
- `client/src/index.css` — add editor styles (toolbar, tabs, preview)

## No New Dependencies

Reuses `marked`, `dompurify`, and `MarkdownRenderer.tsx`.
