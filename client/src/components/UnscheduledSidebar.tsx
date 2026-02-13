import { useState } from 'react';
import { Droppable, Draggable } from 'react-beautiful-dnd';
import { Board, Card } from '../types';

interface UnscheduledSidebarProps {
  board: Board;
  filterCard: (card: Card) => boolean;
  onCardClick: (card: Card, columnName: string, event: React.MouseEvent) => void;
  isAdmin: boolean;
}

export default function UnscheduledSidebar({ board, filterCard, onCardClick, isAdmin }: UnscheduledSidebarProps) {
  const [collapsed, setCollapsed] = useState(false);

  const unscheduledCards: { card: Card; columnName: string }[] = [];
  board.columns?.forEach(col => {
    col.cards?.filter(c => !c.due_date && !c.archived && filterCard(c)).forEach(card => {
      unscheduledCards.push({ card, columnName: col.name });
    });
  });

  return (
    <div className={`unscheduled-sidebar${collapsed ? ' collapsed' : ''}`}>
      <button className="unscheduled-header" onClick={() => setCollapsed(!collapsed)}>
        <span className="unscheduled-title">Unscheduled</span>
        <span className="unscheduled-count">{unscheduledCards.length}</span>
        <span className={`unscheduled-arrow${collapsed ? ' rotated' : ''}`}>&#x2039;</span>
      </button>
      {!collapsed && (
        <Droppable droppableId="unscheduled" type="CALENDAR">
          {(provided, snapshot) => (
            <div
              className={`unscheduled-list${snapshot.isDraggingOver ? ' unscheduled-drag-over' : ''}`}
              ref={provided.innerRef}
              {...provided.droppableProps}
            >
              {unscheduledCards.map(({ card, columnName }, index) => (
                <Draggable key={card.id} draggableId={card.id} index={index} isDragDisabled={!isAdmin}>
                  {(provided) => (
                    <div ref={provided.innerRef} {...provided.draggableProps} {...provided.dragHandleProps}>
                      <div className="calendar-card-chip sidebar-chip" onClick={(e) => onCardClick(card, columnName, e)}>
                        <span className="chip-column-dot" style={{ background: 'var(--primary)' }} />
                        <span className="chip-title">{card.title}</span>
                      </div>
                    </div>
                  )}
                </Draggable>
              ))}
              {provided.placeholder}
              {unscheduledCards.length === 0 && (
                <div className="unscheduled-empty">No unscheduled cards</div>
              )}
            </div>
          )}
        </Droppable>
      )}
    </div>
  );
}
