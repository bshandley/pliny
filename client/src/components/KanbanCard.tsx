import { useState, useRef, useEffect } from 'react';
import { Card, Label, Comment, ChecklistItem } from '../types';
import { api } from '../api';
import { useConfirm } from '../contexts/ConfirmContext';

interface KanbanCardProps {
  card: Card;
  canWrite: boolean;
  isEditing: boolean;
  onEditStart: () => void;
  onEditEnd: () => void;
  onDelete: () => void;
  onArchive: () => void;
  onUpdate: (updates: Partial<Card>) => void;
  assignees?: { id: string; name: string }[];
  boardLabels?: Label[];
  boardId: string;
  onAddAssignee: (name: string) => Promise<boolean>;
}

function getDueBadge(dueDateStr: string): { label: string; className: string } | null {
  if (!dueDateStr || dueDateStr.trim() === '') return null;
  const dateOnly = dueDateStr.split(' ')[0].split('T')[0];
  const parts = dateOnly.split('-');
  if (parts.length !== 3) return null;
  const year = parseInt(parts[0]);
  const month = parseInt(parts[1]) - 1;
  const day = parseInt(parts[2]);
  if (isNaN(year) || isNaN(month) || isNaN(day)) return null;
  const due = new Date(year, month, day, 12, 0, 0);
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 12, 0, 0);
  const daysDiff = Math.round((due.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));
  if (daysDiff < 0) return { label: 'Overdue', className: 'due-badge due-overdue' };
  if (daysDiff === 0) return { label: 'Today', className: 'due-badge due-soon' };
  if (daysDiff === 1) return { label: 'Tomorrow', className: 'due-badge due-soon' };
  const monthStr = due.toLocaleString('en-US', { month: 'short' });
  return { label: `${monthStr} ${day}`, className: 'due-badge' };
}

function timeAgo(dateStr: string): string {
  const now = Date.now();
  const then = new Date(dateStr).getTime();
  const secs = Math.floor((now - then) / 1000);
  if (secs < 60) return 'just now';
  const mins = Math.floor(secs / 60);
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  return `${days}d ago`;
}

