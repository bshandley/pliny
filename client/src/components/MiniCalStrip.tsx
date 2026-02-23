import { useState, useMemo } from 'react';

interface MiniCalStripProps {
  currentDate: Date;
  activeDate: Date;
  onSelectDate: (date: Date) => void;
  onPrev: () => void;
  onNext: () => void;
  onToday: () => void;
  cardDateSet: Set<string>;
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

function getMonthDays(year: number, month: number): Date[] {
  const firstDay = new Date(year, month, 1);
  const startOffset = firstDay.getDay();
  const days: Date[] = [];
  for (let i = startOffset - 1; i >= 0; i--) {
    days.push(new Date(year, month, -i));
  }
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  for (let i = 1; i <= daysInMonth; i++) {
    days.push(new Date(year, month, i));
  }
  while (days.length % 7 !== 0) {
    const last = days[days.length - 1];
    days.push(new Date(last.getFullYear(), last.getMonth(), last.getDate() + 1));
  }
  return days;
}

const monthNames = ['January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December'];

export default function MiniCalStrip({ currentDate, activeDate, onSelectDate, onPrev, onNext, onToday, cardDateSet }: MiniCalStripProps) {
  const [expanded, setExpanded] = useState(false);

  const weekDays = useMemo(() => getWeekDays(activeDate), [activeDate]);
  const monthDays = useMemo(() => getMonthDays(currentDate.getFullYear(), currentDate.getMonth()), [currentDate]);

  const dayNames = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];

  const handleDayClick = (date: Date) => {
    onSelectDate(date);
    if (expanded) setExpanded(false);
  };

  const renderDayCell = (date: Date, isCurrentMonth?: boolean) => {
    const key = formatDateKey(date);
    const today = isToday(date);
    const active = formatDateKey(activeDate) === key;
    const hasCards = cardDateSet.has(key);
    const outside = isCurrentMonth === false;

    return (
      <button
        key={key + (outside ? '-out' : '')}
        className={`mini-cal-day${today ? ' mini-cal-today' : ''}${active ? ' mini-cal-active' : ''}${outside ? ' mini-cal-outside' : ''}`}
        onClick={() => handleDayClick(date)}
      >
        <span className="mini-cal-num">{date.getDate()}</span>
        {hasCards && <span className="mini-cal-dot" />}
      </button>
    );
  };

  return (
    <div className="mini-cal-strip">
      <div className="mini-cal-header">
        <button className="cal-nav-arrow" onClick={onPrev} aria-label="Previous">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="15 18 9 12 15 6"/></svg>
        </button>
        <h2 className="mini-cal-title">
          {monthNames[currentDate.getMonth()]} {currentDate.getFullYear()}
        </h2>
        <button className="cal-nav-arrow" onClick={onNext} aria-label="Next">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="9 18 15 12 9 6"/></svg>
        </button>
        <button className="cal-today-btn" onClick={onToday}>Today</button>
      </div>

      {expanded ? (
        <div className="mini-cal-month">
          {dayNames.map((d, i) => (
            <div key={i} className="mini-cal-day-header">{d}</div>
          ))}
          {monthDays.map((date) => renderDayCell(date, date.getMonth() === currentDate.getMonth()))}
        </div>
      ) : (
        <div className="mini-cal-week">
          {dayNames.map((d, i) => (
            <div key={i} className="mini-cal-day-header">{d}</div>
          ))}
          {weekDays.map((date) => renderDayCell(date))}
        </div>
      )}

      <button className="mini-cal-toggle" onClick={() => setExpanded(!expanded)} aria-label={expanded ? 'Collapse calendar' : 'Expand calendar'}>
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={expanded ? 'mini-cal-chevron-up' : 'mini-cal-chevron-down'}>
          <polyline points="6 9 12 15 18 9"/>
        </svg>
      </button>
    </div>
  );
}
