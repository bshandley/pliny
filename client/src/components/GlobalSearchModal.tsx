import { useState, useEffect, useRef, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { api } from '../api';
import { SearchResult } from '../types';

interface GlobalSearchModalProps {
  isOpen: boolean;
  onClose: () => void;
  onNavigate: (boardId: string, cardId: string) => void;
}

const RECENT_KEY = 'global-search-recent';
const MAX_RECENT = 5;

function getRecentSearches(): string[] {
  try {
    const stored = localStorage.getItem(RECENT_KEY);
    if (stored) {
      const parsed = JSON.parse(stored);
      if (Array.isArray(parsed)) return parsed.slice(0, MAX_RECENT);
    }
  } catch { /* ignore */ }
  return [];
}

function saveRecentSearch(query: string) {
  const recent = getRecentSearches().filter(q => q !== query);
  recent.unshift(query);
  localStorage.setItem(RECENT_KEY, JSON.stringify(recent.slice(0, MAX_RECENT)));
}

function TypeIcon({ type }: { type: SearchResult['type'] }) {
  if (type === 'comment') {
    return (
      <svg className="search-result-icon" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>
      </svg>
    );
  }
  if (type === 'checklist_item') {
    return (
      <svg className="search-result-icon" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <polyline points="9 11 12 14 22 4"/><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"/>
      </svg>
    );
  }
  // card
  return (
    <svg className="search-result-icon" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="3" width="18" height="18" rx="2"/><line x1="7" y1="8" x2="17" y2="8"/><line x1="7" y1="12" x2="13" y2="12"/>
    </svg>
  );
}

function highlightMatch(text: string, query: string): React.ReactNode {
  if (!query) return text;
  const escaped = query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const regex = new RegExp(`(${escaped})`, 'gi');
  const parts = text.split(regex);
  return parts.map((part, i) =>
    part.toLowerCase() === query.toLowerCase()
      ? <strong key={i} className="search-highlight">{part}</strong>
      : part
  );
}

export default function GlobalSearchModal({ isOpen, onClose, onNavigate }: GlobalSearchModalProps) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<SearchResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [recentSearches, setRecentSearches] = useState<string[]>(getRecentSearches);
  const inputRef = useRef<HTMLInputElement>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const resultsRef = useRef<HTMLUListElement>(null);

  // Reset state on open/close
  useEffect(() => {
    if (isOpen) {
      setQuery('');
      setResults([]);
      setLoading(false);
      setSelectedIndex(0);
      setRecentSearches(getRecentSearches());
      // Auto-focus after portal renders
      requestAnimationFrame(() => {
        inputRef.current?.focus();
      });
    }
  }, [isOpen]);

  // Debounced search
  const performSearch = useCallback(async (q: string) => {
    if (q.length < 2) {
      setResults([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      const response = await api.search(q);
      setResults(response.results);
      setSelectedIndex(0);
    } catch {
      setResults([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (debounceRef.current) {
      clearTimeout(debounceRef.current);
    }
    if (query.length < 2) {
      setResults([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    debounceRef.current = setTimeout(() => {
      performSearch(query);
    }, 300);
    return () => {
      if (debounceRef.current) {
        clearTimeout(debounceRef.current);
      }
    };
  }, [query, performSearch]);

  // Scroll selected item into view
  useEffect(() => {
    if (resultsRef.current) {
      const items = resultsRef.current.querySelectorAll('.search-result-item');
      if (items[selectedIndex]) {
        items[selectedIndex].scrollIntoView({ block: 'nearest' });
      }
    }
  }, [selectedIndex]);

  const handleSelect = useCallback((result: SearchResult) => {
    saveRecentSearch(query);
    onNavigate(result.board_id, result.card_id);
    onClose();
  }, [query, onNavigate, onClose]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      onClose();
      return;
    }
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setSelectedIndex(prev => Math.min(prev + 1, results.length - 1));
      return;
    }
    if (e.key === 'ArrowUp') {
      e.preventDefault();
      setSelectedIndex(prev => Math.max(prev - 1, 0));
      return;
    }
    if (e.key === 'Enter') {
      e.preventDefault();
      if (results[selectedIndex]) {
        handleSelect(results[selectedIndex]);
      }
      return;
    }
  };

  const handleRecentClick = (recent: string) => {
    setQuery(recent);
  };

  if (!isOpen) return null;

  const showRecent = query.length === 0 && recentSearches.length > 0;
  const showNoResults = query.length >= 2 && !loading && results.length === 0;

  return createPortal(
    <div className="search-modal-backdrop" onClick={onClose}>
      <div className="search-modal" onClick={e => e.stopPropagation()} onKeyDown={handleKeyDown}>
        <div className="search-modal-header">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>
          </svg>
          <input
            ref={inputRef}
            className="search-modal-input"
            type="text"
            placeholder="Search cards, comments, checklists..."
            value={query}
            onChange={e => setQuery(e.target.value)}
          />
          <span className="search-shortcut">ESC</span>
        </div>
        <div className="search-modal-body">
          {loading && (
            <div className="search-empty">
              <div className="spinner" style={{ width: 24, height: 24, margin: '0 auto' }}></div>
            </div>
          )}

          {showRecent && (
            <>
              <div className="search-recent-header">Recent searches</div>
              <ul className="search-modal-results">
                {recentSearches.map((recent, i) => (
                  <li
                    key={i}
                    className="search-result-item"
                    onClick={() => handleRecentClick(recent)}
                  >
                    <svg className="search-result-icon" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/>
                    </svg>
                    <div className="search-result-content">
                      <div className="search-result-title">{recent}</div>
                    </div>
                  </li>
                ))}
              </ul>
            </>
          )}

          {showNoResults && (
            <div className="search-empty">No results found</div>
          )}

          {!loading && results.length > 0 && (
            <ul className="search-modal-results" ref={resultsRef}>
              {results.map((result, i) => (
                <li
                  key={`${result.card_id}-${result.type}-${i}`}
                  className={`search-result-item${i === selectedIndex ? ' selected' : ''}`}
                  onClick={() => handleSelect(result)}
                  onMouseEnter={() => setSelectedIndex(i)}
                >
                  <TypeIcon type={result.type} />
                  <div className="search-result-content">
                    <div className="search-result-title">{result.card_title}</div>
                    <div className="search-result-snippet">
                      {highlightMatch(result.match_text, query)}
                    </div>
                  </div>
                  <div className="search-result-meta">
                    <div className="search-result-meta-board">{result.board_name}</div>
                    <div>{result.column_name}</div>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>,
    document.body
  );
}
