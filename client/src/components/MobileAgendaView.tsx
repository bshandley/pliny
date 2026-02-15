import { useEffect, useRef, useMemo, useState, forwardRef, useImperativeHandle } from 'react';
import { Board, Card } from '../types';
import { MobileCalendarCard } from './CalendarView';

interface MobileAgendaViewProps {
  board: Board;
  filterCard: (card: Card) => boolean;
  isAdmin: boolean;
  onOpenInBoard: (cardId: string) => void;
  onChangeDate: (cardId: string, date: string) => void;
  onRemoveDate: (cardId: string) => void;
  onActiveDateChange: (date: Date) => void;
  onSwipeLeft?: () => void;
  onSwipeRight?: () => void;
}

function formatDateKey(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function isToday(dateKey: string): boolean {
  return dateKey === formatDateKey(new Date());
}

function isTomorrow(dateKey: string): boolean {
  const t = new Date();
  t.setDate(t.getDate() + 1);
  return dateKey === formatDateKey(t);
}

function formatGroupHeader(dateKey: string): string {
  const [y, m, d] = dateKey.split('-').map(Number);
  const date = new Date(y, m - 1, d);
  const weekday = date.toLocaleDateString('en-US', { weekday: 'long' });
  const monthDay = date.toLocaleDateString('en-US', { month: 'long', day: 'numeric' });
  if (isToday(dateKey)) return `Today — ${weekday}, ${monthDay}`;
  if (isTomorrow(dateKey)) return `Tomorrow — ${weekday}, ${monthDay}`;
  return `${weekday}, ${monthDay}`;
}

interface DateGroup {
  dateKey: string;
  cards: { card: Card; columnName: string }[];
}

export interface MobileAgendaHandle {
  scrollToDate: (dateKey: string) => void;
}

const MobileAgendaView = forwardRef<MobileAgendaHandle, MobileAgendaViewProps>(
  function MobileAgendaView({ board, filterCard, isAdmin, onOpenInBoard, onChangeDate, onRemoveDate, onActiveDateChange, onSwipeLeft, onSwipeRight }, ref) {
    const scrollRef = useRef<HTMLDivElement>(null);
    const headerRefs = useRef<Map<string, HTMLElement>>(new Map());
    const [overdueCollapsed, setOverdueCollapsed] = useState(false);
    const [unscheduledCollapsed, setUnscheduledCollapsed] = useState(false);
    const hasScrolledRef = useRef(false);
    const dateInputRefs = useRef<Map<string, HTMLInputElement>>(new Map());

    // Swipe navigation
    const touchStart = useRef<{ x: number; y: number } | null>(null);

    const handleTouchStart = (e: React.TouchEvent) => {
      touchStart.current = { x: e.touches[0].clientX, y: e.touches[0].clientY };
    };

    const handleTouchEnd = (e: React.TouchEvent) => {
      if (!touchStart.current) return;
      const dx = e.changedTouches[0].clientX - touchStart.current.x;
      const dy = e.changedTouches[0].clientY - touchStart.current.y;
      touchStart.current = null;
      if (Math.abs(dx) < 50 || Math.abs(dy) > Math.abs(dx)) return;
      if (dx > 0) onSwipeRight?.();
      else onSwipeLeft?.();
    };

    // Prevent scroll from leaking to parent/body at scroll boundaries (Firefox fix)
    useEffect(() => {
      const el = scrollRef.current;
      if (!el) return;

      let startY = 0;
      let startX = 0;

      const onTouchStart = (e: TouchEvent) => {
        startY = e.touches[0].clientY;
        startX = e.touches[0].clientX;
      };

      const onTouchMove = (e: TouchEvent) => {
        const dy = e.touches[0].clientY - startY;
        const dx = e.touches[0].clientX - startX;

        // Let horizontal swipes through for month navigation
        if (Math.abs(dx) > Math.abs(dy)) return;

        const { scrollTop, scrollHeight, clientHeight } = el;

        // Content fits without scrolling — block vertical scroll
        if (scrollHeight <= clientHeight) {
          e.preventDefault();
          return;
        }

        // At the top, pulling down
        if (scrollTop <= 0 && dy > 0) {
          e.preventDefault();
          return;
        }

        // At the bottom, pushing up
        if (scrollTop + clientHeight >= scrollHeight - 1 && dy < 0) {
          e.preventDefault();
          return;
        }
      };

      el.addEventListener('touchstart', onTouchStart, { passive: true });
      el.addEventListener('touchmove', onTouchMove, { passive: false });

      return () => {
        el.removeEventListener('touchstart', onTouchStart);
        el.removeEventListener('touchmove', onTouchMove);
      };
    }, []);

    // Collect all cards into groups
    const { overdueGroups, upcomingGroups, unscheduledCards } = useMemo(() => {
      const todayKey = formatDateKey(new Date());
      const dateMap = new Map<string, { card: Card; columnName: string }[]>();
      const unscheduled: { card: Card; columnName: string }[] = [];

      board.columns?.forEach(col => {
        col.cards?.forEach(card => {
          if (card.archived || !filterCard(card)) return;
          if (!card.due_date) {
            unscheduled.push({ card, columnName: col.name });
            return;
          }
          const dateKey = card.due_date.split('T')[0];
          if (!dateMap.has(dateKey)) dateMap.set(dateKey, []);
          dateMap.get(dateKey)!.push({ card, columnName: col.name });
        });
      });

      const overdue: DateGroup[] = [];
      const upcoming: DateGroup[] = [];

      const sortedKeys = Array.from(dateMap.keys()).sort();
      for (const key of sortedKeys) {
        const group = { dateKey: key, cards: dateMap.get(key)! };
        if (key < todayKey) {
          overdue.push(group);
        } else {
          upcoming.push(group);
        }
      }

      return { overdueGroups: overdue, upcomingGroups: upcoming, unscheduledCards: unscheduled };
    }, [board, filterCard]);

    // Auto-scroll to today (or nearest future date) on first render
    useEffect(() => {
      if (hasScrolledRef.current) return;
      hasScrolledRef.current = true;

      const todayKey = formatDateKey(new Date());
      let targetKey = upcomingGroups.length > 0 ? upcomingGroups[0].dateKey : null;
      for (const g of upcomingGroups) {
        if (g.dateKey >= todayKey) { targetKey = g.dateKey; break; }
      }

      if (targetKey) {
        const el = headerRefs.current.get(targetKey);
        if (el) {
          requestAnimationFrame(() => {
            el.scrollIntoView({ block: 'start' });
          });
        }
      }
    }, [upcomingGroups]);

    // IntersectionObserver to sync active date with mini-cal
    useEffect(() => {
      const container = scrollRef.current;
      if (!container) return;

      const observer = new IntersectionObserver(
        (entries) => {
          let topEntry: IntersectionObserverEntry | null = null;
          for (const entry of entries) {
            if (entry.isIntersecting) {
              if (!topEntry || entry.boundingClientRect.top < topEntry.boundingClientRect.top) {
                topEntry = entry;
              }
            }
          }
          if (topEntry) {
            const dateKey = (topEntry.target as HTMLElement).dataset.dateKey;
            if (dateKey && dateKey !== 'overdue' && dateKey !== 'unscheduled') {
              const [y, m, d] = dateKey.split('-').map(Number);
              onActiveDateChange(new Date(y, m - 1, d));
            }
          }
        },
        { root: container, rootMargin: '0px 0px -80% 0px', threshold: 0 }
      );

      headerRefs.current.forEach((el) => observer.observe(el));
      return () => observer.disconnect();
    }, [overdueGroups, upcomingGroups, onActiveDateChange]);

    // Expose scrollToDate to parent via ref
    useImperativeHandle(ref, () => ({
      scrollToDate(dateKey: string) {
        const el = headerRefs.current.get(dateKey);
        if (el) {
          el.scrollIntoView({ behavior: 'smooth', block: 'start' });
          return;
        }
        const allKeys = upcomingGroups.map(g => g.dateKey);
        const nearest = allKeys.find(k => k >= dateKey);
        if (nearest) {
          headerRefs.current.get(nearest)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
        }
      }
    }), [upcomingGroups]);

    const setHeaderRef = (key: string, el: HTMLElement | null) => {
      if (el) headerRefs.current.set(key, el);
      else headerRefs.current.delete(key);
    };

    const setDateInputRef = (cardId: string, el: HTMLInputElement | null) => {
      if (el) dateInputRefs.current.set(cardId, el);
      else dateInputRefs.current.delete(cardId);
    };

    const renderGroup = (group: DateGroup) => (
      <div key={group.dateKey} className="agenda-group">
        <div
          className={`agenda-date-header${isToday(group.dateKey) ? ' agenda-today' : ''}`}
          ref={(el) => setHeaderRef(group.dateKey, el)}
          data-date-key={group.dateKey}
        >
          {formatGroupHeader(group.dateKey)}
          <span className="agenda-date-count">{group.cards.length}</span>
        </div>
        <div className="agenda-group-cards">
          {group.cards.map(({ card, columnName }) => (
            <MobileCalendarCard
              key={card.id}
              card={card}
              columnName={columnName}
              onOpenInBoard={onOpenInBoard}
              onChangeDate={onChangeDate}
              onRemoveDate={onRemoveDate}
              isAdmin={isAdmin}
            />
          ))}
        </div>
      </div>
    );

    return (
      <div className="mobile-agenda" ref={scrollRef} onTouchStart={handleTouchStart} onTouchEnd={handleTouchEnd}>
        {overdueGroups.length > 0 && (
          <div className="agenda-overdue-section">
            <button
              className="agenda-overdue-header"
              onClick={() => setOverdueCollapsed(!overdueCollapsed)}
              ref={(el) => setHeaderRef('overdue', el)}
              data-date-key="overdue"
            >
              <span className="agenda-overdue-label">Overdue</span>
              <span className="agenda-overdue-count">{overdueGroups.reduce((n, g) => n + g.cards.length, 0)}</span>
              <span className={`agenda-collapse-arrow${overdueCollapsed ? ' rotated' : ''}`}>&#x2039;</span>
            </button>
            {!overdueCollapsed && overdueGroups.map(renderGroup)}
          </div>
        )}

        {upcomingGroups.map(renderGroup)}

        {(upcomingGroups.length === 0 && overdueGroups.length === 0) && (
          <div className="agenda-empty">No scheduled cards</div>
        )}

        <div className="agenda-unscheduled-section">
          <button
            className="agenda-unscheduled-header"
            onClick={() => setUnscheduledCollapsed(!unscheduledCollapsed)}
            ref={(el) => setHeaderRef('unscheduled', el)}
            data-date-key="unscheduled"
          >
            <span className="agenda-unscheduled-label">Unscheduled</span>
            <span className="agenda-unscheduled-count">{unscheduledCards.length}</span>
            <span className={`agenda-collapse-arrow${unscheduledCollapsed ? ' rotated' : ''}`}>&#x2039;</span>
          </button>
          {!unscheduledCollapsed && (
            <div className="agenda-group-cards">
              {unscheduledCards.length === 0 ? (
                <div className="agenda-empty-inline">No unscheduled cards</div>
              ) : (
                unscheduledCards.map(({ card, columnName }) => (
                  <div key={card.id} className="mobile-cal-card" onClick={() => onOpenInBoard(card.id)}>
                    <div className="mobile-cal-card-info">
                      <span className="mobile-cal-card-title">{card.title}</span>
                      <span className="mobile-cal-card-col">{columnName}</span>
                    </div>
                    {isAdmin && (
                      <div className="mobile-cal-card-actions" onClick={e => e.stopPropagation()}>
                        <button
                          className="mobile-cal-card-btn"
                          onClick={() => dateInputRefs.current.get(card.id)?.showPicker()}
                          title="Set date"
                        >
                          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                            <rect x="3" y="4" width="18" height="18" rx="2" ry="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/>
                          </svg>
                        </button>
                        <input
                          ref={(el) => setDateInputRef(card.id, el)}
                          type="date"
                          className="chip-date-input"
                          value=""
                          onChange={e => { if (e.target.value) onChangeDate(card.id, e.target.value); }}
                          onClick={e => e.stopPropagation()}
                        />
                      </div>
                    )}
                  </div>
                ))
              )}
            </div>
          )}
        </div>
      </div>
    );
  }
);

export default MobileAgendaView;
export { formatDateKey };
