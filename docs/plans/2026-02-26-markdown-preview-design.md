# Markdown Live Preview Editor — Design

## Goal

Replace the plain `<textarea>` card description editor with a split-pane markdown editor that shows a live preview alongside the editing area, plus a toolbar for common formatting.

## Decisions

- **Layout**: Split-pane on desktop (textarea left, preview right). Toggle tabs (Write/Preview) on mobile.
- **Approach**: Custom `<MarkdownEditor>` component. No new dependencies — reuses existing `marked` + `dompurify` via `MarkdownRenderer`.
- **Toolbar buttons**: Bold, Italic, Heading, Inline Code, Code Block, Bullet List, Link.

## Component: `MarkdownEditor`

**Props**: `value`, `onChange`, `placeholder`, `maxLength` — controlled input, drop-in replacement for the textarea.

**Internal structure**:
- Toolbar row (icon buttons)
- Editor area: split-pane (desktop) or tabbed Write/Preview (mobile)

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

- Toolbar: `btn-secondary btn-sm` style buttons in a horizontal row, border-bottom separator.
- Split-pane: CSS grid `1fr 1fr`, subtle vertical divider. Preview uses `.prose` + `var(--bg-secondary)` background.
- Mobile: `isMobile` detection triggers tab mode. Tab bar matches toolbar styling.
- Textarea keeps existing `card-edit-description` styling.

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
- `client/src/index.css` — add editor styles (toolbar, split-pane, mobile tabs)

## No New Dependencies

Reuses `marked`, `dompurify`, and `MarkdownRenderer.tsx`.
