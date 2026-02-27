# Markdown Live Preview Editor — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Replace the plain textarea description editor in card detail view with a split-pane markdown editor (live preview + formatting toolbar).

**Architecture:** New `<MarkdownEditor>` controlled component wraps a textarea + existing `MarkdownRenderer`. Split-pane on desktop via CSS grid, Write/Preview tabs on mobile. Toolbar buttons insert markdown syntax at cursor. No new dependencies.

**Tech Stack:** React 18, TypeScript, existing `marked` + `dompurify` via `MarkdownRenderer`, custom CSS with design tokens.

---

### Task 1: Create MarkdownEditor component with toolbar and split-pane

**Files:**
- Create: `client/src/components/MarkdownEditor.tsx`

**Step 1: Create the component file**

Create `client/src/components/MarkdownEditor.tsx` with the full implementation:

```tsx
import { useState, useRef, useCallback } from 'react';
import MarkdownRenderer from './MarkdownRenderer';

interface MarkdownEditorProps {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  maxLength?: number;
  isMobile?: boolean;
}

type FormatAction = 'bold' | 'italic' | 'heading' | 'inlineCode' | 'codeBlock' | 'bulletList' | 'link';

function applyFormat(
  textarea: HTMLTextAreaElement,
  value: string,
  action: FormatAction
): { newValue: string; cursorPos: number } {
  const start = textarea.selectionStart;
  const end = textarea.selectionEnd;
  const selected = value.slice(start, end);
  const before = value.slice(0, start);
  const after = value.slice(end);

  let insert: string;
  let cursor: number;

  switch (action) {
    case 'bold':
      if (selected) {
        insert = `**${selected}**`;
        cursor = start + insert.length;
      } else {
        insert = '**bold**';
        cursor = start + 2; // inside the **
      }
      break;

    case 'italic':
      if (selected) {
        insert = `*${selected}*`;
        cursor = start + insert.length;
      } else {
        insert = '*italic*';
        cursor = start + 1;
      }
      break;

    case 'heading': {
      // Find the start of the current line
      const lineStart = before.lastIndexOf('\n') + 1;
      const linePrefix = value.slice(lineStart, start);
      const beforeLine = value.slice(0, lineStart);
      const restOfLine = value.slice(start);
      if (selected) {
        insert = `## ${selected}`;
        return {
          newValue: beforeLine + `## ${linePrefix}` + restOfLine,
          cursorPos: start + 3,
        };
      } else {
        return {
          newValue: beforeLine + `## ${linePrefix}` + restOfLine,
          cursorPos: start + 3,
        };
      }
    }

    case 'inlineCode':
      if (selected) {
        insert = `\`${selected}\``;
        cursor = start + insert.length;
      } else {
        insert = '`code`';
        cursor = start + 1;
      }
      break;

    case 'codeBlock':
      if (selected) {
        insert = `\n\`\`\`\n${selected}\n\`\`\`\n`;
      } else {
        insert = `\n\`\`\`\n\n\`\`\`\n`;
      }
      cursor = start + 5; // after the opening ``` and newline
      break;

    case 'bulletList':
      if (selected) {
        const lines = selected.split('\n');
        insert = lines.map(l => `- ${l}`).join('\n');
        cursor = start + insert.length;
      } else {
        // Find the start of the current line
        const ls = before.lastIndexOf('\n') + 1;
        const lp = value.slice(ls, start);
        const bl = value.slice(0, ls);
        const rl = value.slice(start);
        return {
          newValue: bl + `- ${lp}` + rl,
          cursorPos: start + 2,
        };
      }
      break;

    case 'link':
      if (selected) {
        insert = `[${selected}](url)`;
        cursor = start + selected.length + 3; // position on "url"
      } else {
        insert = '[text](url)';
        cursor = start + 1; // position on "text"
      }
      break;

    default:
      return { newValue: value, cursorPos: start };
  }

  return {
    newValue: before + insert + after,
    cursorPos: cursor,
  };
}

const TOOLBAR_BUTTONS: { action: FormatAction; label: string; icon: string; title: string }[] = [
  { action: 'bold', label: 'B', icon: 'B', title: 'Bold' },
  { action: 'italic', label: 'I', icon: 'I', title: 'Italic' },
  { action: 'heading', label: 'H', icon: 'H', title: 'Heading' },
  { action: 'inlineCode', label: '<>', icon: '<>', title: 'Inline code' },
  { action: 'codeBlock', label: '{}', icon: '{}', title: 'Code block' },
  { action: 'bulletList', label: '•', icon: '•', title: 'Bullet list' },
  { action: 'link', label: '🔗', icon: '🔗', title: 'Link' },
];

