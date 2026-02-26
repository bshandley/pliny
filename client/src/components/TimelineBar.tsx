import { useMemo, useState, useRef, useEffect } from 'react';
import { Card } from '../types';
import { api } from '../api';

interface TimelineBarProps {
  card: Card;
  columnName: string;
  barColor: string;
  dateToPx: (date: Date) => number;
  pxToDate: (px: number) => Date;
  zoom: 'day' | 'week' | 'month';
  rowIndex: number;
  isAdmin: boolean;
  onUpdate: () => void;
  onClick: () => void;
  onBarDragStart?: () => void;
  onBarDragEnd?: (clientX: number, clientY: number) => void;
  // Receives the projected chart-px position of the bar's LEFT EDGE (#20/#1),
  // plus raw clientX/Y so the parent can detect hover over the unscheduled zone (#21).
  onBarDragMove?: (projectedBarLeftChartPx: number, clientX: number, clientY: number) => void;
}

const ZOOM_PX_PER_DAY = {
  day: 40,
  week: 120 / 7,
  month: 160 / 30,
};

function addDays(date: Date, days: number): Date {
  const d = new Date(date);
  d.setDate(d.getDate() + days);
  return d;
}

function formatDateISO(date: Date): string {
  return date.toISOString().split('T')[0];
}

