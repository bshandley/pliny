import { useState, useRef, useEffect } from 'react';
import { Column, Label, BoardMember } from '../types';

interface BulkActionToolbarProps {
  selectedCount: number;
  totalVisible: number;
  columns: Column[];
  boardLabels: Label[];
  boardMembers: BoardMember[];
  onMoveToColumn: (columnId: string) => void;
  onAssignMember: (member: BoardMember) => void;
  onAssignLabel: (labelId: string) => void;
  onArchive: () => void;
  onDelete: () => void;
  onSelectAll: () => void;
  onClearSelection: () => void;
  allSelected: boolean;
}

export default function BulkActionToolbar({
  selectedCount,
  totalVisible,
  columns,
  boardLabels,
  boardMembers,
  onMoveToColumn,
  onAssignMember,
  onAssignLabel,
  onArchive,
  onDelete,
  onSelectAll,
  onClearSelection,
  allSelected,
}: BulkActionToolbarProps) {
  const [openDropdown, setOpenDropdown] = useState<'move' | 'assign' | 'label' | null>(null);
  const toolbarRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (toolbarRef.current && !toolbarRef.current.contains(e.target as Node)) {
        setOpenDropdown(null);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  return (
    <div className="bulk-action-toolbar" ref={toolbarRef}>
      <div className="bulk-toolbar-left">
        <label className="bulk-select-all">
          <input
            type="checkbox"
            checked={allSelected}
            onChange={() => allSelected ? onClearSelection() : onSelectAll()}
          />
          <span>{selectedCount} selected</span>
        </label>
      </div>

      <div className="bulk-toolbar-actions">
        {/* Move to column */}
        <div className="bulk-action-group">
          <button
            className="btn-secondary btn-sm"
            onClick={() => setOpenDropdown(openDropdown === 'move' ? null : 'move')}
          >
            Move to...
          </button>
          {openDropdown === 'move' && (
            <div className="bulk-dropdown bulk-dropdown-up">
              {columns.map(col => (
                <button key={col.id} onClick={() => { onMoveToColumn(col.id); setOpenDropdown(null); }}>
                  {col.name}
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Assign member */}
        <div className="bulk-action-group">
          <button
            className="btn-secondary btn-sm"
            onClick={() => setOpenDropdown(openDropdown === 'assign' ? null : 'assign')}
          >
            Assign...
          </button>
          {openDropdown === 'assign' && (
            <div className="bulk-dropdown bulk-dropdown-up">
              {boardMembers.map(member => (
                <button key={member.id} onClick={() => { onAssignMember(member); setOpenDropdown(null); }}>
                  {member.username}
                </button>
              ))}
              {boardMembers.length === 0 && (
                <div className="bulk-dropdown-empty">No board members</div>
              )}
            </div>
          )}
        </div>

        {/* Assign label */}
        <div className="bulk-action-group">
          <button
            className="btn-secondary btn-sm"
            onClick={() => setOpenDropdown(openDropdown === 'label' ? null : 'label')}
          >
            Label...
          </button>
          {openDropdown === 'label' && (
            <div className="bulk-dropdown bulk-dropdown-up">
              {boardLabels.map(label => (
                <button key={label.id} onClick={() => { onAssignLabel(label.id); setOpenDropdown(null); }}>
                  <span className="bulk-label-dot" style={{ background: label.color }} />
                  {label.name}
                </button>
              ))}
              {boardLabels.length === 0 && (
                <div className="bulk-dropdown-empty">No labels defined</div>
              )}
            </div>
          )}
        </div>

        {/* Archive */}
        <button className="btn-secondary btn-sm" onClick={onArchive}>
          Archive
        </button>

        {/* Delete */}
        <button className="btn-danger btn-sm" onClick={onDelete}>
          Delete
        </button>
      </div>

      <button className="bulk-toolbar-close" onClick={onClearSelection} aria-label="Clear selection">
        &times;
      </button>
    </div>
  );
}
