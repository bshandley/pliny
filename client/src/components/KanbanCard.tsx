import { Card } from '../types';

interface KanbanCardProps {
  card: Card;
  canWrite: boolean;
  onDelete: () => void;
}

export default function KanbanCard({ card, canWrite, onDelete }: KanbanCardProps) {
  return (
    <div className="kanban-card">
      <div className="card-header">
        <h4>{card.title}</h4>
        {canWrite && (
          <button onClick={onDelete} className="btn-delete" aria-label="Delete card">
            ×
          </button>
        )}
      </div>
      {card.description && (
        <p className="card-description">{card.description}</p>
      )}
      {card.assignee && (
        <div className="card-assignee">
          <span className="assignee-badge">{card.assignee}</span>
        </div>
      )}
    </div>
  );
}