// #2: human-readable tooltip date
function formatReadableDate(dateStr: string | null | undefined): string {
  if (!dateStr) return '—';
  const d = new Date(dateStr.split('T')[0].split(' ')[0] + 'T12:00:00');
  if (isNaN(d.getTime())) return dateStr;
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

export default function TimelineBar({ card, columnName, barColor, dateToPx, pxToDate, zoom, rowIndex, isAdmin, onUpdate, onClick, onBarDragStart, onBarDragEnd, onBarDragMove }: TimelineBarProps) {
  const [dragOffset, setDragOffset] = useState(0);
  const [isDragging, setIsDragging] = useState(false);
  const [resizeOffset, setResizeOffset] = useState<{ edge: 'left' | 'right'; dx: number } | null>(null);
  const didInteractRef = useRef(false);

  // #4: reset visual offsets when card dates update — eliminates snap-back jiggle.
  // The bar's barStyle recomputes from new dates simultaneously, so position is seamless.
  useEffect(() => {
    setDragOffset(0);
    setResizeOffset(null);
  }, [card.start_date, card.due_date]);

  const barStyle = useMemo(() => {
    if (!card.start_date && !card.due_date) return null;

    if (card.start_date && card.due_date) {
      const left = dateToPx(new Date(card.start_date));
      const right = dateToPx(new Date(card.due_date));
      return { left, width: Math.max(right - left, 20), type: 'range' as const };
    }

    if (card.due_date) {
      const pos = dateToPx(new Date(card.due_date));
      return { left: pos - 10, width: 20, type: 'due-only' as const };
    }

    if (card.start_date) {
      const left = dateToPx(new Date(card.start_date));
      const right = dateToPx(new Date());
      return { left, width: Math.max(right - left, 20), type: 'open' as const };
    }

    return null;
  }, [card.start_date, card.due_date, dateToPx]);

  const pxToDays = (px: number): number => {
    return Math.round(px / ZOOM_PX_PER_DAY[zoom]);
  };

  const handleMouseDown = (e: React.MouseEvent) => {
    if (!isAdmin || (!card.start_date && !card.due_date) || !barStyle) return;
    e.preventDefault();
    const startX = e.clientX;
    const barLeftAtDragStart = barStyle.left; // chart px of bar's left edge when drag begins
    didInteractRef.current = false;
    setIsDragging(true);

    const origStart = card.start_date ? new Date(card.start_date) : null;
    const origEnd = card.due_date ? new Date(card.due_date) : null;

    onBarDragStart?.();

    const handleMove = (moveEvent: MouseEvent) => {
      const dx = moveEvent.clientX - startX;
      if (Math.abs(dx) > 5) didInteractRef.current = true;
      setDragOffset(dx);
      // #1: send projected left edge of bar (chart px), not raw mouse position;
      // also forward clientX/Y so parent can detect unscheduled-zone hover (#21).
      onBarDragMove?.(barLeftAtDragStart + dx, moveEvent.clientX, moveEvent.clientY);
    };

    const handleUp = async (upEvent: MouseEvent) => {
      document.removeEventListener('mousemove', handleMove);
      document.removeEventListener('mouseup', handleUp);
      setIsDragging(false);
      onBarDragEnd?.(upEvent.clientX, upEvent.clientY);

      const dx = upEvent.clientX - startX;
      const daysDelta = pxToDays(dx);
      if (daysDelta === 0) { setDragOffset(0); return; }

      const updates: Record<string, string> = {};

      if (!origStart && origEnd) {
        updates.due_date = formatDateISO(addDays(origEnd, daysDelta));
      } else if (origStart && origEnd) {
        updates.start_date = formatDateISO(addDays(origStart, daysDelta));
        updates.due_date = formatDateISO(addDays(origEnd, daysDelta));
      } else if (origStart) {
        updates.start_date = formatDateISO(addDays(origStart, daysDelta));
      }

      if (Object.keys(updates).length > 0) {
        try {
          await api.updateCard(card.id, updates as any);
          // #4: do NOT reset dragOffset here — useEffect resets it after card prop update,
          // so the bar stays in place (no snap-back jiggle)
          onUpdate();
        } catch {
          setDragOffset(0); // revert on error
        }
      } else {
        setDragOffset(0);
      }
    };

    document.addEventListener('mousemove', handleMove);
    document.addEventListener('mouseup', handleUp);
  };

  const handleResizeStart = (edge: 'left' | 'right', e: React.MouseEvent) => {
    if (!isAdmin) return;
    e.preventDefault();
    e.stopPropagation();
    didInteractRef.current = true;
    const startX = e.clientX;

    const handleMove = (moveEvent: MouseEvent) => {
      setResizeOffset({ edge, dx: moveEvent.clientX - startX });
    };

    const handleUp = async (upEvent: MouseEvent) => {
      document.removeEventListener('mousemove', handleMove);
      document.removeEventListener('mouseup', handleUp);
      const dx = upEvent.clientX - startX;
      const daysDelta = pxToDays(dx);
      if (daysDelta === 0) { setResizeOffset(null); return; }

      const updates: any = {};

      if (edge === 'left') {
        if (card.start_date) {
          const newStart = addDays(new Date(card.start_date), daysDelta);
          if (card.due_date && newStart >= new Date(card.due_date)) {
            // Dragged past due_date: collapse to a due-only marker (remove start_date).
            updates.start_date = null;
          } else {
            updates.start_date = formatDateISO(newStart);
          }
        } else if (card.due_date) {
          // Due-only: stretching left creates start_date
          const newStart = addDays(new Date(card.due_date), daysDelta);
          if (newStart < new Date(card.due_date)) {
            updates.start_date = formatDateISO(newStart);
          } else {
            setResizeOffset(null);
            return;
          }
        }
      } else if (edge === 'right') {
        if (card.due_date && !card.start_date) {
          // #3: Due-only stretched right → start_date = original due_date, due_date = stretched
          const newEnd = addDays(new Date(card.due_date), daysDelta);
          if (newEnd <= new Date(card.due_date)) { setResizeOffset(null); return; }
          updates.start_date = formatDateISO(new Date(card.due_date));
          updates.due_date = formatDateISO(newEnd);
        } else if (card.due_date) {
          // Range card: adjust due_date only
          const newEnd = addDays(new Date(card.due_date), daysDelta);
          if (card.start_date && newEnd <= new Date(card.start_date)) {
            // Dragged past start_date: collapse to a due-only marker at the start position.
            updates.due_date = formatDateISO(new Date(card.start_date));
            updates.start_date = null;
          } else {
            updates.due_date = formatDateISO(newEnd);
          }
        } else if (card.start_date) {
          // Start-only: stretching right creates due_date
          const newEnd = addDays(new Date(card.start_date), daysDelta);
          if (newEnd > new Date(card.start_date)) {
            updates.due_date = formatDateISO(newEnd);
          } else {
            setResizeOffset(null);
            return;
          }
        }
      }

      if (Object.keys(updates).length > 0) {
        try {
          await api.updateCard(card.id, updates);
          // #4: do NOT reset resizeOffset here — useEffect handles it after card prop update
          onUpdate();
        } catch {
          setResizeOffset(null); // revert on error
        }
      } else {
        setResizeOffset(null);
      }
    };

    document.addEventListener('mousemove', handleMove);
    document.addEventListener('mouseup', handleUp);
  };

  if (!barStyle) return null;

  const isDueOnly = barStyle.type === 'due-only';
  const isOpen = barStyle.type === 'open';

  let displayLeft = barStyle.left + dragOffset;
  let displayWidth = barStyle.width;
  if (resizeOffset) {
    if (resizeOffset.edge === 'left') {
      displayLeft += resizeOffset.dx;
      displayWidth -= resizeOffset.dx;
    } else {
      displayWidth += resizeOffset.dx;
    }
  }
  displayWidth = Math.max(displayWidth, 12);

  // Bug 3: During resize of a due-only marker, the CSS class forces width:12px !important
  // which defeats the inline style. Re-anchor left/width to the actual date position so
  // the bar visually stretches in real-time (class is stripped below when true).
  const isResizingMarker = isDueOnly && resizeOffset !== null;
  if (isResizingMarker && resizeOffset) {
    const duePos = barStyle.left + 10; // actual date pixel (center of the marker dot)
    if (resizeOffset.edge === 'left') {
      // Bar extends left from duePos; right edge stays anchored at duePos.
      displayLeft = duePos + resizeOffset.dx;
      displayWidth = Math.max(-resizeOffset.dx, 4);
    } else {
      // Bar extends right from duePos; left edge stays anchored at duePos.
      displayLeft = duePos;
      displayWidth = Math.max(resizeOffset.dx, 4);
    }
  }

  // #2: human-readable tooltip
  const tooltipDates = card.start_date && card.due_date
    ? `${formatReadableDate(card.start_date)} – ${formatReadableDate(card.due_date)}`
    : card.due_date
    ? `Due ${formatReadableDate(card.due_date)}`
    : card.start_date
    ? `Starts ${formatReadableDate(card.start_date)}`
    : '';

  return (
    <div
      className={`timeline-bar${isDueOnly && !isResizingMarker ? ' timeline-marker' : ''}${isOpen ? ' timeline-open-ended' : ''}${isDragging ? ' timeline-bar--dragging' : ''}`}
      style={{
        position: 'absolute',
        left: displayLeft,
        width: displayWidth,
        top: rowIndex * 32 + 4,
        '--bar-color': barColor,
      } as React.CSSProperties}
      onMouseDown={handleMouseDown}
      onClick={(e) => {
        e.stopPropagation();
        if (didInteractRef.current) {
          didInteractRef.current = false;
          return;
        }
        onClick();
      }}
      title={`${card.title}\n${columnName}\n${tooltipDates}`}
    >
      {isAdmin && (card.start_date || isDueOnly) && (
        <div className="bar-resize-handle bar-resize-left" onMouseDown={(e) => handleResizeStart('left', e)} />
      )}
      <span className="bar-title">{card.title}</span>
      {isAdmin && (card.due_date || isOpen) && (
        <div className="bar-resize-handle bar-resize-right" onMouseDown={(e) => handleResizeStart('right', e)} />
      )}
    </div>
  );
}