export default function KanbanCard({ card, canWrite, isEditing, onEditStart, onEditEnd, onDelete, onArchive, onUpdate, assignees = [], boardLabels = [], boardId, onAddAssignee }: KanbanCardProps) {
  const confirm = useConfirm();
  const [editTitle, setEditTitle] = useState(card.title);
  const [editDescription, setEditDescription] = useState(card.description || '');
  const [editDueDate, setEditDueDate] = useState(card.due_date ? card.due_date.split(' ')[0].split('T')[0] : '');
  const [editAssignees, setEditAssignees] = useState<string[]>(card.assignees || []);
  const [editLabels, setEditLabels] = useState<string[]>(card.labels?.map(l => l.id) || []);
  const [showAutocomplete, setShowAutocomplete] = useState(false);
  const [autocompleteFilter, setAutocompleteFilter] = useState('');
  const [selectedIndex, setSelectedIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  // Comments state
  const [comments, setComments] = useState<Comment[]>([]);
  const [newComment, setNewComment] = useState('');
  const [loadingComments, setLoadingComments] = useState(false);

  // Checklist state
  const [checklistItems, setChecklistItems] = useState<ChecklistItem[]>([]);
  const [newChecklistItem, setNewChecklistItem] = useState('');
  const [loadingChecklist, setLoadingChecklist] = useState(false);

  useEffect(() => {
    setEditTitle(card.title);
    setEditDescription(card.description || '');
    setEditDueDate(card.due_date ? card.due_date.split(' ')[0].split('T')[0] : '');
    setEditAssignees(card.assignees || []);
    setEditLabels(card.labels?.map(l => l.id) || []);
  }, [card.title, card.description, card.due_date, card.assignees, card.labels]);

  useEffect(() => {
    if (isEditing) {
      loadComments();
      loadChecklist();
    }
  }, [isEditing]);

  const loadComments = async () => {
    setLoadingComments(true);
    try {
      const data = await api.getCardComments(card.id);
      setComments(data);
    } catch (err) {
      console.error('Failed to load comments:', err);
    } finally {
      setLoadingComments(false);
    }
  };

  const loadChecklist = async () => {
    setLoadingChecklist(true);
    try {
      const data = await api.getCardChecklist(card.id);
      setChecklistItems(data);
    } catch (err) {
      console.error('Failed to load checklist:', err);
    } finally {
      setLoadingChecklist(false);
    }
  };

  const handleSave = () => {
    if (!editTitle.trim()) return;
    onUpdate({
      title: editTitle,
      description: editDescription,
      assignees: editAssignees,
      labels: editLabels as any,
      due_date: editDueDate || null
    });
    onEditEnd();
  };

  const handleCancel = () => {
    setEditTitle(card.title);
    setEditDescription(card.description || '');
    setEditDueDate(card.due_date ? card.due_date.split(' ')[0].split('T')[0] : '');
    setEditAssignees(card.assignees || []);
    setEditLabels(card.labels?.map(l => l.id) || []);
    onEditEnd();
    setShowAutocomplete(false);
    setAutocompleteFilter('');
  };

  const handleAssigneeInputChange = (value: string) => {
    if (value.startsWith('@')) {
      setAutocompleteFilter(value.substring(1));
      setShowAutocomplete(true);
      setSelectedIndex(0);
    } else {
      setAutocompleteFilter(value);
      if (value === '') setShowAutocomplete(false);
    }
  };

  const filteredAssignees = assignees.filter(a =>
    a.name.toLowerCase().includes(autocompleteFilter.toLowerCase()) &&
    !editAssignees.includes(a.name)
  );

  const selectAssignee = (name: string) => {
    if (!editAssignees.includes(name)) setEditAssignees([...editAssignees, name]);
    setShowAutocomplete(false);
    setAutocompleteFilter('');
    if (inputRef.current) inputRef.current.value = '';
  };

  const removeAssignee = (name: string) => {
    setEditAssignees(editAssignees.filter(a => a !== name));
  };

  const toggleLabel = (labelId: string) => {
    setEditLabels(prev =>
      prev.includes(labelId) ? prev.filter(id => id !== labelId) : [...prev, labelId]
    );
  };

  const handleKeyDown = async (e: React.KeyboardEvent) => {
    if (showAutocomplete && filteredAssignees.length > 0) {
      if (e.key === 'ArrowDown') { e.preventDefault(); setSelectedIndex(prev => Math.min(prev + 1, filteredAssignees.length - 1)); }
      else if (e.key === 'ArrowUp') { e.preventDefault(); setSelectedIndex(prev => Math.max(prev - 1, 0)); }
      else if (e.key === 'Enter' || e.key === 'Tab') { e.preventDefault(); selectAssignee(filteredAssignees[selectedIndex].name); }
      else if (e.key === 'Escape') { setShowAutocomplete(false); setAutocompleteFilter(''); }
    } else if (e.key === 'Enter') {
      const input = inputRef.current?.value.trim();
      if (input && input !== '') {
        e.preventDefault();
        const name = input.startsWith('@') ? input.substring(1) : input;
        const existing = assignees.find(a => a.name.toLowerCase() === name.toLowerCase());
        if (existing) { selectAssignee(existing.name); }
        else { const success = await onAddAssignee(name); if (success) selectAssignee(name); }
      }
    }
  };

  const handleAddComment = async () => {
    if (!newComment.trim()) return;
    try {
      const comment = await api.addCardComment(card.id, newComment.trim());
      setComments([...comments, comment]);
      setNewComment('');
    } catch (err) {
      console.error('Failed to add comment:', err);
    }
  };

  const handleDeleteComment = async (id: string) => {
    try {
      await api.deleteComment(id);
      setComments(comments.filter(c => c.id !== id));
    } catch (err) {
      console.error('Failed to delete comment:', err);
    }
  };

  const handleAddChecklistItem = async () => {
    if (!newChecklistItem.trim()) return;
    try {
      const item = await api.addChecklistItem(card.id, newChecklistItem.trim());
      setChecklistItems([...checklistItems, item]);
      setNewChecklistItem('');
    } catch (err) {
      console.error('Failed to add checklist item:', err);
    }
  };

  const handleToggleChecklistItem = async (item: ChecklistItem) => {
    try {
      const updated = await api.updateChecklistItem(item.id, { checked: !item.checked });
      setChecklistItems(checklistItems.map(i => i.id === item.id ? updated : i));
    } catch (err) {
      console.error('Failed to toggle checklist item:', err);
    }
  };

  const handleDeleteChecklistItem = async (id: string) => {
    try {
      await api.deleteChecklistItem(id);
      setChecklistItems(checklistItems.filter(i => i.id !== id));
    } catch (err) {
      console.error('Failed to delete checklist item:', err);
    }
  };

  if (isEditing && canWrite) {
    return (
      <div className="kanban-card editing" onClick={(e) => e.stopPropagation()}>
        <input
          type="text"
          value={editTitle}
          onChange={(e) => setEditTitle(e.target.value)}
          className="card-edit-title"
          placeholder="Card title"
          autoFocus
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey && !showAutocomplete) { e.preventDefault(); handleSave(); }
            else if (e.key === 'Escape') handleCancel();
          }}
        />

        {/* Labels */}
        {boardLabels.length > 0 && (
          <div className="label-picker">
            {boardLabels.map(label => (
              <button
                key={label.id}
                type="button"
                className={`label-toggle ${editLabels.includes(label.id) ? 'selected' : ''}`}
                style={{ '--label-color': label.color } as React.CSSProperties}
                onClick={() => toggleLabel(label.id)}
              >
                {label.name}
              </button>
            ))}
          </div>
        )}

        {/* Assignees */}
        <div className="assignee-picker">
          {editAssignees.length > 0 && (
            <div className="assignee-chips">
              {editAssignees.map((name, index) => (
                <div key={index} className="assignee-chip">
                  <span className="chip-name">@{name}</span>
                  <button type="button" onClick={() => removeAssignee(name)} className="chip-remove" aria-label="Remove assignee">×</button>
                </div>
              ))}
            </div>
          )}
          <div className="assignee-input-wrapper">
            <input ref={inputRef} type="text" onChange={(e) => handleAssigneeInputChange(e.target.value)} onKeyDown={handleKeyDown} placeholder="Type @ to assign..." className="assignee-input" />
            {showAutocomplete && filteredAssignees.length > 0 && (
              <div className="mention-autocomplete">
                {filteredAssignees.map((assignee, index) => (
                  <div key={assignee.id} className={`mention-item ${index === selectedIndex ? 'selected' : ''}`} onClick={() => selectAssignee(assignee.name)} onMouseEnter={() => setSelectedIndex(index)}>@{assignee.name}</div>
                ))}
              </div>
            )}
          </div>
        </div>

        <textarea value={editDescription} onChange={(e) => setEditDescription(e.target.value)} placeholder="Description (optional)" className="card-edit-description" rows={3} />

        <div className="due-date-picker">
          <label htmlFor={`due-date-${card.id}`}>Due date</label>
          <div className="due-date-input-row">
            <input type="date" id={`due-date-${card.id}`} value={editDueDate} onChange={(e) => setEditDueDate(e.target.value)} className="due-date-input" />
            {editDueDate && (
              <button type="button" onClick={() => setEditDueDate('')} className="btn-icon btn-sm due-date-clear" aria-label="Clear due date">×</button>
            )}
          </div>
        </div>

        {/* Checklist */}
        <div className="checklist-section">
          <div className="checklist-header">
            <strong>Checklist</strong>
            {checklistItems.length > 0 && (
              <span className="checklist-progress-text">
                {checklistItems.filter(i => i.checked).length}/{checklistItems.length}
              </span>
            )}
          </div>
          {loadingChecklist ? (
            <div className="loading-inline"><div className="spinner" style={{ width: 20, height: 20, borderWidth: 2 }}></div></div>
          ) : (
            <>
              {checklistItems.map(item => (
                <div key={item.id} className="checklist-item">
                  <input type="checkbox" checked={item.checked} onChange={() => handleToggleChecklistItem(item)} />
                  <span className={item.checked ? 'checked-text' : ''}>{item.text}</span>
                  <button type="button" onClick={() => handleDeleteChecklistItem(item.id)} className="checklist-delete" aria-label="Delete item">×</button>
                </div>
              ))}
              <div className="checklist-add">
                <input
                  type="text"
                  value={newChecklistItem}
                  onChange={(e) => setNewChecklistItem(e.target.value)}
                  placeholder="Add item..."
                  className="checklist-input"
                  onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); handleAddChecklistItem(); } }}
                />
                <button type="button" onClick={handleAddChecklistItem} className="btn-primary btn-sm" disabled={!newChecklistItem.trim()}>+</button>
              </div>
            </>
          )}
        </div>

        {/* Comments */}
        <div className="comments-section">
          <strong>Comments</strong>
          {loadingComments ? (
            <div className="loading-inline"><div className="spinner" style={{ width: 20, height: 20, borderWidth: 2 }}></div></div>
          ) : (
            <>
              {comments.length === 0 && <p className="empty-comments">No comments yet.</p>}
              {comments.map(comment => (
                <div key={comment.id} className="comment-item">
                  <div className="comment-header">
                    <strong>{comment.username}</strong>
                    <span className="comment-time">{timeAgo(comment.created_at)}</span>
                    <button type="button" onClick={() => handleDeleteComment(comment.id)} className="comment-delete" aria-label="Delete comment">×</button>
                  </div>
                  <p className="comment-text">{comment.text}</p>
                </div>
              ))}
              <div className="comment-add">
                <input
                  type="text"
                  value={newComment}
                  onChange={(e) => setNewComment(e.target.value)}
                  placeholder="Write a comment..."
                  className="comment-input"
                  onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); handleAddComment(); } }}
                />
                <button type="button" onClick={handleAddComment} className="btn-primary btn-sm" disabled={!newComment.trim()}>Post</button>
              </div>
            </>
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
      className={`kanban-card ${card.archived ? 'archived' : ''}`}
      onClick={() => canWrite && onEditStart()}
      style={{ cursor: canWrite ? 'pointer' : 'default' }}
    >
      {/* Label color bars */}
      {card.labels && card.labels.length > 0 && (
        <div className="card-labels">
          {card.labels.map(label => (
            <span key={label.id} className="card-label-bar" style={{ background: label.color }} title={label.name} />
          ))}
        </div>
      )}
      <div className="card-header">
        <h4>{card.title}</h4>
        {canWrite && (
          <button
            onClick={(e) => { e.stopPropagation(); onArchive(); }}
            className="btn-delete card-delete"
            aria-label="Archive card"
            title="Archive"
          >
            ×
          </button>
        )}
      </div>
      {card.description && (
        <p className="card-description">{card.description}</p>
      )}
      {(card.assignees?.length || card.due_date || card.checklist) && (
        <div className="card-footer">
          <div className="card-footer-left">
            {card.assignees?.map((name, index) => (
              <span key={index} className="assignee-badge">{name}</span>
            ))}
          </div>
          <div className="card-footer-right">
            {card.due_date && (() => {
              const badge = getDueBadge(card.due_date);
              return badge ? <span className={badge.className}>{badge.label}</span> : null;
            })()}
            {card.checklist && card.checklist.total > 0 && (
              <span className={`checklist-badge ${card.checklist.checked === card.checklist.total ? 'checklist-done' : ''}`}>
                {card.checklist.checked}/{card.checklist.total}
              </span>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
