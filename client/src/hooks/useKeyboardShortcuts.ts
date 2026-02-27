import { useEffect, useRef } from 'react';

export interface Shortcut {
  key: string;
  meta?: boolean;
  shift?: boolean;
  description: string;
  group: 'Global' | 'Board' | 'Card' | 'Navigation';
  action: () => void;
  disabled?: boolean;
}

function isInputFocused(): boolean {
  const el = document.activeElement;
  if (!el) return false;
  const tag = el.tagName.toLowerCase();
  if (tag === 'input' || tag === 'textarea' || tag === 'select') return true;
  if ((el as HTMLElement).isContentEditable) return true;
  return false;
}

function fireShortcut(e: KeyboardEvent, sc: Shortcut) {
  e.preventDefault();
  e.stopImmediatePropagation();
  sc.action();
}

export function useKeyboardShortcuts(shortcuts: Shortcut[]) {
  const shortcutsRef = useRef(shortcuts);
  shortcutsRef.current = shortcuts;

  const pendingKeyRef = useRef<string | null>(null);
  const pendingTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const s = shortcutsRef.current;

      // Check for sequential shortcuts first (G then X)
      if (pendingKeyRef.current === 'g') {
        const secondKey = e.key.toLowerCase();
        const match = s.find(
          sc => !sc.disabled &&
            sc.group === 'Navigation' &&
            sc.key.startsWith('g ') &&
            sc.key.split(' ')[1] === secondKey
        );
        pendingKeyRef.current = null;
        if (pendingTimerRef.current) {
          clearTimeout(pendingTimerRef.current);
          pendingTimerRef.current = null;
        }
        if (match) {
          fireShortcut(e, match);
          return;
        }
      }

      // Meta/Ctrl shortcuts always fire (even in inputs for Cmd+K, Cmd+Enter, etc.)
      for (const sc of s) {
        if (sc.disabled) continue;
        if (!sc.meta) continue;
        if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === sc.key.toLowerCase()) {
          if (sc.shift && !e.shiftKey) continue;
          if (!sc.shift && e.shiftKey) continue;
          fireShortcut(e, sc);
          return;
        }
      }

      // Non-meta shortcuts: bail if input is focused
      if (isInputFocused()) return;

      // Handle 'g' as start of sequential shortcut
      if (e.key.toLowerCase() === 'g' && !e.metaKey && !e.ctrlKey) {
        const hasSequential = s.some(sc => !sc.disabled && sc.key.startsWith('g '));
        if (hasSequential) {
          pendingKeyRef.current = 'g';
          if (pendingTimerRef.current) clearTimeout(pendingTimerRef.current);
          pendingTimerRef.current = setTimeout(() => {
            pendingKeyRef.current = null;
          }, 1000);
          return;
        }
      }

      // Simple key shortcuts
      for (const sc of s) {
        if (sc.disabled) continue;
        if (sc.meta) continue;
        if (sc.key.includes(' ')) continue;

        // ? key: check both e.key === '?' and shift+/
        if (sc.key === '?') {
          if (e.key === '?' || (e.key === '/' && e.shiftKey)) {
            fireShortcut(e, sc);
            return;
          }
          continue;
        }

        if (sc.key === 'Escape') {
          if (e.key === 'Escape') {
            fireShortcut(e, sc);
            return;
          }
          continue;
        }

        if (sc.key === 'Delete') {
          if (e.key === 'Delete' || e.key === 'Backspace') {
            fireShortcut(e, sc);
            return;
          }
          continue;
        }

        if (e.key.toLowerCase() === sc.key.toLowerCase() && !e.metaKey && !e.ctrlKey) {
          if (sc.shift && !e.shiftKey) continue;
          if (!sc.shift && e.shiftKey) continue;
          fireShortcut(e, sc);
          return;
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  return null;
}

export function getShortcutsByGroup(shortcuts: Shortcut[]): Record<string, Shortcut[]> {
  const groups: Record<string, Shortcut[]> = {};
  for (const sc of shortcuts) {
    if (!groups[sc.group]) groups[sc.group] = [];
    groups[sc.group].push(sc);
  }
  return groups;
}
