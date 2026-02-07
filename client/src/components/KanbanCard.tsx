import { useState, useRef } from 'react';
import { Card } from '../types';

interface KanbanCardProps {
  card: Card;
  canWrite: boolean;
  onDelete: () => void;
  onUpdate: (updates: Partial<Card>) => void;
  assignees?: { id: string; name: string }[];
}

export default function KanbanCard({ card, canWrite, onDelete, onUpdate, assignees = [] }: KanbanCardProps) {
  const [isEditing, setIsEditing] = useState(false);
  const [editTitle, setEditTitle] = useState(card.title);
  const [editDescription, setEditDescription] = useState(card.description || '');
  const [editAssignee, setEditAssignee] = useState(card.assignee || '');
  const [showAutocomplete, setShowAutocomplete] = useState(false);
  const [autocompleteFilter, setAutocompleteFilter] = useState('');
  const [selectedIndex, setSelectedIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  const handleSave = () => {
    if (!editTitle.trim()) return;
    
    onUpdate({
      title: editTitle,
      description: editDescription || undefined,
      assignee: editAssignee || undefined
    });
    setIsEditing(false);
  };

  const handleCancel = () => {
    setEditTitle(card.title);
    setEditDescription(card.description || '');
    setEditAssignee(card.assignee || '');
    setIsEditing(false);
    setShowAutocomplete(false);
  };

  const handleAssigneeInputChange = (value: string) => {
    setAutocompleteFilter(value);
    
    if (value.startsWith('@')) {
      const filter = value.substring(1);
      setAutocompleteFilter(filter);
      setShowAutocomplete(true);
      setSelectedIndex(0);
    } else if (value === '') {
      setShowAutocomplete(false);
    }
  };

  const filteredAssignees = assignees.filter(a => 
    a.name.toLowerCase().includes(autocompleteFilter.toLowerCase())
  );

  const selectAssignee = (name: string) => {
    setEditAssignee(name);
    setShowAutocomplete(false);
    setAutocompleteFilter('');
  };

  const removeAssignee = () => {
    setEditAssignee('');
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (showAutocomplete && filteredAssignees.length > 0) {
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setSelectedIndex((prev) => Math.min(prev + 1, filteredAssignees.length - 1));
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        setSelectedIndex((prev) => Math.max(prev - 1, 0));
      } else if (e.key === 'Enter' || e.key === 'Tab') {
        e.preventDefault();
        selectAssignee(filteredAssignees[selectedIndex].name);
      } else if (e.key === 'Escape') {
        setShowAutocomplete(false);
        setAutocompleteFilter('');
      }
    }
  };

  if (isEditing && canWrite) {
    return (
      <div className="kanban-card editing">
        <input
          type="text"
          value={editTitle}
          onChange={(e) => setEditTitle(e.target.value)}
          className="card-edit-title"
          placeholder="Card title"
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
        
        <div className="assignee-picker">
          {editAssignee ? (
            <div className="assignee-chip">
              <span className="chip-name">@{editAssignee}</span>
              <button
                type="button"
                onClick={removeAssignee}
                className="chip-remove"
                aria-label="Remove assignee"
              >
                ×
              </button>
            </div>
          ) : (
            <div className="assignee-input-wrapper">
              <input
                ref={inputRef}
                type="text"
                value={autocompleteFilter ? '@' + autocompleteFilter : ''}
                onChange={(e) => handleAssigneeInputChange(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder="Type @ to assign..."
                className="assignee-input"
              />
              {showAutocomplete && filteredAssignees.length > 0 && (
                <div className="mention-autocomplete">
                  {filteredAssignees.map((assignee, index) => (
                    <div
                      key={assignee.id}
                      className={`mention-item ${index === selectedIndex ? 'selected' : ''}`}
                      onClick={() => selectAssignee(assignee.name)}
                      onMouseEnter={() => setSelectedIndex(index)}
                    >
                      @{assignee.name}
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>

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
      {card.assignee && (
        <div className="card-assignee">
          <span className="assignee-badge">@{card.assignee}</span>
        </div>
      )}
      {card.description && (
        <p className="card-description">{card.description}</p>
      )}
    </div>
  );
}
