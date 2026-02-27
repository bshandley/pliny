import { createPortal } from 'react-dom';
import { Shortcut, getShortcutsByGroup } from '../hooks/useKeyboardShortcuts';

interface KeyboardShortcutsModalProps {
  isOpen: boolean;
  onClose: () => void;
  shortcuts: Shortcut[];
}

function formatKey(key: string): string[] {
  // Sequential shortcuts like "g b" → ["G", "B"]
  if (key.includes(' ')) {
    return key.split(' ').map(k => k.toUpperCase());
  }
  return [key === '?' ? '?' : key.length === 1 ? key.toUpperCase() : key];
}

export default function KeyboardShortcutsModal({ isOpen, onClose, shortcuts }: KeyboardShortcutsModalProps) {
  if (!isOpen) return null;

  const groups = getShortcutsByGroup(shortcuts);
  const groupOrder = ['Global', 'Board', 'Card', 'Navigation'];
  const orderedGroups = groupOrder.filter(g => groups[g]?.length);

  return createPortal(
    <div className="shortcuts-modal-backdrop" onClick={onClose}>
      <div
        className="shortcuts-modal"
        role="dialog"
        aria-modal="true"
        aria-label="Keyboard Shortcuts"
        onClick={e => e.stopPropagation()}
      >
        <div className="shortcuts-modal-header">
          <h2>Keyboard Shortcuts</h2>
          <button onClick={onClose} className="shortcuts-modal-close" aria-label="Close">
            <kbd>Esc</kbd>
          </button>
        </div>
        <div className="shortcuts-modal-body">
          {orderedGroups.map(group => (
            <div key={group} className="shortcuts-group">
              <h3 className="shortcuts-group-title">{group}</h3>
              <ul className="shortcuts-list">
                {groups[group].map(sc => (
                  <li key={sc.key + sc.description} className="shortcuts-item">
                    <div className="shortcuts-keys">
                      {sc.meta && <kbd>{navigator.platform.includes('Mac') ? '⌘' : 'Ctrl'}</kbd>}
                      {sc.shift && <kbd>Shift</kbd>}
                      {formatKey(sc.key).map((k, i) => (
                        <span key={i}>
                          {sc.key.includes(' ') && i > 0 && <span className="shortcuts-then">then</span>}
                          <kbd>{k}</kbd>
                        </span>
                      ))}
                    </div>
                    <span className="shortcuts-desc">{sc.description}</span>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      </div>
    </div>,
    document.body
  );
}
