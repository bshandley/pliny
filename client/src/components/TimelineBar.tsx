import { useMemo, useState, useRef } from 'react';
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
  onBarDragMove?: (clientX: number) => void; // #20: live indicator during scheduled bar drag
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

export default function TimelineBar({ card, columnName, barColor, dateToPx, pxToDate, zoom, rowIndex, isAdmin, onUpdate, onClick, onBarDragStart, onBarDragEnd, onBarDragMove }: TimelineBarProps) {
  const [dragOffset, setDragOffset] = useState(0);
  const [isDragging, setIsDragging] = useState(false);
  const [resizeOffset, setResizeOffset] = useState<{ edge: 'left' | 'right'; dx: number } | null>(null);
  // #23: single ref tracks any interaction (move OR resize) to suppress spurious click-after-drag
  const didInteractRef = useRef(false);

  const barStyle = useMemo(() => {
    if (!card.start_date && !card.due_date) return null;

    if (card.start_date && card.due_date) {
      const left = dateToPx(new Date(card.start_date));
      const right = dateToPx(new Date(card.due_date));
      return { left, width: Math.max(right - left, 20), type: 'range' as const };
    }

    if (card.due_date) {
      // #22: render due-only as a small bar (not a tiny 12px dot) so it has resize handles
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
    if (!isAdmin || (!card.start_date && !card.due_date)) return;
    e.preventDefault();
    const startX = e.clientX;
    didInteractRef.current = false;
    setIsDragging(true);

    const origStart = card.start_date ? new Date(card.start_date) : null;
    const origEnd = card.due_date ? new Date(card.due_date) : null;

    onBarDragStart?.();

    const handleMove = (moveEvent: MouseEvent) => {
      const dx = moveEvent.clientX - startX;
      if (Math.abs(dx) > 5) didInteractRef.current = true;
      setDragOffset(dx);
      // #20: notify parent so it can show the drop indicator
      onBarDragMove?.(moveEvent.clientX);
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
        // Due-only: shift due_date
        updates.due_date = formatDateISO(addDays(origEnd, daysDelta));
      } else if (origStart && origEnd) {
        // Range: shift both
        updates.start_date = formatDateISO(addDays(origStart, daysDelta));
        updates.due_date = formatDateISO(addDays(origEnd, daysDelta));
      } else if (origStart) {
        // Start-only: shift start_date
        updates.start_date = formatDateISO(addDays(origStart, daysDelta));
      }

      if (Object.keys(updates).length > 0) {
        try {
          await api.updateCard(card.id, updates as any);
          onUpdate();
        } catch {
          // revert handled by board reload
        }
      }
      setDragOffset(0);
    };

    document.addEventListener('mousemove', handleMove);
    document.addEventListener('mouseup', handleUp);
  };

  const handleResizeStart = (edge: 'left' | 'right', e: React.MouseEvent) => {
    if (!isAdmin) return;
    e.preventDefault();
    e.stopPropagation();
    // #23: mark as interacted so the bar's onClick is suppressed
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
          // Adjust existing start date
          const newStart = addDays(new Date(card.start_date), daysDelta);
          if (card.due_date && newStart >= new Date(card.due_date)) {
            setResizeOffset(null);
            return;
          }
          updates.start_date = formatDateISO(newStart);
        } else if (card.due_date) {
          // #22: due-only card — stretching left creates a start_date
          const newStart = addDays(new Date(card.due_date), daysDelta);
          if (newStart < new Date(card.due_date)) {
            updates.start_date = formatDateISO(newStart);
          } else {
            setResizeOffset(null);
            return;
          }
        }
      } else if (edge === 'right') {
        if (card.due_date) {
          // Adjust existing due date
          const newEnd = addDays(new Date(card.due_date), daysDelta);
          if (card.start_date && newEnd <= new Date(card.start_date)) {
            setResizeOffset(null);
            return;
          }
          updates.due_date = formatDateISO(newEnd);
        } else if (card.start_date) {
          // #22: start-only card — stretching right creates a due_date
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
          onUpdate();
        } catch {
          // revert handled by board reload
        }
      }
      setResizeOffset(null);
    };

    document.addEventListener('mousemove', handleMove);
    document.addEventListener('mouseup', handleUp);
  };

  if (!barStyle) return null;

  // Apply drag/resize offsets for visual feedback
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

  const isDueOnly = barStyle.type === 'due-only';
  const isOpen = barStyle.type === 'open';

  return (
    <div
      className={`timeline-bar${isDueOnly ? ' timeline-marker' : ''}${isOpen ? ' timeline-open-ended' : ''}${isDragging ? ' timeline-bar--dragging' : ''}`}
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
        // #23: suppress click if any interaction (drag or resize) occurred
        if (didInteractRef.current) {
          didInteractRef.current = false;
          return;
        }
        onClick();
      }}
      title={`${card.title}\n${columnName}\n${card.start_date || '?'} – ${card.due_date || '?'}`}
    >
      {/* #22: left handle — show for range cards (adjust start) or due-only (create start) */}
      {isAdmin && (card.start_date || isDueOnly) && (
        <div className="bar-resize-handle bar-resize-left" onMouseDown={(e) => handleResizeStart('left', e)} />
      )}
      <span className="bar-title">{card.title}</span>
      {/* #22: right handle — show for range/open cards (adjust/create due) */}
      {isAdmin && (card.due_date || isOpen) && (
        <div className="bar-resize-handle bar-resize-right" onMouseDown={(e) => handleResizeStart('right', e)} />
      )}
    </div>
  );
}
