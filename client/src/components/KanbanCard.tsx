import { useState, useRef, useEffect } from 'react';
import { Card } from '../types';

interface KanbanCardProps {
  card: Card;
  canWrite: boolean;
  onDelete: () => void;
  onUpdate: (updates: Partial<Card>) => void;
  assignees?: { id: string; name: string }[];
  boardId: string;
  onAddAssignee: (name: string) => Promise<boolean>;
}

function getDueBadge(dueDateStr: string): { label: string; className: string } | null {
  if (!dueDateStr || dueDateStr.trim() === '') {
    return null;
  }
  
  // Extract just the YYYY-MM-DD part to avoid timezone issues
  const dateOnly = dueDateStr.split(' ')[0].split('T')[0];
  const parts = dateOnly.split('-');
  if (parts.length !== 3) return null;
  
  const year = parseInt(parts[0]);
  const month = parseInt(parts[1]) - 1; // 0-indexed
  const day = parseInt(parts[2]);
  
  if (isNaN(year) || isNaN(month) || isNaN(day)) return null;
  
  // Create dates at noon local time to avoid DST/timezone edge cases
  const due = new Date(year, month, day, 12, 0, 0);
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 12, 0, 0);
  
  const daysDiff = Math.round((due.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));
  
  if (daysDiff < 0) {
    return { label: 'Overdue', className: 'due-badge due-overdue' };
  }
  if (daysDiff === 0) {
    return { label: 'Today', className: 'due-badge due-soon' };
  }
  if (daysDiff === 1) {
    return { label: 'Tomorrow', className: 'due-badge due-soon' };
  }
  const monthStr = due.toLocaleString('en-US', { month: 'short' });
  return { label: `${monthStr} ${day}`, className: 'due-badge' };
}

export default function KanbanCard({ card, canWrite, onDelete, onUpdate, assignees = [], boardId, onAddAssignee }: KanbanCardProps) {
  const [isEditing, setIsEditing] = useState(false);
  const [editTitle, setEditTitle] = useState(card.title);
  const [editDescription, setEditDescription] = useState(card.description || '');
  // Format timestamp to YYYY-MM-DD for date input
  const [editDueDate, setEditDueDate] = useState(card.due_date ? card.due_date.split(' ')[0].split('T')[0] : '');
  const [editAssignees, setEditAssignees] = useState<string[]>(card.assignees || []);
  const [showAutocomplete, setShowAutocomplete] = useState(false);
  const [autocompleteFilter, setAutocompleteFilter] = useState('');
  const [selectedIndex, setSelectedIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  // Sync state when card changes
  useEffect(() => {
    console.log('Card updated, due_date:', card.due_date);
    setEditTitle(card.title);
    setEditDescription(card.description || '');
    const formattedDate = card.due_date ? card.due_date.split(' ')[0].split('T')[0] : '';
    console.log('Setting editDueDate to:', formattedDate);
    setEditDueDate(formattedDate);
    setEditAssignees(card.assignees || []);
  }, [card.title, card.description, card.due_date, card.assignees]);

  const handleSave = () => {
    if (!editTitle.trim()) return;
    
    onUpdate({
      title: editTitle,
      description: editDescription, // Always send description, even if empty
      assignees: editAssignees,
      due_date: editDueDate || null
    });
    setIsEditing(false);
  };

  const handleCancel = () => {
    setEditTitle(card.title);
    setEditDescription(card.description || '');
    // Format timestamp to YYYY-MM-DD for date input
    setEditDueDate(card.due_date ? card.due_date.split(' ')[0].split('T')[0] : '');
    setEditAssignees(card.assignees || []);
    setIsEditing(false);
    setShowAutocomplete(false);
    setAutocompleteFilter('');
  };

  const handleAssigneeInputChange = (value: string) => {
    if (value.startsWith('@')) {
      const filter = value.substring(1);
      setAutocompleteFilter(filter);
      setShowAutocomplete(true);
      setSelectedIndex(0);
    } else {
      setAutocompleteFilter(value);
      if (value === '') {
        setShowAutocomplete(false);
      }
    }
  };

  const filteredAssignees = assignees.filter(a => 
    a.name.toLowerCase().includes(autocompleteFilter.toLowerCase()) &&
    !editAssignees.includes(a.name)
  );

  const selectAssignee = (name: string) => {
    if (!editAssignees.includes(name)) {
      setEditAssignees([...editAssignees, name]);
    }
    setShowAutocomplete(false);
    setAutocompleteFilter('');
    if (inputRef.current) {
      inputRef.current.value = '';
    }
  };

  const removeAssignee = (name: string) => {
    setEditAssignees(editAssignees.filter(a => a !== name));
  };

  const handleKeyDown = async (e: React.KeyboardEvent) => {
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
    } else if (e.key === 'Enter') {
      // Free text entry - add to assignees table
      const input = inputRef.current?.value.trim();
      if (input && input !== '') {
        e.preventDefault();
        const name = input.startsWith('@') ? input.substring(1) : input;
        
        // Check if already exists
        const existingAssignee = assignees.find(a => a.name.toLowerCase() === name.toLowerCase());
        if (existingAssignee) {
          // Already exists, just add to card
          selectAssignee(existingAssignee.name);
        } else {
          // New assignee - add to board
          const success = await onAddAssignee(name);
          if (success) {
            selectAssignee(name);
          }
        }
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
            if (e.key === 'Enter' && !e.shiftKey && !showAutocomplete) {
              e.preventDefault();
              handleSave();
            } else if (e.key === 'Escape') {
              handleCancel();
            }
          }}
        />
        
        <div className="assignee-picker">
          {editAssignees.length > 0 && (
            <div className="assignee-chips">
              {editAssignees.map((name, index) => (
                <div key={index} className="assignee-chip">
                  <span className="chip-name">@{name}</span>
                  <button
                    type="button"
                    onClick={() => removeAssignee(name)}
                    className="chip-remove"
                    aria-label="Remove assignee"
                  >
                    ×
                  </button>
                </div>
              ))}
            </div>
          )}
          
          <div className="assignee-input-wrapper">
            <input
              ref={inputRef}
              type="text"
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
        </div>

        <textarea
          value={editDescription}
          onChange={(e) => setEditDescription(e.target.value)}
          placeholder="Description (optional)"
          className="card-edit-description"
          rows={3}
        />

        <div className="due-date-picker">
          <label htmlFor="due-date">Due date</label>
          <div className="due-date-input-row">
            <input
              type="date"
              id="due-date"
              value={editDueDate}
              onChange={(e) => setEditDueDate(e.target.value)}
              className="due-date-input"
            />
            {editDueDate && (
              <button
                type="button"
                onClick={() => setEditDueDate('')}
                className="btn-icon btn-sm due-date-clear"
                aria-label="Clear due date"
              >
                ×
              </button>
            )}
          </div>
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
      {(card.assignees?.length || card.due_date) && (
        <div className="card-assignees">
          {card.assignees?.map((name, index) => (
            <span key={index} className="assignee-badge">@{name}</span>
          ))}
          {card.due_date && (() => {
            const badge = getDueBadge(card.due_date);
            return badge ? <span className={badge.className}>{badge.label}</span> : null;
          })()}
        </div>
      )}
      {card.description && (
        <p className="card-description">{card.description}</p>
      )}
    </div>
  );
}