export default function MarkdownEditor({
  value,
  onChange,
  placeholder,
  maxLength,
  isMobile = false,
}: MarkdownEditorProps) {
  const [activeTab, setActiveTab] = useState<'write' | 'preview'>('write');
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const handleToolbarClick = useCallback(
    (action: FormatAction) => {
      const textarea = textareaRef.current;
      if (!textarea) return;

      const { newValue, cursorPos } = applyFormat(textarea, value, action);
      onChange(newValue);

      // Restore focus and cursor position after React re-render
      requestAnimationFrame(() => {
        textarea.focus();
        textarea.setSelectionRange(cursorPos, cursorPos);
      });
    },
    [value, onChange]
  );

  const toolbar = (
    <div className="md-editor-toolbar">
      {TOOLBAR_BUTTONS.map((btn) => (
        <button
          key={btn.action}
          type="button"
          className="md-toolbar-btn"
          title={btn.title}
          onMouseDown={(e) => e.preventDefault()} // prevent textarea blur
          onClick={() => handleToolbarClick(btn.action)}
        >
          {btn.icon}
        </button>
      ))}
    </div>
  );

  const textareaEl = (
    <textarea
      ref={textareaRef}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
      maxLength={maxLength}
      className="card-edit-description md-editor-textarea"
      rows={6}
    />
  );

  const previewEl = (
    <div className="md-editor-preview">
      {value ? (
        <MarkdownRenderer content={value} />
      ) : (
        <span className="md-editor-preview-empty">Preview</span>
      )}
    </div>
  );

  if (isMobile) {
    return (
      <div className="md-editor md-editor-mobile">
        <div className="md-editor-tabs">
          <button
            type="button"
            className={`md-tab-btn ${activeTab === 'write' ? 'active' : ''}`}
            onClick={() => setActiveTab('write')}
          >
            Write
          </button>
          <button
            type="button"
            className={`md-tab-btn ${activeTab === 'preview' ? 'active' : ''}`}
            onClick={() => setActiveTab('preview')}
          >
            Preview
          </button>
        </div>
        {activeTab === 'write' && toolbar}
        {activeTab === 'write' ? textareaEl : previewEl}
      </div>
    );
  }

  return (
    <div className="md-editor">
      {toolbar}
      <div className="md-editor-split">
        {textareaEl}
        {previewEl}
      </div>
    </div>
  );
}
```

**Step 2: Verify it compiles**

Run: `cd /home/bradley/pliny && npx tsc --noEmit --project client/tsconfig.json 2>&1 | head -20`
Expected: No errors (or only pre-existing errors unrelated to this file)

**Step 3: Commit**

```bash
git add client/src/components/MarkdownEditor.tsx
git commit -m "feat: add MarkdownEditor component with toolbar and split-pane preview"
```

---

### Task 2: Add CSS styles for the markdown editor

**Files:**
- Modify: `client/src/index.css` (append after the existing `.card-edit-description:focus` block around line 1392)

**Step 1: Add the CSS**

Append the following CSS after the `.card-edit-description:focus` rule block (after line 1392 in `index.css`):

```css
/* Markdown Editor */
.md-editor {
  margin-top: 0.25rem;
  margin-bottom: 0.5rem;
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  overflow: hidden;
}

.md-editor-toolbar {
  display: flex;
  gap: 2px;
  padding: 0.25rem 0.375rem;
  background: var(--bg-raised);
  border-bottom: 1px solid var(--border);
}

.md-toolbar-btn {
  padding: 0.25rem 0.5rem;
  background: transparent;
  color: var(--text-secondary);
  border: none;
  border-radius: var(--radius-sm);
  font-size: 0.75rem;
  font-weight: 600;
  cursor: pointer;
  line-height: 1;
  font-family: 'SF Mono', 'Fira Code', 'Cascadia Code', monospace;
  transition: background 0.1s var(--ease), color 0.1s var(--ease);
}

.md-toolbar-btn:hover {
  background: var(--border);
  color: var(--text);
}

.md-editor-split {
  display: grid;
  grid-template-columns: 1fr 1fr;
}

