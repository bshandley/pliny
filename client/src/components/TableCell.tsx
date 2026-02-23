import { useState, useRef, useEffect } from 'react';
import { Card, Column, Label, BoardMember } from '../types';
import { api } from '../api';

interface TableCellProps {
  card: Card;
  column: Column;
  field: string;
  isAdmin: boolean;
  boardColumns: Column[];
  boardLabels: Label[];
  onUpdate: () => void;
  onCardClick: (cardId: string) => void;
  boardMembers: BoardMember[];
  assignees: { id: string; name: string }[];
}

export default function TableCell({ card, column, field, isAdmin, boardColumns, boardLabels, onUpdate, onCardClick, boardMembers, assignees }: TableCellProps) {
  switch (field) {
    case 'title':
      return <TitleCell card={card} isAdmin={isAdmin} onUpdate={onUpdate} onCardClick={onCardClick} />;
    case 'status':
      return <StatusCell card={card} column={column} isAdmin={isAdmin} boardColumns={boardColumns} onUpdate={onUpdate} />;
    case 'assignees':
      return <AssigneesCell card={card} isAdmin={isAdmin} onUpdate={onUpdate} boardMembers={boardMembers} assignees={assignees} />;
    case 'due_date':
      return <DueDateCell card={card} isAdmin={isAdmin} onUpdate={onUpdate} />;
    case 'labels':
      return <LabelsCell card={card} isAdmin={isAdmin} boardLabels={boardLabels} onUpdate={onUpdate} />;
    case 'description':
      return <DescriptionCell card={card} isAdmin={isAdmin} onUpdate={onUpdate} />;
    default:
      return <td className="table-cell">—</td>;
  }
}

function TitleCell({ card, isAdmin, onUpdate, onCardClick }: {
  card: Card; isAdmin: boolean; onUpdate: () => void; onCardClick: (id: string) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(card.title);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => { setValue(card.title); }, [card.title]);
  useEffect(() => { if (editing) inputRef.current?.focus(); }, [editing]);

  const handleSave = async () => {
    const trimmed = value.trim();
    if (trimmed && trimmed !== card.title) {
      try {
        await api.updateCard(card.id, { title: trimmed });
        onUpdate();
      } catch {
        setValue(card.title);
      }
    } else {
      setValue(card.title);
    }
    setEditing(false);
  };

  if (editing) {
    return (
      <td className="table-cell editing">
        <input
          ref={inputRef}
          className="table-cell-input"
          value={value}
          onChange={e => setValue(e.target.value)}
          onBlur={handleSave}
          onKeyDown={e => { if (e.key === 'Enter') handleSave(); if (e.key === 'Escape') { setValue(card.title); setEditing(false); } }}
          maxLength={255}
        />
      </td>
    );
  }

  return (
    <td
      className={`table-cell table-title-cell${isAdmin ? ' editable' : ''}`}
      onClick={() => onCardClick(card.id)}
      onDoubleClick={e => { e.stopPropagation(); if (isAdmin) setEditing(true); }}
    >
      {card.title}
    </td>
  );
}

