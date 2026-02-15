import { useState, useEffect, useRef, useMemo } from 'react';
import { Droppable, Draggable } from '@hello-pangea/dnd';
import { Board, Card } from '../types';
import MiniCalStrip from './MiniCalStrip';
import MobileAgendaView, { formatDateKey as agendaFormatDateKey, MobileAgendaHandle } from './MobileAgendaView';

interface CalendarViewProps {
  board: Board;
  onCardClick: (card: Card, columnName: string, event: React.MouseEvent) => void;
  filterCard: (card: Card) => boolean;
  isAdmin: boolean;
  isMobile: boolean;
  onOpenInBoard: (cardId: string) => void;
  onChangeDate: (cardId: string, date: string) => void;
  onRemoveDate: (cardId: string) => void;
}

function formatDateKey(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function isToday(date: Date): boolean {
  const now = new Date();
  return date.getFullYear() === now.getFullYear() && date.getMonth() === now.getMonth() && date.getDate() === now.getDate();
}

function getMonthDays(year: number, month: number): Date[] {
  const firstDay = new Date(year, month, 1);
  const startOffset = firstDay.getDay(); // 0=Sun
  const days: Date[] = [];
  // Add days from previous month to fill first week
  for (let i = startOffset - 1; i >= 0; i--) {
    days.push(new Date(year, month, -i));
  }
  // Add all days of current month
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  for (let i = 1; i <= daysInMonth; i++) {
    days.push(new Date(year, month, i));
  }
  // Pad to complete last week
  while (days.length % 7 !== 0) {
    const last = days[days.length - 1];
    days.push(new Date(last.getFullYear(), last.getMonth(), last.getDate() + 1));
  }
  return days;
}

function getWeekDays(date: Date): Date[] {
  const day = date.getDay();
  const start = new Date(date);
  start.setDate(start.getDate() - day);
  const days: Date[] = [];
  for (let i = 0; i < 7; i++) {
    const d = new Date(start);
    d.setDate(d.getDate() + i);
    days.push(d);
  }
  return days;
}

function CalendarCardChip({ card, columnName, onClick, isMobile, isAdmin, onOpenInBoard, onChangeDate, onRemoveDate }: {
  card: Card;
  columnName: string;
  onClick: (e: React.MouseEvent) => void;
  isMobile: boolean;
  isAdmin: boolean;
  onOpenInBoard: (cardId: string) => void;
  onChangeDate: (cardId: string, date: string) => void;
  onRemoveDate: (cardId: string) => void;
}) {
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const dateInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!menuOpen) return;
    const handleClick = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setMenuOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [menuOpen]);

  const handleChipClick = (e: React.MouseEvent) => {
    if (isMobile) {
      e.stopPropagation();
      setMenuOpen(!menuOpen);
    } else {
      onClick(e);
    }
  };

  return (
    <div className="calendar-card-chip" onClick={handleChipClick} ref={isMobile ? menuRef : undefined}>
      <span className="chip-column-dot" style={{ background: 'var(--primary)' }} />
      <span className="chip-title">{card.title}</span>
      {isMobile && (
        <>
          <button
            className="chip-kebab"
            onClick={(e) => { e.stopPropagation(); setMenuOpen(!menuOpen); }}
          >
            <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor">
              <circle cx="12" cy="5" r="2"/><circle cx="12" cy="12" r="2"/><circle cx="12" cy="19" r="2"/>
            </svg>
          </button>
          {menuOpen && (
            <div className="chip-menu">
              <button onClick={(e) => { e.stopPropagation(); setMenuOpen(false); onOpenInBoard(card.id); }}>
                Open in Board
              </button>
              {isAdmin && (
                <>
                  <button onClick={(e) => { e.stopPropagation(); setMenuOpen(false); dateInputRef.current?.showPicker(); }}>
                    Change Date
                  </button>
                  {card.due_date && (
                    <button className="kebab-danger" onClick={(e) => { e.stopPropagation(); setMenuOpen(false); onRemoveDate(card.id); }}>
                      Remove Date
                    </button>
                  )}
                </>
              )}
            </div>
          )}
          <input
            ref={dateInputRef}
            type="date"
            className="chip-date-input"
            value={card.due_date ? card.due_date.split('T')[0] : ''}
            onChange={(e) => { if (e.target.value) onChangeDate(card.id, e.target.value); }}
            onClick={(e) => e.stopPropagation()}
          />
        </>
      )}
    </div>
  );
}

