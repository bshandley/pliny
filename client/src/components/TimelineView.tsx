import { useState, useMemo, useRef, useEffect, useCallback } from 'react';
import { Board, Card, Column } from '../types';
import TimelineBar from './TimelineBar';
import { api } from '../api';

interface TimelineViewProps {
  board: Board;
  filterCard: (card: Card) => boolean;
  isAdmin: boolean;
  isMobile: boolean;
  onCardUpdate: () => void;
  onCardClick: (cardId: string) => void;
}

type ZoomLevel = 'day' | 'week' | 'month';
type GroupBy = 'column' | 'assignee' | 'label' | 'none';

interface GroupData {
  label: string;
  cards: { card: Card; column: Column }[];
}

const ZOOM_CONFIG = {
  day: { columnWidth: 40, unitDays: 1 },
  week: { columnWidth: 120, unitDays: 7 },
  month: { columnWidth: 160, unitDays: 30 },
};

function addDays(date: Date, days: number): Date {
  const d = new Date(date);
  d.setDate(d.getDate() + days);
  return d;
}

function formatShortDate(dateStr: string): string {
  const d = new Date(dateStr.split('T')[0] + 'T12:00:00');
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

// Color palette for status-based bar coloring (matches Atelier warm aesthetic)
const BAR_COLORS = [
  '#5746af', // primary purple
  '#2f855a', // sage green
  '#c05621', // terracotta
  '#2b6cb0', // steel blue
  '#b7791f', // golden brown
  '#805ad5', // violet
  '#319795', // teal
  '#c53030', // muted red
];

export default function TimelineView({ board, filterCard, isAdmin, isMobile, onCardUpdate, onCardClick }: TimelineViewProps) {
  const [zoom, setZoom] = useState<ZoomLevel>('week');
  const [groupBy, setGroupBy] = useState<GroupBy>('column');
  const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(new Set());
  const [scrollOffset, setScrollOffset] = useState(0);
  const [draggingUnscheduled, setDraggingUnscheduled] = useState<{ card: Card; column: Column } | null>(null);
  const [draggingScheduledCard, setDraggingScheduledCard] = useState<Card | null>(null);
  const draggingScheduledCardRef = useRef<Card | null>(null);
  const [dropIndicatorPx, setDropIndicatorPx] = useState<number | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<HTMLDivElement>(null);
  const unscheduledRef = useRef<HTMLDivElement>(null);

  // Compute date range from all card dates
  const dateRange = useMemo(() => {
    const today = new Date();
    let minDate = new Date(today);
    let maxDate = new Date(today);
    minDate.setDate(minDate.getDate() - 14);
    maxDate.setDate(maxDate.getDate() + 60);

    board.columns?.forEach(col => {
      col.cards?.filter(c => !c.archived && filterCard(c)).forEach(card => {
        if (card.start_date) {
          const d = new Date(card.start_date);
          if (d < minDate) minDate = new Date(d);
        }
        if (card.due_date) {
          const d = new Date(card.due_date);
          if (d > maxDate) maxDate = new Date(d);
        }
      });
    });

    // Pad by 2 weeks on each side
    minDate.setDate(minDate.getDate() - 14);
    maxDate.setDate(maxDate.getDate() + 14);
    return { start: minDate, end: maxDate };
  }, [board, filterCard]);

  const dateToPx = useCallback((date: Date): number => {
    const diffMs = date.getTime() - dateRange.start.getTime();
    const diffDays = diffMs / (1000 * 60 * 60 * 24);
    return diffDays * ZOOM_CONFIG[zoom].columnWidth / ZOOM_CONFIG[zoom].unitDays;
  }, [dateRange.start, zoom]);

  const pxToDate = useCallback((px: number): Date => {
    const days = px * ZOOM_CONFIG[zoom].unitDays / ZOOM_CONFIG[zoom].columnWidth;
    return addDays(dateRange.start, Math.round(days));
  }, [dateRange.start, zoom]);

  const formatDateISO = (date: Date): string => date.toISOString().split('T')[0];

  // Convert a clientX screen position to chart pixel offset (accounts for scroll)
  const clientXToChartPx = useCallback((clientX: number): number | null => {
    if (!chartRef.current) return null;
    const rect = chartRef.current.getBoundingClientRect();
    return clientX - rect.left;
  }, []);

  const handleChipDragStart = (e: React.DragEvent, item: { card: Card; column: Column }) => {
    if (!isAdmin) { e.preventDefault(); return; }
    setDraggingUnscheduled(item);
    // Minimal ghost label
    const ghost = document.createElement('div');
    ghost.textContent = item.card.title;
    ghost.style.cssText = 'position:fixed;top:-100px;padding:4px 8px;background:var(--bg-elevated,#2a2420);color:var(--text-primary,#f0ebe5);border-radius:4px;font-size:12px;pointer-events:none;';
    document.body.appendChild(ghost);
    e.dataTransfer.setDragImage(ghost, 0, 0);
    setTimeout(() => document.body.removeChild(ghost), 0);
    e.dataTransfer.effectAllowed = 'move';
  };

  const handleChipDragEnd = () => {
    setDraggingUnscheduled(null);
    setDropIndicatorPx(null);
  };

  // Callbacks for scheduled bar drags (mouse-based, not HTML5 drag API)
  // Use a ref alongside state so handleBarDragEnd always sees the current card
  // even when captured in a stale closure inside TimelineBar's mouseup handler.
  const handleBarDragStart = (card: Card) => {
    draggingScheduledCardRef.current = card;
    setDraggingScheduledCard(card);
  };

  // #20: update drop indicator while dragging a scheduled bar
  const handleBarDragMove = useCallback((clientX: number) => {
    const px = clientXToChartPx(clientX);
    if (px !== null) setDropIndicatorPx(px);
  }, [clientXToChartPx]);

  const handleBarDragEnd = async (clientX: number, clientY: number) => {
    // Read from ref — safe against stale closure
    const card = draggingScheduledCardRef.current;
    draggingScheduledCardRef.current = null;
    setDraggingScheduledCard(null);
    setDropIndicatorPx(null); // #20: clear indicator on drop

    if (!card || !unscheduledRef.current) return;

    // Check if the drop landed over the unscheduled zone
    const rect = unscheduledRef.current.getBoundingClientRect();
    const isOverUnscheduled =
      clientX >= rect.left &&
      clientX <= rect.right &&
      clientY >= rect.top &&
      clientY <= rect.bottom;

    if (isOverUnscheduled) {
      try {
        await api.updateCard(card.id, { start_date: null, due_date: null } as any);
        onCardUpdate();
      } catch {
        // revert handled by board reload
      }
    }
  };

  const handleChartDragOver = (e: React.DragEvent) => {
    if (!draggingUnscheduled) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    const px = clientXToChartPx(e.clientX);
    if (px !== null) setDropIndicatorPx(px);
  };

  const handleChartDragLeave = (e: React.DragEvent) => {
    // Only clear if leaving the chart entirely (not entering a child)
    if (chartRef.current && !chartRef.current.contains(e.relatedTarget as Node)) {
      setDropIndicatorPx(null);
    }
  };

  const handleChartDrop = async (e: React.DragEvent) => {
    e.preventDefault();
    if (!draggingUnscheduled) return;
    const px = clientXToChartPx(e.clientX);
    if (px === null) return;
    const date = pxToDate(px);
    const dateStr = formatDateISO(date);
    const { card } = draggingUnscheduled;
    setDraggingUnscheduled(null);
    setDropIndicatorPx(null);
    try {
      await api.updateCard(card.id, { due_date: dateStr } as any);
      onCardUpdate();
    } catch {
      // revert handled by board reload
    }
  };

  // Auto-scroll to today on mount and zoom change
  useEffect(() => {
    if (scrollRef.current) {
      const todayPx = dateToPx(new Date());
      scrollRef.current.scrollLeft = todayPx - scrollRef.current.clientWidth / 3;
    }
  }, [zoom, dateToPx]);

  // Flattened card list
  const allCards = useMemo(() => {
    const result: { card: Card; column: Column }[] = [];
    board.columns?.forEach(col => {
      col.cards?.filter(c => !c.archived && filterCard(c)).forEach(card => {
        result.push({ card, column: col });
      });
    });
    return result;
  }, [board, filterCard]);

  // Cards that have at least one date (appear on timeline)
  const scheduledCards = useMemo(() => {
    return allCards.filter(({ card }) => card.start_date || card.due_date);
  }, [allCards]);

  // Cards without any dates (unscheduled)
  const unscheduledCards = useMemo(() => {
    return allCards.filter(({ card }) => !card.start_date && !card.due_date);
  }, [allCards]);

  // Column index map for color coding
  const columnColorMap = useMemo(() => {
    const map = new Map<string, string>();
    board.columns?.forEach((col, i) => {
      map.set(col.name, BAR_COLORS[i % BAR_COLORS.length]);
    });
    return map;
  }, [board.columns]);

  // Grouping
  const groups: GroupData[] = useMemo(() => {
    if (groupBy === 'none') return [{ label: 'All cards', cards: scheduledCards }];

    const map = new Map<string, { card: Card; column: Column }[]>();
    const orderKeys: string[] = [];

    if (groupBy === 'column') {
      board.columns?.forEach(col => {
        map.set(col.name, []);
        orderKeys.push(col.name);
      });
    }

    scheduledCards.forEach(item => {
      let keys: string[];
      switch (groupBy) {
        case 'column': keys = [item.column.name]; break;
        case 'assignee': keys = item.card.assignees?.length ? item.card.assignees.map(a => a.username || a.display_name || 'Unassigned') : ['Unassigned']; break;
        case 'label': keys = item.card.labels?.length ? item.card.labels.map(l => l.name) : ['No label']; break;
        default: keys = ['Other'];
      }
      keys.forEach(k => {
        if (!map.has(k)) { map.set(k, []); orderKeys.push(k); }
        map.get(k)!.push(item);
      });
    });

    return (groupBy === 'column' ? orderKeys : Array.from(map.keys()))
      .filter(k => map.get(k)!.length > 0)
      .map(label => ({ label, cards: map.get(label)! }));
  }, [scheduledCards, groupBy, board.columns]);

  const toggleGroup = (label: string) => {
    setCollapsedGroups(prev => {
      const next = new Set(prev);
      if (next.has(label)) next.delete(label); else next.add(label);
      return next;
    });
  };

  // Axis column headers
  const axisColumns = useMemo(() => {
    const cols: { label: string; subLabel?: string; date: Date; width: number; isToday: boolean; isWeekend: boolean; index: number }[] = [];
    const d = new Date(dateRange.start);
    const today = new Date();
    const todayStr = today.toISOString().split('T')[0];
    let idx = 0;

    while (d <= dateRange.end) {
      const dStr = d.toISOString().split('T')[0];
      const isToday = dStr === todayStr;
      const dayOfWeek = d.getDay();
      const isWeekend = dayOfWeek === 0 || dayOfWeek === 6;

      let label: string;
      let subLabel: string | undefined;
      if (zoom === 'day') {
        label = d.getDate().toString();
        subLabel = d.getDay() === 0 || d.getDate() === 1
          ? d.toLocaleDateString('en-US', { month: 'short' })
          : undefined;
      } else if (zoom === 'week') {
        label = d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
      } else {
        label = d.toLocaleDateString('en-US', { month: 'short', year: 'numeric' });
      }

      cols.push({ label, subLabel, date: new Date(d), width: ZOOM_CONFIG[zoom].columnWidth, isToday, isWeekend, index: idx++ });

      if (zoom === 'day') d.setDate(d.getDate() + 1);
      else if (zoom === 'week') d.setDate(d.getDate() + 7);
      else d.setMonth(d.getMonth() + 1);
    }
    return cols;
  }, [dateRange, zoom]);

  const totalWidth = axisColumns.reduce((sum, col) => sum + col.width, 0);

  // Navigation
  const handlePrev = () => {
    if (scrollRef.current) {
      scrollRef.current.scrollLeft -= scrollRef.current.clientWidth * 0.5;
    }
  };
  const handleNext = () => {
    if (scrollRef.current) {
      scrollRef.current.scrollLeft += scrollRef.current.clientWidth * 0.5;
    }
  };
  const handleToday = () => {
    if (scrollRef.current) {
      const todayPx = dateToPx(new Date());
      scrollRef.current.scrollLeft = todayPx - scrollRef.current.clientWidth / 3;
    }
  };

  // Track scroll for nav title
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const handler = () => setScrollOffset(el.scrollLeft);
    el.addEventListener('scroll', handler, { passive: true });
    return () => el.removeEventListener('scroll', handler);
  }, []);

  const navTitle = useMemo(() => {
    const centerDate = pxToDate(scrollOffset + (scrollRef.current?.clientWidth || 600) / 3);
    return centerDate.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
  }, [scrollOffset, pxToDate]);

  // Compute swimlane label heights to align left panel with chart rows
  const swimlaneHeights = useMemo(() => {
    return groups.map(group => {
      if (collapsedGroups.has(group.label)) return 0;
      // Each bar is 32px tall with 4px gaps; minimum row height is 40px
      return Math.max(40, group.cards.length * 32 + 8);
    });
  }, [groups, collapsedGroups]);

  // Mobile: simplified date range list
  if (isMobile) {
    return (
      <div className="timeline-mobile-list">
        <div className="timeline-nav">
          <div className="timeline-group-selector">
            <select value={groupBy} onChange={e => setGroupBy(e.target.value as GroupBy)}>
              <option value="column">Status</option>
              <option value="assignee">Assignee</option>
              <option value="label">Label</option>
              <option value="none">None</option>
            </select>
          </div>
        </div>
        {groups.map(group => (
          <div key={group.label} className="timeline-mobile-group">
            <h3 className="timeline-mobile-group-header">{group.label} <span className="swimlane-count">{group.cards.length}</span></h3>
            {group.cards.map(({ card, column }) => (
              <div key={card.id} className="timeline-mobile-card" onClick={() => onCardClick(card.id)}>
                <span className="timeline-mobile-title">{card.title}</span>
                <span className="timeline-mobile-dates">
                  {card.start_date && card.due_date
                    ? `${formatShortDate(card.start_date)} – ${formatShortDate(card.due_date)}`
                    : card.due_date
                    ? formatShortDate(card.due_date)
                    : card.start_date
                    ? `${formatShortDate(card.start_date)} –`
                    : 'No dates'}
                </span>
                <span className="table-status-badge">{column.name}</span>
              </div>
            ))}
          </div>
        ))}
      </div>
    );
  }

  return (
    <div className="timeline-container">
      <div className="timeline-nav">
        <button className="btn-icon" onClick={handlePrev} title="Scroll left">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M15 18l-6-6 6-6"/></svg>
        </button>
        <button className="btn-secondary btn-sm" onClick={handleToday}>Today</button>
        <button className="btn-icon" onClick={handleNext} title="Scroll right">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M9 18l6-6-6-6"/></svg>
        </button>
        <h2 className="timeline-nav-title">{navTitle}</h2>
        <div className="timeline-zoom-toggle">
          {(['day', 'week', 'month'] as ZoomLevel[]).map(z => (
            <button key={z} className={`btn-sm${zoom === z ? ' btn-primary' : ' btn-secondary'}`}
              onClick={() => setZoom(z)}>{z.charAt(0).toUpperCase() + z.slice(1)}</button>
          ))}
        </div>
        <div className="timeline-group-selector">
          <select value={groupBy} onChange={e => setGroupBy(e.target.value as GroupBy)}>
            <option value="column">Status</option>
            <option value="assignee">Assignee</option>
            <option value="label">Label</option>
            <option value="none">None</option>
          </select>
        </div>
      </div>

      {/* Unscheduled tasks section — always rendered so unscheduledRef is available
          for drop-to-unschedule (#21). Hidden via CSS when nothing to show. */}
      <div
        className={`timeline-unscheduled${draggingScheduledCard ? ' timeline-unscheduled--drop-target' : ''}${unscheduledCards.length === 0 && !draggingScheduledCard ? ' timeline-unscheduled--hidden' : ''}`}
        ref={unscheduledRef}
      >
        <div className="timeline-unscheduled-header">
          <span className="timeline-unscheduled-label">Unscheduled</span>
          {unscheduledCards.length > 0 && <span className="swimlane-count">{unscheduledCards.length}</span>}
          {draggingScheduledCard && (
            <span className="timeline-unscheduled-drop-hint">Drop here to unschedule</span>
          )}
        </div>
        <div className="timeline-unscheduled-cards">
          {unscheduledCards.map(({ card, column }) => (
            <button
              key={card.id}
              className={`timeline-unscheduled-chip${draggingUnscheduled?.card.id === card.id ? ' timeline-unscheduled-chip--dragging' : ''}`}
              onClick={() => onCardClick(card.id)}
              draggable={isAdmin}
              onDragStart={e => handleChipDragStart(e, { card, column })}
              onDragEnd={handleChipDragEnd}
              style={{ '--chip-color': columnColorMap.get(column.name) || BAR_COLORS[0] } as React.CSSProperties}
              title={isAdmin ? `${card.title} — drag onto timeline to schedule` : card.title}
            >
              <span className="timeline-unscheduled-dot" />
              <span className="timeline-unscheduled-chip-title">{card.title}</span>
              <span className="timeline-unscheduled-chip-status">{column.name}</span>
            </button>
          ))}
        </div>
      </div>

      <div className="timeline-body" ref={scrollRef}>
        <div className="timeline-swimlane-labels">
          <div className="swimlane-label swimlane-axis-spacer" />
          {groups.map((g, i) => (
            <div key={g.label}>
              <div className="swimlane-label" onClick={() => toggleGroup(g.label)}>
                <span className="swimlane-arrow">{collapsedGroups.has(g.label) ? '▸' : '▾'}</span>
                {g.label} <span className="swimlane-count">{g.cards.length}</span>
              </div>
              {!collapsedGroups.has(g.label) && (
                <div style={{ height: swimlaneHeights[i] }} />
              )}
            </div>
          ))}
        </div>

        <div
          className={`timeline-chart${draggingUnscheduled ? ' timeline-chart--drop-active' : ''}`}
          style={{ width: totalWidth }}
          ref={chartRef}
          onDragOver={handleChartDragOver}
          onDragLeave={handleChartDragLeave}
          onDrop={handleChartDrop}
        >
          {/* Axis header */}
          <div className="timeline-axis">
            {axisColumns.map((col, i) => (
              <div key={i} className={`timeline-axis-cell${col.isToday ? ' timeline-axis-today' : ''}${col.isWeekend && zoom === 'day' ? ' timeline-axis-weekend' : ''}${col.index % 2 === 0 ? ' timeline-axis-even' : ''}`} style={{ width: col.width }}>
                {col.subLabel && <div className="timeline-axis-sub">{col.subLabel}</div>}
                {col.label}
              </div>
            ))}
          </div>

          {/* Grid columns (alternating backgrounds + weekend shading) */}
          <div className="timeline-grid" style={{ width: totalWidth }}>
            {axisColumns.map((col, i) => {
              const left = axisColumns.slice(0, i).reduce((s, c) => s + c.width, 0);
              return (
                <div
                  key={i}
                  className={`timeline-grid-col${col.isWeekend && zoom === 'day' ? ' timeline-grid-weekend' : ''}${col.index % 2 === 0 ? ' timeline-grid-even' : ''}`}
                  style={{ left, width: col.width, height: '100%' }}
                />
              );
            })}
            <div className="timeline-today-line" style={{ left: dateToPx(new Date()) }} />
            {dropIndicatorPx !== null && (
              <div className="timeline-drop-indicator" style={{ left: dropIndicatorPx }}>
                <div className="timeline-drop-indicator-label">
                  {formatDateISO(pxToDate(dropIndicatorPx))}
                </div>
              </div>
            )}
          </div>

          {/* Swimlane rows with bars */}
          {groups.map((group, gi) => (
            <div key={group.label}>
              <div className="timeline-swimlane-header" onClick={() => toggleGroup(group.label)} />
              {!collapsedGroups.has(group.label) && (
                <div className="timeline-swimlane-row" style={{ height: swimlaneHeights[gi] }}>
                  {group.cards.map(({ card, column }, rowIndex) => (
                    <TimelineBar
                      key={card.id}
                      card={card}
                      columnName={column.name}
                      barColor={columnColorMap.get(column.name) || BAR_COLORS[0]}
                      dateToPx={dateToPx}
                      pxToDate={pxToDate}
                      zoom={zoom}
                      rowIndex={rowIndex}
                      isAdmin={isAdmin}
                      onUpdate={onCardUpdate}
                      onClick={() => onCardClick(card.id)}
                      onBarDragStart={() => handleBarDragStart(card)}
                      onBarDragEnd={handleBarDragEnd}
                      onBarDragMove={handleBarDragMove}
                    />
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