function StatusCell({ card, column, isAdmin, boardColumns, onUpdate }: {
  card: Card; column: Column; isAdmin: boolean; boardColumns: Column[]; onUpdate: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const selectRef = useRef<HTMLSelectElement>(null);

  useEffect(() => { if (editing) selectRef.current?.focus(); }, [editing]);

  const handleChange = async (e: React.ChangeEvent<HTMLSelectElement>) => {
    const newColumnId = e.target.value;
    if (newColumnId !== card.column_id) {
      try {
        const targetCol = boardColumns.find(c => c.id === newColumnId);
        const position = targetCol?.cards?.length || 0;
        await api.updateCard(card.id, { column_id: newColumnId, position } as any);
        onUpdate();
      } catch {
        // revert handled by board reload
      }
    }
    setEditing(false);
  };

  if (editing) {
    return (
      <td className="table-cell editing">
        <select
          ref={selectRef}
          className="table-cell-select"
          value={card.column_id}
          onChange={handleChange}
          onBlur={() => setEditing(false)}
        >
          {boardColumns.map(col => (
            <option key={col.id} value={col.id}>{col.name}</option>
          ))}
        </select>
      </td>
    );
  }

  return (
    <td className={`table-cell${isAdmin ? ' editable' : ''}`} onClick={() => isAdmin && setEditing(true)}>
      <span className="table-status-badge">{column.name}</span>
    </td>
  );
}

function AssigneesCell({ card, isAdmin, onUpdate, boardMembers, assignees }: {
  card: Card; isAdmin: boolean; onUpdate: () => void;
  boardMembers: BoardMember[]; assignees: { id: string; name: string }[];
}) {
  const [showDropdown, setShowDropdown] = useState(false);
  const [filter, setFilter] = useState('');
  const wrapperRef = useRef<HTMLDivElement>(null);
  const filterRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!showDropdown) return;
    const handleClick = (e: MouseEvent) => {
      if (wrapperRef.current && !wrapperRef.current.contains(e.target as Node)) {
        setShowDropdown(false);
        setFilter('');
      }
    };
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [showDropdown]);

  useEffect(() => {
    if (showDropdown) filterRef.current?.focus();
  }, [showDropdown]);

  const currentMemberIds = new Set(card.members?.map(m => m.id) || []);
  const currentAssigneeNames = new Set(card.assignees || []);

  const toggleMember = async (memberId: string) => {
    const memberIds = card.members?.map(m => m.id) || [];
    const newMemberIds = currentMemberIds.has(memberId)
      ? memberIds.filter(id => id !== memberId)
      : [...memberIds, memberId];
    try {
      await api.setCardMembers(card.id, newMemberIds);
      onUpdate();
    } catch { /* revert handled by board reload */ }
  };

  const toggleAssignee = async (name: string) => {
    const current = card.assignees || [];
    const newAssignees = currentAssigneeNames.has(name)
      ? current.filter(a => a !== name)
      : [...current, name];
    try {
      await api.updateCard(card.id, { assignees: newAssignees } as any);
      onUpdate();
    } catch { /* revert handled by board reload */ }
  };

  const lowerFilter = filter.toLowerCase();
  const memberUsernames = new Set(boardMembers.map(m => m.username));
  const filteredMembers = boardMembers.filter(m =>
    m.username.toLowerCase().includes(lowerFilter)
  );
  const filteredAssignees = assignees.filter(a =>
    a.name.toLowerCase().includes(lowerFilter) && !memberUsernames.has(a.name)
  );

  const displayNames = [
    ...(card.members?.map(m => m.username) || []),
    ...(card.assignees || [])
  ].filter((v, i, a) => a.indexOf(v) === i);

  return (
    <td className={`table-cell${isAdmin ? ' editable' : ''}`}>
      <div className="table-assignee-editor" ref={wrapperRef} onClick={() => isAdmin && !showDropdown && setShowDropdown(true)}>
        {displayNames.length ? displayNames.join(', ') : <span className="table-empty-cell">—</span>}
        {showDropdown && (
          <div className="table-assignee-dropdown" onClick={e => e.stopPropagation()}>
            <input
              ref={filterRef}
              className="table-assignee-filter"
              value={filter}
              onChange={e => setFilter(e.target.value)}
              placeholder="Filter members..."
              onKeyDown={e => { if (e.key === 'Escape') { setShowDropdown(false); setFilter(''); } }}
            />
            {filteredMembers.length > 0 && (
              <>
                <div className="table-assignee-group-header">Members</div>
                {filteredMembers.map(member => (
                  <button key={member.id} className="table-assignee-option" onClick={() => toggleMember(member.id)}>
                    {member.username}
                    {currentMemberIds.has(member.id) && <span className="table-assignee-check">✓</span>}
                  </button>
                ))}
              </>
            )}
            {filteredAssignees.length > 0 && (
              <>
                <div className="table-assignee-group-header">Assignees</div>
                {filteredAssignees.map(assignee => (
                  <button key={assignee.id} className="table-assignee-option" onClick={() => toggleAssignee(assignee.name)}>
                    {assignee.name}
                    {currentAssigneeNames.has(assignee.name) && <span className="table-assignee-check">✓</span>}
                  </button>
                ))}
              </>
            )}
            {filteredMembers.length === 0 && filteredAssignees.length === 0 && (
              <div className="table-assignee-empty">No matches</div>
            )}
          </div>
        )}
      </div>
    </td>
  );
}