function MobileCalendarCard({ card, columnName, onOpenInBoard, onChangeDate, onRemoveDate, isAdmin }: {
  card: Card;
  columnName: string;
  onOpenInBoard: (cardId: string) => void;
  onChangeDate: (cardId: string, date: string) => void;
  onRemoveDate: (cardId: string) => void;
  isAdmin: boolean;
}) {
  const dateRef = useRef<HTMLInputElement>(null);

  return (
    <div className="mobile-cal-card" onClick={() => onOpenInBoard(card.id)}>
      <div className="mobile-cal-card-info">
        <span className="mobile-cal-card-title">{card.title}</span>
        <span className="mobile-cal-card-col">{columnName}</span>
      </div>
      {isAdmin && (
        <div className="mobile-cal-card-actions" onClick={e => e.stopPropagation()}>
          <button className="mobile-cal-card-btn" onClick={() => dateRef.current?.showPicker()}>Move</button>
          {card.due_date && (
            <button className="mobile-cal-card-btn mobile-cal-remove" onClick={() => onRemoveDate(card.id)}>Remove</button>
          )}
          <input ref={dateRef} type="date" className="chip-date-input" value={card.due_date ? card.due_date.split('T')[0] : ''} onChange={e => { if (e.target.value) onChangeDate(card.id, e.target.value); }} />
        </div>
      )}
    </div>
  );
}

export { CalendarCardChip, MobileCalendarCard };