.md-editor .md-editor-textarea {
  border: none;
  border-radius: 0;
  margin: 0;
  resize: vertical;
  min-height: 120px;
  border-right: 1px solid var(--border);
}

.md-editor .md-editor-textarea:focus {
  box-shadow: none;
  border-color: var(--border);
}

.md-editor-preview {
  padding: 0.5rem 0.625rem;
  background: var(--bg-raised);
  overflow-y: auto;
  min-height: 120px;
  max-height: 300px;
}

.md-editor-preview-empty {
  color: var(--text-secondary);
  font-size: 0.8125rem;
  font-style: italic;
}

/* Mobile tabs */
.md-editor-tabs {
  display: flex;
  border-bottom: 1px solid var(--border);
}

.md-tab-btn {
  flex: 1;
  padding: 0.375rem 0.75rem;
  background: transparent;
  color: var(--text-secondary);
  border: none;
  border-bottom: 2px solid transparent;
  font-size: 0.8125rem;
  font-weight: 500;
  cursor: pointer;
  transition: color 0.15s var(--ease), border-color 0.15s var(--ease);
}

.md-tab-btn.active {
  color: var(--primary);
  border-bottom-color: var(--primary);
}

.md-tab-btn:hover:not(.active) {
  color: var(--text);
}

.md-editor-mobile .md-editor-textarea {
  border: none;
  border-radius: 0;
  margin: 0;
  min-height: 150px;
}

.md-editor-mobile .md-editor-textarea:focus {
  box-shadow: none;
}

.md-editor-mobile .md-editor-preview {
  max-height: none;
}

/* Fullscreen mobile overrides */
.card-fullscreen-body .md-editor {
  flex: 1;
  display: flex;
  flex-direction: column;
}

.card-fullscreen-body .md-editor-split {
  flex: 1;
}

.card-fullscreen-body .md-editor-mobile .md-editor-textarea {
  min-height: 200px;
}
```

**Step 2: Verify the dev server loads without CSS errors**

Run: `cd /home/bradley/pliny && npx vite build --mode development 2>&1 | tail -5`
Expected: Build succeeds

**Step 3: Commit**

```bash
git add client/src/index.css
git commit -m "style: add markdown editor CSS (toolbar, split-pane, mobile tabs)"
```

---

### Task 3: Integrate MarkdownEditor into KanbanCard

**Files:**
- Modify: `client/src/components/KanbanCard.tsx:807-811`

**Step 1: Add the import**

At the top of `KanbanCard.tsx`, add the import after the existing `MarkdownRenderer` import (line 8):

```tsx
import MarkdownEditor from './MarkdownEditor';
```

**Step 2: Replace the textarea with MarkdownEditor**

Replace lines 807-811 in `KanbanCard.tsx`:

```tsx
      <textarea value={editDescription} onChange={(e) => setEditDescription(e.target.value)} placeholder="Description (optional)" className="card-edit-description" rows={3} maxLength={10000}
        onKeyDown={(e) => {
          if (!isMobile && e.key === 'Escape') { e.preventDefault(); handleClose(); }
        }}
      />
```

With:

```tsx
      <MarkdownEditor
        value={editDescription}
        onChange={setEditDescription}
        placeholder="Description (optional)"
        maxLength={10000}
        isMobile={isMobile}
      />
```

**Step 3: Verify it compiles**

Run: `cd /home/bradley/pliny && npx tsc --noEmit --project client/tsconfig.json 2>&1 | head -20`
Expected: No errors

**Step 4: Commit**

```bash
git add client/src/components/KanbanCard.tsx
git commit -m "feat: integrate MarkdownEditor into card description editing"
```

---

### Task 4: Manual smoke test and polish

**Step 1: Start the dev server**

Run: `cd /home/bradley/pliny && npm run dev --prefix client`

**Step 2: Verify these behaviors**

1. Open a card for editing — description area shows toolbar + split-pane
2. Type `## Hello` in the textarea — preview pane shows rendered heading
3. Select text, click Bold — text wraps with `**`
4. Click each toolbar button with no selection — correct markdown inserted
5. Preview updates live as you type
6. Resize browser to mobile width — tabs appear (Write/Preview)
7. "Save description" button still works correctly
8. Escape key still closes the editor on desktop

**Step 3: Fix any issues found during smoke test**

**Step 4: Final commit if any polish was needed**

```bash
git add -A
git commit -m "fix: polish markdown editor after smoke test"
```
