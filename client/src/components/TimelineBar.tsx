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

export default function TimelineBar({ card, columnName, barColor, dateToPx, pxToDate, zoom, rowIndex, isAdmin, onUpdate, onClick, onBarDragStart, onBarDragEnd }: TimelineBarProps) {
  const [dragOffset, setDragOffset] = useState(0);
  const [isDragging, setIsDragging] = useState(false);
  const [resizeOffset, setResizeOffset] = useState<{ edge: 'left' | 'right'; dx: number } | null>(null);
  // Track whether mouse moved enough to count as a drag (prevents click-after-drag)
  const didDragRef = useRef(false);
  const dragStartPos = useRef({ x: 0, y: 0 });

  const barStyle = useMemo(() => {
    if (!card.start_date && !card.due_date) return null;

    if (card.start_date && card.due_date) {
      const left = dateToPx(new Date(card.start_date));
      const right = dateToPx(new Date(card.due_date));
      return { left, width: Math.max(right - left, 20), type: 'range' as const };
    }

    if (card.due_date) {
      const pos = dateToPx(new Date(card.due_date));
      return { left: pos - 6, width: 12, type: 'marker' as const };
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
    // Allow drag if admin and at least one date exists
    if (!isAdmin || (!card.start_date && !card.due_date)) return;
    e.preventDefault();
    const startX = e.clientX;
    dragStartPos.current = { x: e.clientX, y: e.clientY };
    didDragRef.current = false;
    setIsDragging(true);

    const origStart = card.start_date ? new Date(card.start_date) : null;
    const origEnd = card.due_date ? new Date(card.due_date) : null;
    const isMarkerDrag = !card.start_date && card.due_date;

    onBarDragStart?.();

    const handleMove = (moveEvent: MouseEvent) => {
      const dx = moveEvent.clientX - dragStartPos.current.x;
      if (Math.abs(dx) > 5) didDragRef.current = true;
      setDragOffset(moveEvent.clientX - startX);
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

      if (isMarkerDrag && origEnd) {
        // Due-only card: shift only due_date
        updates.due_date = formatDateISO(addDays(origEnd, daysDelta));
      } else if (origStart && origEnd) {
        // Range card: shift both dates together
        updates.start_date = formatDateISO(addDays(origStart, daysDelta));
        updates.due_date = formatDateISO(addDays(origEnd, daysDelta));
      } else if (origStart) {
        // Start-only card: shift start_date
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
      if (edge === 'left' && card.start_date) {
        const newStart = addDays(new Date(card.start_date), daysDelta);
        // Don't let start go past due date
        if (card.due_date && newStart >= new Date(card.due_date)) {
          setResizeOffset(null);
          return;
        }
        updates.start_date = formatDateISO(newStart);
      } else if (edge === 'right' && card.due_date) {
        const newEnd = addDays(new Date(card.due_date), daysDelta);
        // Don't let end go before start date
        if (card.start_date && newEnd <= new Date(card.start_date)) {
          setResizeOffset(null);
          return;
        }
        updates.due_date = formatDateISO(newEnd);
      }

      try {
        await api.updateCard(card.id, updates);
        onUpdate();
      } catch {
        // revert handled by board reload
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

  const isMarker = barStyle.type === 'marker';
  const isOpen = barStyle.type === 'open';

  return (
    <div
      className={`timeline-bar${isMarker ? ' timeline-marker' : ''}${isOpen ? ' timeline-open-ended' : ''}${isDragging ? ' timeline-bar--dragging' : ''}`}
      style={{
        position: 'absolute',
        left: displayLeft,
        width: isMarker ? 12 : displayWidth,
        top: rowIndex * 32 + 4,
        '--bar-color': barColor,
      } as React.CSSProperties}
      onMouseDown={handleMouseDown}
      onClick={(e) => {
        e.stopPropagation();
        // Suppress click if the mouse moved enough to count as a drag
        if (didDragRef.current) return;
        onClick();
      }}
      title={`${card.title}\n${columnName}\n${card.start_date || '?'} – ${card.due_date || '?'}`}
    >
      {isAdmin && !isMarker && card.start_date && (
        <div className="bar-resize-handle bar-resize-left" onMouseDown={(e) => handleResizeStart('left', e)} />
      )}
      <span className="bar-title">{card.title}</span>
      {isAdmin && !isMarker && card.due_date && (
        <div className="bar-resize-handle bar-resize-right" onMouseDown={(e) => handleResizeStart('right', e)} />
      )}
    </div>
  );
}
