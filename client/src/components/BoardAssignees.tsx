import { useState, useEffect } from 'react';
import { api } from '../api';
import { useConfirm } from '../contexts/ConfirmContext';

interface BoardAssigneesProps {
  boardId: string;
  onClose: () => void;
  onAssigneeChange?: () => void;
}

interface Assignee {
  id: string;
  name: string;
  created_at: string;
}

export default function BoardAssignees({ boardId, onClose, onAssigneeChange }: BoardAssigneesProps) {
  const confirm = useConfirm();
  const [assignees, setAssignees] = useState<Assignee[]>([]);
  const [loading, setLoading] = useState(true);
  const [newName, setNewName] = useState('');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingName, setEditingName] = useState('');

  useEffect(() => {
    loadAssignees();
  }, [boardId]);

  const loadAssignees = async () => {
    try {
      const data = await api.getBoardAssignees(boardId);
      setAssignees(data);
    } catch (err) {
      console.error('Failed to load assignees:', err);
    } finally {
      setLoading(false);
    }
  };

  const handleAdd = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newName.trim()) return;

    try {
      await api.addBoardAssignee(boardId, newName.trim());
      setNewName('');
      loadAssignees();
    } catch (err: any) {
      alert(err.message || 'Failed to add assignee');
    }
  };

  const handleRename = async (id: string, originalName: string) => {
    const trimmed = editingName.trim();
    setEditingId(null);
    if (!trimmed || trimmed === originalName) return;

    try {
      await api.renameBoardAssignee(boardId, id, trimmed);
      loadAssignees();
      onAssigneeChange?.();
    } catch (err: any) {
      alert(err.message || 'Failed to rename assignee');
    }
  };

  const handleDelete = async (id: string, name: string) => {
    if (!await confirm(`Remove "${name}" from assignees?`, { confirmLabel: 'Remove' })) return;

    try {
      await api.deleteBoardAssignee(boardId, id);
      loadAssignees();
      onAssigneeChange?.(); // Reload board to reflect card changes
    } catch (err: any) {
      alert(err.message || 'Failed to delete assignee');
    }
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal modal-wide" onClick={(e) => e.stopPropagation()}>
        <h2>Manage Assignees</h2>
        <p className="modal-subtitle">
          Names added here can be assigned to cards using @ mentions.
        </p>

        {loading ? (
          <div className="loading-inline"><div className="spinner"></div></div>
        ) : (
          <>
            <form onSubmit={handleAdd} className="add-assignee-form">
              <input
                type="text"
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                placeholder="Enter name..."
                className="assignee-input"
                autoFocus
                maxLength={100}
              />
              <button type="submit" className="btn-primary btn-sm" disabled={!newName.trim()}>
                Add
              </button>
            </form>

            <div className="assignees-list">
              {assignees.length === 0 ? (
                <p className="empty-assignees">No assignees yet. Add names that can be assigned to cards.</p>
              ) : (
                assignees.map((assignee) => (
                  <div key={assignee.id} className="assignee-item">
                    {editingId === assignee.id ? (
                      <input
                        type="text"
                        value={editingName}
                        onChange={(e) => setEditingName(e.target.value)}
                        onBlur={() => handleRename(assignee.id, assignee.name)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') handleRename(assignee.id, assignee.name);
                          if (e.key === 'Escape') setEditingId(null);
                        }}
                        className="assignee-name assignee-rename-input"
                        autoFocus
                        maxLength={100}
                      />
                    ) : (
                      <span
                        className="assignee-name assignee-name-editable"
                        onClick={() => { setEditingId(assignee.id); setEditingName(assignee.name); }}
                        title="Click to rename"
                      >
                        {assignee.name}
                      </span>
                    )}
                    <button
                      onClick={() => handleDelete(assignee.id, assignee.name)}
                      className="btn-sm btn-delete-assignee"
                      title="Remove assignee"
                    >
                      ×
                    </button>
                  </div>
                ))
              )}
            </div>
          </>
        )}

        <div className="modal-actions">
          <button onClick={onClose} className="btn-secondary">
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
