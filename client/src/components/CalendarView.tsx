import { useState } from 'react';
import { Droppable, Draggable } from 'react-beautiful-dnd';
import { Board, Card } from '../types';

interface CalendarViewProps {
  board: Board;
  onCardClick: (card: Card, columnName: string, event: React.MouseEvent) => void;
  filterCard: (card: Card) => boolean;
  isAdmin: boolean;
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

function CalendarCardChip({ card, columnName, onClick }: {
  card: Card;
  columnName: string;
  onClick: (e: React.MouseEvent) => void;
}) {
  return (
    <div className="calendar-card-chip" onClick={onClick}>
      <span className="chip-column-dot" style={{ background: 'var(--primary)' }} />
      <span className="chip-title">{card.title}</span>
    </div>
  );
}

export { CalendarCardChip };

export default function CalendarView({ board, onCardClick, filterCard, isAdmin }: CalendarViewProps) {
  const [currentDate, setCurrentDate] = useState(new Date());
  const [viewType, setViewType] = useState<'month' | 'week'>('month');

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

  const handleToday = () => setCurrentDate(new Date());

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
                      <Draggable key={card.id} draggableId={card.id} index={cardIndex} isDragDisabled={!isAdmin}>
                        {(provided) => (
                          <div ref={provided.innerRef} {...provided.draggableProps} {...provided.dragHandleProps}>
                            <CalendarCardChip card={card} columnName={columnName} onClick={(e) => onCardClick(card, columnName, e)} />
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
                      <Draggable key={card.id} draggableId={card.id} index={cardIndex} isDragDisabled={!isAdmin}>
                        {(provided) => (
                          <div ref={provided.innerRef} {...provided.draggableProps} {...provided.dragHandleProps}>
                            <CalendarCardChip card={card} columnName={columnName} onClick={(e) => onCardClick(card, columnName, e)} />
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
    </div>
  );
}