export default function CalendarView({ board, onCardClick, filterCard, isAdmin, isMobile, onOpenInBoard, onChangeDate, onRemoveDate }: CalendarViewProps) {
  const [currentDate, setCurrentDate] = useState(new Date());
  const [viewType, setViewType] = useState<'month' | 'week'>('month');
  const [activeDate, setActiveDate] = useState<Date>(() => new Date());
  const agendaRef = useRef<MobileAgendaHandle>(null);

  const monthNames = ['January', 'February', 'March', 'April', 'May', 'June',
    'July', 'August', 'September', 'October', 'November', 'December'];

  // Collect all scheduled cards from all columns, filtered
  const getCardsForDate = (date: Date): { card: Card; columnName: string }[] => {
    const dateKey = formatDateKey(date);
    const results: { card: Card; columnName: string }[] = [];
    board.columns?.forEach(col => {
      col.cards?.forEach(card => {
        if (card.archived || !card.due_date || !filterCard(card)) return;
        const cardDate = card.due_date.split('T')[0];
        if (cardDate === dateKey) {
          results.push({ card, columnName: col.name });
        }
      });
    });
    return results;
  };

  const handlePrev = () => {
    setCurrentDate(prev => {
      if (viewType === 'month') return new Date(prev.getFullYear(), prev.getMonth() - 1, 1);
      const d = new Date(prev); d.setDate(d.getDate() - 7); return d;
    });
  };

  const handleNext = () => {
    setCurrentDate(prev => {
      if (viewType === 'month') return new Date(prev.getFullYear(), prev.getMonth() + 1, 1);
      const d = new Date(prev); d.setDate(d.getDate() + 7); return d;
    });
  };

  const handleToday = () => {
    setCurrentDate(new Date());
    if (isMobile) setActiveDate(new Date());
  };

  const cardDateSet = useMemo(() => {
    const s = new Set<string>();
    board.columns?.forEach(col => {
      col.cards?.forEach(card => {
        if (card.archived || !card.due_date || !filterCard(card)) return;
        s.add(card.due_date.split('T')[0]);
      });
    });
    return s;
  }, [board, filterCard]);

  const handleMiniCalSelect = (date: Date) => {
    setActiveDate(date);
    setCurrentDate(new Date(date.getFullYear(), date.getMonth(), 1));
    agendaRef.current?.scrollToDate(formatDateKey(date));
  };

  const formatWeekRange = (date: Date): string => {
    const days = getWeekDays(date);
    const first = days[0];
    const last = days[6];
    const opts: Intl.DateTimeFormatOptions = { month: 'short', day: 'numeric' };
    return `${first.toLocaleDateString('en-US', opts)} \u2013 ${last.toLocaleDateString('en-US', opts)}, ${last.getFullYear()}`;
  };

  const renderMonthView = () => {
    const year = currentDate.getFullYear();
    const month = currentDate.getMonth();
    const days = getMonthDays(year, month);
    const dayNames = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

    return (
      <div className="calendar-grid month-grid">
        {dayNames.map(d => <div key={d} className="calendar-day-header">{d}</div>)}
        {days.map((date, i) => {
          const dateKey = formatDateKey(date);
          const cards = getCardsForDate(date);
          const isCurrentMonth = date.getMonth() === month;
          const todayClass = isToday(date) ? ' calendar-today' : '';
          const outsideClass = !isCurrentMonth ? ' calendar-outside' : '';
          const maxVisible = 2;

          return (
            <Droppable key={i} droppableId={`calendar-${dateKey}`} type="CALENDAR">
              {(provided, snapshot) => (
                <div
                  className={`calendar-day${todayClass}${outsideClass}${snapshot.isDraggingOver ? ' calendar-drag-over' : ''}`}
                  data-date={dateKey}
                  ref={provided.innerRef}
                  {...provided.droppableProps}
                >
                  <div className="calendar-day-number">{date.getDate()}</div>
                  <div className="calendar-day-cards">
                    {cards.slice(0, maxVisible).map(({ card, columnName }, cardIndex) => (
                      <Draggable key={card.id} draggableId={card.id} index={cardIndex} isDragDisabled={!isAdmin || isMobile}>
                        {(provided) => (
                          <div ref={provided.innerRef} {...provided.draggableProps} {...provided.dragHandleProps}>
                            <CalendarCardChip
                              card={card}
                              columnName={columnName}
                              onClick={(e) => onCardClick(card, columnName, e)}
                              isMobile={isMobile}
                              isAdmin={isAdmin}
                              onOpenInBoard={onOpenInBoard}
                              onChangeDate={onChangeDate}
                              onRemoveDate={onRemoveDate}
                            />
                          </div>
                        )}
                      </Draggable>
                    ))}
                    {cards.length > maxVisible && (
                      <span className="calendar-more-btn">+{cards.length - maxVisible} more</span>
                    )}
                    {provided.placeholder}
                  </div>
                </div>
              )}
            </Droppable>
          );
        })}
      </div>
    );
  };

  const renderWeekView = () => {
    const days = getWeekDays(currentDate);
    const dayLabels = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

    return (
      <div className="calendar-grid week-grid">
        {days.map((date, i) => {
          const dateKey = formatDateKey(date);
          const cards = getCardsForDate(date);
          const todayClass = isToday(date) ? ' calendar-today' : '';

          return (
            <Droppable key={i} droppableId={`calendar-${dateKey}`} type="CALENDAR">
              {(provided, snapshot) => (
                <div
                  className={`calendar-day calendar-week-day${todayClass}${snapshot.isDraggingOver ? ' calendar-drag-over' : ''}`}
                  data-date={dateKey}
                  ref={provided.innerRef}
                  {...provided.droppableProps}
                >
                  <div className="calendar-week-day-header">
                    <span className="calendar-week-day-name">{dayLabels[i]}</span>
                    <span className="calendar-day-number">{date.getDate()}</span>
                  </div>
                  <div className="calendar-day-cards">
                    {cards.map(({ card, columnName }, cardIndex) => (
                      <Draggable key={card.id} draggableId={card.id} index={cardIndex} isDragDisabled={!isAdmin || isMobile}>
                        {(provided) => (
                          <div ref={provided.innerRef} {...provided.draggableProps} {...provided.dragHandleProps}>
                            <CalendarCardChip
                              card={card}
                              columnName={columnName}
                              onClick={(e) => onCardClick(card, columnName, e)}
                              isMobile={isMobile}
                              isAdmin={isAdmin}
                              onOpenInBoard={onOpenInBoard}
                              onChangeDate={onChangeDate}
                              onRemoveDate={onRemoveDate}
                            />
                          </div>
                        )}
                      </Draggable>
                    ))}
                    {provided.placeholder}
                  </div>
                </div>
              )}
            </Droppable>
          );
        })}
      </div>
    );
  };

  return (
    <div className="calendar-container">
      {isMobile ? (
        <>
          <MiniCalStrip
            currentDate={currentDate}
            activeDate={activeDate}
            onSelectDate={handleMiniCalSelect}
            onPrev={handlePrev}
            onNext={handleNext}
            onToday={handleToday}
            cardDateSet={cardDateSet}
          />
          <MobileAgendaView
            ref={agendaRef}
            board={board}
            filterCard={filterCard}
            isAdmin={isAdmin}
            onOpenInBoard={onOpenInBoard}
            onChangeDate={onChangeDate}
            onRemoveDate={onRemoveDate}
            onActiveDateChange={setActiveDate}
            onSwipeLeft={handleNext}
            onSwipeRight={handlePrev}
          />
        </>
      ) : (
        <>
          <div className="calendar-nav">
            <button className="btn-icon" onClick={handlePrev} title="Previous">&larr;</button>
            <button className="btn-secondary btn-sm" onClick={handleToday}>Today</button>
            <button className="btn-icon" onClick={handleNext} title="Next">&rarr;</button>
            <h2 className="calendar-nav-title">
              {viewType === 'month'
                ? `${monthNames[currentDate.getMonth()]} ${currentDate.getFullYear()}`
                : formatWeekRange(currentDate)}
            </h2>
            <div className="calendar-view-type">
              <button className={`btn-sm${viewType === 'month' ? ' btn-primary' : ' btn-secondary'}`} onClick={() => setViewType('month')}>Month</button>
              <button className={`btn-sm${viewType === 'week' ? ' btn-primary' : ' btn-secondary'}`} onClick={() => setViewType('week')}>Week</button>
            </div>
          </div>
          {viewType === 'month' ? renderMonthView() : renderWeekView()}
        </>
      )}
    </div>
  );
}
