import { useState } from 'react';
import { Card } from '../types';

interface KanbanCardProps {
  card: Card;
  canWrite: boolean;
  onDelete: () => void;
  onUpdate: (updates: Partial<Card>) => void;
}

export default function KanbanCard({ card, canWrite, onDelete, onUpdate }: KanbanCardProps) {
  const [isEditing, setIsEditing] = useState(false);
  const [editTitle, setEditTitle] = useState(card.title);
  const [editDescription, setEditDescription] = useState(card.description || '');

  const handleSave = () => {
    if (!editTitle.trim()) return;
    
    onUpdate({
      title: editTitle,
      description: editDescription || undefined
    });
    setIsEditing(false);
  };

  const handleCancel = () => {
    setEditTitle(card.title);
    setEditDescription(card.description || '');
    setIsEditing(false);
  };

  if (isEditing && canWrite) {
    return (
      <div className="kanban-card editing">
        <input
          type="text"
          value={editTitle}
          onChange={(e) => setEditTitle(e.target.value)}
          className="card-edit-title"
          autoFocus
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              handleSave();
            } else if (e.key === 'Escape') {
              handleCancel();
            }
          }}
        />
        <textarea
          value={editDescription}
          onChange={(e) => setEditDescription(e.target.value)}
          placeholder="Description (optional)"
          className="card-edit-description"
          rows={3}
        />
        <div className="card-edit-actions">
          <button onClick={handleSave} className="btn-primary btn-sm">Save</button>
          <button onClick={handleCancel} className="btn-secondary btn-sm">Cancel</button>
        </div>
      </div>
    );
  }

  return (
    <div 
      className="kanban-card"
      onClick={() => canWrite && setIsEditing(true)}
      style={{ cursor: canWrite ? 'pointer' : 'default' }}
    >
      <div className="card-header">
        <h4>{card.title}</h4>
        {canWrite && (
          <button 
            onClick={(e) => {
              e.stopPropagation();
              onDelete();
            }} 
            className="btn-delete card-delete" 
            aria-label="Delete card"
          >
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