function DueDateCell({ card, isAdmin, onUpdate }: {
  card: Card; isAdmin: boolean; onUpdate: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const dateStr = card.due_date ? card.due_date.split('T')[0] : '';

  useEffect(() => { if (editing) inputRef.current?.focus(); }, [editing]);

  const handleChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const newDate = e.target.value || null;
    try {
      await api.updateCard(card.id, { due_date: newDate } as any);
      onUpdate();
    } catch {
      // revert handled by board reload
    }
    setEditing(false);
  };

  const isOverdue = (() => {
    if (!card.due_date) return false;
    const due = new Date(card.due_date.split('T')[0] + 'T12:00:00');
    return due < new Date(new Date().toDateString());
  })();

  const formatDate = (d: string) => {
    const date = new Date(d.split('T')[0] + 'T12:00:00');
    return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  };

  if (editing) {
    return (
      <td className="table-cell editing">
        <input
          ref={inputRef}
          type="date"
          className="table-cell-input"
          value={dateStr}
          onChange={handleChange}
          onBlur={() => setEditing(false)}
        />
      </td>
    );
  }

  return (
    <td className={`table-cell table-due-cell${isOverdue ? ' overdue' : ''}${isAdmin ? ' editable' : ''}`} onClick={() => isAdmin && setEditing(true)}>
      {card.due_date ? formatDate(card.due_date) : <span className="table-empty-cell">—</span>}
    </td>
  );
}

function LabelsCell({ card, isAdmin, boardLabels, onUpdate }: {
  card: Card; isAdmin: boolean; boardLabels: Label[]; onUpdate: () => void;
}) {
  const [showDropdown, setShowDropdown] = useState(false);
  const wrapperRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!showDropdown) return;
    const handleClick = (e: MouseEvent) => {
      if (wrapperRef.current && !wrapperRef.current.contains(e.target as Node)) {
        setShowDropdown(false);
      }
    };
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [showDropdown]);

  const currentLabelIds = new Set(card.labels?.map(l => l.id) || []);

  const toggleLabel = async (labelId: string) => {
    const newLabelIds = currentLabelIds.has(labelId)
      ? Array.from(currentLabelIds).filter(id => id !== labelId)
      : [...Array.from(currentLabelIds), labelId];
    try {
      await api.updateCard(card.id, { labels: newLabelIds } as any);
      onUpdate();
    } catch {
      // revert handled by board reload
    }
  };

  return (
    <td className={`table-cell${isAdmin ? ' editable' : ''}`}>
      <div className="table-label-editor" ref={wrapperRef} onClick={() => isAdmin && setShowDropdown(!showDropdown)}>
        {card.labels?.length ? (
          card.labels.map(l => (
            <span key={l.id} className="table-label-pill" style={{ background: l.color }}>
              {l.name}
            </span>
          ))
        ) : (
          <span className="table-empty-cell">—</span>
        )}
        {showDropdown && (
          <div className="table-label-dropdown" onClick={e => e.stopPropagation()}>
            {boardLabels.map(label => (
              <button
                key={label.id}
                className="table-label-option"
                onClick={() => toggleLabel(label.id)}
              >
                <span className="table-label-dot" style={{ background: label.color }} />
                {label.name}
                {currentLabelIds.has(label.id) && <span style={{ marginLeft: 'auto' }}>✓</span>}
              </button>
            ))}
          </div>
        )}
      </div>
    </td>
  );
}

function DescriptionCell({ card, isAdmin, onUpdate }: {
  card: Card; isAdmin: boolean; onUpdate: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(card.description || '');
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => { setValue(card.description || ''); }, [card.description]);
  useEffect(() => { if (editing) textareaRef.current?.focus(); }, [editing]);

  const handleSave = async () => {
    if (value !== (card.description || '')) {
      try {
        await api.updateCard(card.id, { description: value });
        onUpdate();
      } catch {
        setValue(card.description || '');
      }
    }
    setEditing(false);
  };

  if (editing) {
    return (
      <td className="table-cell editing">
        <textarea
          ref={textareaRef}
          className="table-cell-textarea"
          value={value}
          onChange={e => setValue(e.target.value)}
          onBlur={handleSave}
          onKeyDown={e => { if (e.key === 'Escape') { setValue(card.description || ''); setEditing(false); } }}
        />
      </td>
    );
  }

  return (
    <td className={`table-cell${isAdmin ? ' editable' : ''}`} onClick={() => isAdmin && setEditing(true)}>
      {card.description ? (
        <span className="table-description-truncated">{card.description}</span>
      ) : (
        <span className="table-empty-cell">—</span>
      )}
    </td>
  );
}
