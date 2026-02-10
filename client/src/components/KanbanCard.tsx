import { useState, useRef, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { Card, Column, Label, Comment, ChecklistItem, ActivityEntry, BoardMember } from '../types';
import { api } from '../api';
import { useConfirm } from '../contexts/ConfirmContext';
import MentionText from './MentionText';

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
  isMobile?: boolean;
  columns?: Column[];
  onMoveToColumn?: (cardId: string, columnId: string) => void;
  boardMembers?: BoardMember[];
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

function formatActivity(action: string, detail: Record<string, any> | null): string {
  switch (action) {
    case 'created': return 'created this card';
    case 'moved': return `moved this card from ${detail?.from_column} to ${detail?.to_column}`;
    case 'archived': return 'archived this card';
    case 'unarchived': return 'restored this card';
    case 'title_changed': return `renamed this card from "${detail?.from}" to "${detail?.to}"`;
    case 'description_changed': return 'updated the description';
    case 'assignees_changed': {
      const parts: string[] = [];
      if (detail?.added?.length) parts.push(`added ${detail.added.join(', ')}`);
      if (detail?.removed?.length) parts.push(`removed ${detail.removed.join(', ')}`);
      return parts.join(' and ') || 'changed assignees';
    }
    case 'members_changed': {
      const parts: string[] = [];
      if (detail?.added?.length) parts.push(`added ${detail.added.join(', ')}`);
      if (detail?.removed?.length) parts.push(`removed ${detail.removed.join(', ')}`);
      return parts.join(' and ') || 'changed members';
    }
    case 'labels_changed': return 'changed labels';
    case 'due_date_changed': {
      if (!detail?.from && detail?.to) return `set due date to ${detail.to}`;
      if (detail?.from && !detail?.to) return 'removed the due date';
      return `changed due date from ${detail?.from} to ${detail?.to}`;
    }
    default: return action.replace(/_/g, ' ');
  }
}

export default function KanbanCard({ card, canWrite, isEditing, onEditStart, onEditEnd, onDelete, onArchive, onUpdate, assignees = [], boardLabels = [], boardId, onAddAssignee, isMobile = false, columns = [], onMoveToColumn, boardMembers = [] }: KanbanCardProps) {
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
  const [showChecklist, setShowChecklist] = useState(!!(card.checklist && card.checklist.total > 0));
  const [showComments, setShowComments] = useState(false);

  // Members state
  const [editMembers, setEditMembers] = useState<string[]>(card.members?.map(m => m.id) || []);

  // Activity state
  const [activityEntries, setActivityEntries] = useState<ActivityEntry[]>([]);
  const [loadingActivity, setLoadingActivity] = useState(false);
  const [showActivity, setShowActivity] = useState(false);

  useEffect(() => {
    setEditTitle(card.title);
    setEditDescription(card.description || '');
    setEditDueDate(card.due_date ? card.due_date.split(' ')[0].split('T')[0] : '');
    setEditAssignees(card.assignees || []);
    setEditLabels(card.labels?.map(l => l.id) || []);
    setEditMembers(card.members?.map(m => m.id) || []);
  }, [card.title, card.description, card.due_date, card.assignees, card.labels, card.members]);

  useEffect(() => {
    if (isEditing) {
      loadComments();
      loadChecklist();
      loadActivity();
    }
  }, [isEditing]);

  const loadComments = async () => {
    setLoadingComments(true);
    try {
      const data = await api.getCardComments(card.id);
      setComments(data);
      if (data.length > 0) setShowComments(true);
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
      if (data.length > 0) setShowChecklist(true);
    } catch (err) {
      console.error('Failed to load checklist:', err);
    } finally {
      setLoadingChecklist(false);
    }
  };

  const loadActivity = async () => {
    setLoadingActivity(true);
    try {
      const data = await api.getCardActivity(card.id);
      setActivityEntries(data);
    } catch (err) {
      console.error('Failed to load activity:', err);
    } finally {
      setLoadingActivity(false);
    }
  };

  const removeMember = (id: string) => {
    setEditMembers(editMembers.filter(m => m !== id));
  };

  const selectMember = (id: string) => {
    if (!editMembers.includes(id)) setEditMembers([...editMembers, id]);
    setShowAutocomplete(false);
    setAutocompleteFilter('');
    if (inputRef.current) inputRef.current.value = '';
  };

  const handleSave = async () => {
    if (!editTitle.trim()) return;
    onUpdate({
      title: editTitle,
      description: editDescription,
      assignees: editAssignees,
      labels: editLabels as any,
      due_date: editDueDate || null
    });
    // Save members separately
    const originalMemberIds = card.members?.map(m => m.id) || [];
    if (JSON.stringify([...editMembers].sort()) !== JSON.stringify([...originalMemberIds].sort())) {
      try {
        await api.setCardMembers(card.id, editMembers);
      } catch (err) {
        console.error('Failed to save members:', err);
      }
    }
    onEditEnd();
  };

  const handleCancel = () => {
    setEditTitle(card.title);
    setEditDescription(card.description || '');
    setEditDueDate(card.due_date ? card.due_date.split(' ')[0].split('T')[0] : '');
    setEditAssignees(card.assignees || []);
    setEditLabels(card.labels?.map(l => l.id) || []);
    setEditMembers(card.members?.map(m => m.id) || []);
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

  // Shared edit form fields (used by both inline and fullscreen)
  const renderEditFields = () => (
    <>
      <input
        type="text"
        value={editTitle}
        onChange={(e) => setEditTitle(e.target.value)}
        className="card-edit-title"
        placeholder="Card title"
        autoFocus={!isMobile}
        onKeyDown={(e) => {
          if (!isMobile && e.key === 'Enter' && !e.shiftKey && !showAutocomplete) { e.preventDefault(); handleSave(); }
          else if (!isMobile && e.key === 'Escape') handleCancel();
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

      {/* Members & Assignees */}
      <div className="assignee-picker">
        {(editMembers.length > 0 || editAssignees.length > 0) && (
          <div className="assignee-chips">
            {editMembers.map(id => {
              const member = boardMembers?.find(m => m.id === id);
              if (!member) return null;
              return (
                <div key={id} className="assignee-chip member-chip">
                  <span className="chip-name">@{member.username}</span>
                  <button type="button" onClick={() => removeMember(id)} className="chip-remove" aria-label="Remove member">×</button>
                </div>
              );
            })}
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
          {(() => {
            const filteredMembersList = boardMembers.filter(m =>
              m.username.toLowerCase().includes(autocompleteFilter.toLowerCase()) &&
              !editMembers.includes(m.id)
            );
            const filteredAssigneesList = filteredAssignees;
            if (!showAutocomplete || (filteredMembersList.length === 0 && filteredAssigneesList.length === 0)) return null;
            return (
              <div className="mention-autocomplete">
                {filteredMembersList.length > 0 && (
                  <>
                    <div className="mention-group-header">
                      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.73 21a2 2 0 0 1-3.46 0"/></svg>
                      Members
                    </div>
                    {filteredMembersList.map((member, index) => (
                      <div key={member.id}
                        className={`mention-item mention-item-member ${index === selectedIndex ? 'selected' : ''}`}
                        onClick={() => selectMember(member.id)}
                        onMouseEnter={() => setSelectedIndex(index)}>
                        @{member.username}
                      </div>
                    ))}
                  </>
                )}
                {filteredAssigneesList.length > 0 && (
                  <>
                    <div className="mention-group-header">Assignees</div>
                    {filteredAssigneesList.map((assignee, index) => {
                      const adjustedIndex = filteredMembersList.length + index;
                      return (
                        <div key={assignee.id}
                          className={`mention-item mention-item-assignee ${adjustedIndex === selectedIndex ? 'selected' : ''}`}
                          onClick={() => selectAssignee(assignee.name)}
                          onMouseEnter={() => setSelectedIndex(adjustedIndex)}>
                          @{assignee.name}
                        </div>
                      );
                    })}
                  </>
                )}
              </div>
            );
          })()}
        </div>
      </div>

      {/* Move to column (mobile only) */}
      {isMobile && columns.length > 1 && onMoveToColumn && (
        <div className="card-move-to">
          <label htmlFor={`move-to-${card.id}`}>Move to</label>
          <select
            id={`move-to-${card.id}`}
            value={card.column_id}
            onChange={(e) => {
              if (e.target.value !== card.column_id) {
                onMoveToColumn(card.id, e.target.value);
              }
            }}
            className="move-to-select"
          >
            {columns.map(col => (
              <option key={col.id} value={col.id}>{col.name}</option>
            ))}
          </select>
        </div>
      )}

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
        <button type="button" className="section-toggle" onClick={() => setShowChecklist(!showChecklist)}>
          <span className="section-toggle-icon">{showChecklist ? '▾' : '▸'}</span>
          <strong>Checklist</strong>
          {checklistItems.length > 0 && (
            <span className="checklist-progress-text">
              {checklistItems.filter(i => i.checked).length}/{checklistItems.length}
            </span>
          )}
        </button>
        {showChecklist && (
          loadingChecklist ? (
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
          )
        )}
      </div>

      {/* Comments */}
      <div className="comments-section">
        <button type="button" className="section-toggle" onClick={() => setShowComments(!showComments)}>
          <span className="section-toggle-icon">{showComments ? '▾' : '▸'}</span>
          <strong>Comments</strong>
          {comments.length > 0 && (
            <span className="section-toggle-count">{comments.length}</span>
          )}
        </button>
        {showComments && (
          loadingComments ? (
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
                  <p className="comment-text"><MentionText text={comment.text} boardMembers={boardMembers} assignees={assignees} /></p>
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
          )
        )}
      </div>

      {/* Activity */}
      <div className="activity-section">
        <button type="button" className="section-toggle" onClick={() => setShowActivity(!showActivity)}>
          <span className="section-toggle-icon">{showActivity ? '▾' : '▸'}</span>
          <strong>Activity</strong>
          {activityEntries.length > 0 && (
            <span className="section-toggle-count">{activityEntries.length}</span>
          )}
        </button>
        {showActivity && (
          loadingActivity ? (
            <div className="loading-inline"><div className="spinner" style={{ width: 20, height: 20, borderWidth: 2 }}></div></div>
          ) : (
            <div className="activity-list">
              {activityEntries.length === 0 && <p className="empty-comments">No activity yet.</p>}
              {activityEntries.map(entry => (
                <div key={entry.id} className="activity-item">
                  <span className="activity-text">
                    <strong>{entry.username}</strong>{' '}
                    {formatActivity(entry.action, entry.detail)}
                  </span>
                  <span className="activity-time">{timeAgo(entry.created_at)}</span>
                </div>
              ))}
            </div>
          )
        )}
      </div>
    </>
  );

  if (isEditing && canWrite) {
    // Mobile: fullscreen portal
    if (isMobile) {
      return createPortal(
        <div className="card-fullscreen-overlay">
          <div className="card-fullscreen-header">
            <button onClick={handleCancel} className="btn-icon" aria-label="Back">←</button>
            <h2>{card.title}</h2>
            <button onClick={handleSave} className="btn-primary btn-sm">Save</button>
          </div>
          <div className="card-fullscreen-body">
            {renderEditFields()}
          </div>
          <div className="card-fullscreen-actions">
            <button onClick={() => { onEditEnd(); onArchive(); }} className="btn-secondary btn-sm btn-archive">Archive</button>
            <button onClick={() => { onEditEnd(); onDelete(); }} className="btn-danger btn-sm">Delete</button>
          </div>
        </div>,
        document.body
      );
    }

    // Desktop: inline editing
    return (
      <div className="kanban-card editing" onClick={(e) => e.stopPropagation()}>
        {renderEditFields()}
        <div className="card-edit-actions">
          <button onClick={handleSave} className="btn-primary btn-sm">Save</button>
          <button onClick={handleCancel} className="btn-secondary btn-sm">Cancel</button>
          <div className="card-edit-actions-right">
            <button onClick={() => { onEditEnd(); onArchive(); }} className="btn-secondary btn-sm btn-archive" title="Archive card">Archive</button>
            <button onClick={() => { onEditEnd(); onDelete(); }} className="btn-danger btn-sm" title="Delete card">Delete</button>
          </div>
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
            className="btn-delete card-archive"
            aria-label="Archive card"
            title="Archive"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 8v13H3V8"/><path d="M1 3h22v5H1z"/><path d="M10 12h4"/></svg>
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
