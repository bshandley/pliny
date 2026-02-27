import { useState, useRef, useCallback } from 'react';
import MarkdownRenderer from './MarkdownRenderer';

interface MarkdownEditorProps {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  maxLength?: number;
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
        cursor = start + 2;
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
      const lineStart = before.lastIndexOf('\n') + 1;
      const linePrefix = value.slice(lineStart, start);
      const beforeLine = value.slice(0, lineStart);
      const restOfLine = value.slice(start);
      return {
        newValue: beforeLine + `## ${linePrefix}` + restOfLine,
        cursorPos: start + 3,
      };
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
      cursor = start + 5;
      break;

    case 'bulletList':
      if (selected) {
        const lines = selected.split('\n');
        insert = lines.map(l => `- ${l}`).join('\n');
        cursor = start + insert.length;
      } else {
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
        cursor = start + selected.length + 3;
      } else {
        insert = '[text](url)';
        cursor = start + 1;
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

const TOOLBAR_BUTTONS: { action: FormatAction; label: string; title: string }[] = [
  { action: 'bold', label: 'B', title: 'Bold' },
  { action: 'italic', label: 'I', title: 'Italic' },
  { action: 'heading', label: 'H', title: 'Heading' },
  { action: 'inlineCode', label: '<>', title: 'Inline code' },
  { action: 'codeBlock', label: '{}', title: 'Code block' },
  { action: 'bulletList', label: '\u2022', title: 'Bullet list' },
  { action: 'link', label: '\uD83D\uDD17', title: 'Link' },
];

export default function MarkdownEditor({
  value,
  onChange,
  placeholder,
  maxLength,
}: MarkdownEditorProps) {
  const [activeTab, setActiveTab] = useState<'write' | 'preview'>('write');
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const handleToolbarClick = useCallback(
    (action: FormatAction) => {
      const textarea = textareaRef.current;
      if (!textarea) return;

      const { newValue, cursorPos } = applyFormat(textarea, value, action);
      onChange(newValue);

      requestAnimationFrame(() => {
        textarea.focus();
        textarea.setSelectionRange(cursorPos, cursorPos);
      });
    },
    [value, onChange]
  );

  return (
    <div className="md-editor">
      <div className="md-editor-header">
        <div className="md-editor-tabs">
          <button
            type="button"
            className={`btn-secondary btn-sm md-tab-btn ${activeTab === 'write' ? 'active' : ''}`}
            onClick={() => setActiveTab('write')}
          >
            Write
          </button>
          <button
            type="button"
            className={`btn-secondary btn-sm md-tab-btn ${activeTab === 'preview' ? 'active' : ''}`}
            onClick={() => setActiveTab('preview')}
          >
            Preview
          </button>
        </div>
        {activeTab === 'write' && (
          <div className="md-editor-toolbar">
            {TOOLBAR_BUTTONS.map((btn) => (
              <button
                key={btn.action}
                type="button"
                className="md-toolbar-btn"
                title={btn.title}
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => handleToolbarClick(btn.action)}
              >
                {btn.label}
              </button>
            ))}
          </div>
        )}
      </div>
      {activeTab === 'write' ? (
        <textarea
          ref={textareaRef}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
          maxLength={maxLength}
          className="card-edit-description md-editor-textarea"
          rows={6}
        />
      ) : (
        <div className="md-editor-preview">
          {value ? (
            <MarkdownRenderer content={value} />
          ) : (
            <span className="md-editor-preview-empty">Nothing to preview</span>
          )}
        </div>
      )}
    </div>
  );
}
