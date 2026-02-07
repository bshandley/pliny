import { useState, useRef, useEffect } from 'react';
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
  const [showAutocomplete, setShowAutocomplete] = useState(false);
  const [autocompleteFilter, setAutocompleteFilter] = useState('');
  const [selectedIndex, setSelectedIndex] = useState(0);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const handleSave = () => {
    if (!editTitle.trim()) return;
    
    onUpdate({
      title: editTitle,
      description: editDescription || undefined,
      assignee: editDescription.match(/@(\w+)/)?.[1] || card.assignee
    });
    setIsEditing(false);
  };

  const handleCancel = () => {
    setEditTitle(card.title);
    setEditDescription(card.description || '');
    setIsEditing(false);
    setShowAutocomplete(false);
  };

  const handleDescriptionChange = (value: string) => {
    setEditDescription(value);
    
    // Check for @ mention
    const cursorPos = textareaRef.current?.selectionStart || 0;
    const textBeforeCursor = value.substring(0, cursorPos);
    const match = textBeforeCursor.match(/@(\w*)$/);
    
    if (match) {
      setAutocompleteFilter(match[1]);
      setShowAutocomplete(true);
      setSelectedIndex(0);
    } else {
      setShowAutocomplete(false);
    }
  };

  const filteredAssignees = assignees.filter(a => 
    a.name.toLowerCase().startsWith(autocompleteFilter.toLowerCase())
  );

  const selectAssignee = (name: string) => {
    const cursorPos = textareaRef.current?.selectionStart || 0;
    const textBeforeCursor = editDescription.substring(0, cursorPos);
    const textAfterCursor = editDescription.substring(cursorPos);
    const lastAtIndex = textBeforeCursor.lastIndexOf('@');
    
    const newText = textBeforeCursor.substring(0, lastAtIndex + 1) + name + ' ' + textAfterCursor;
    setEditDescription(newText);
    setShowAutocomplete(false);
    
    // Focus back on textarea
    setTimeout(() => {
      textareaRef.current?.focus();
      const newCursorPos = lastAtIndex + name.length + 2;
      textareaRef.current?.setSelectionRange(newCursorPos, newCursorPos);
    }, 0);
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
        <div className="textarea-wrapper">
          <textarea
            ref={textareaRef}
            value={editDescription}
            onChange={(e) => handleDescriptionChange(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Description (use @ to mention assignees)"
            className="card-edit-description"
            rows={3}
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
