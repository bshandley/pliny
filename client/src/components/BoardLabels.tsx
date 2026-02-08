import { useState, useEffect } from 'react';
import { api } from '../api';
import { Label } from '../types';
import { useConfirm } from '../contexts/ConfirmContext';

const PRESET_COLORS = [
  '#ef4444', '#f97316', '#eab308', '#22c55e',
  '#3b82f6', '#8b5cf6', '#ec4899', '#6b7280',
];

interface BoardLabelsProps {
  boardId: string;
  onClose: () => void;
}

export default function BoardLabels({ boardId, onClose }: BoardLabelsProps) {
  const confirm = useConfirm();
  const [labels, setLabels] = useState<Label[]>([]);
  const [loading, setLoading] = useState(true);
  const [newName, setNewName] = useState('');
  const [newColor, setNewColor] = useState(PRESET_COLORS[4]);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingName, setEditingName] = useState('');
  const [editingColor, setEditingColor] = useState('');

  useEffect(() => {
    loadLabels();
  }, [boardId]);

  const loadLabels = async () => {
    try {
      const data = await api.getBoardLabels(boardId);
      setLabels(data);
    } catch (err) {
      console.error('Failed to load labels:', err);
    } finally {
      setLoading(false);
    }
  };

  const handleAdd = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newName.trim()) return;
    try {
      await api.createLabel(boardId, newName.trim(), newColor);
      setNewName('');
      setNewColor(PRESET_COLORS[4]);
      loadLabels();
    } catch (err: any) {
      alert(err.message || 'Failed to create label');
    }
  };

  const handleSaveLabel = async (label: Label, name?: string, color?: string) => {
    const newName = (name ?? editingName).trim();
    const newColor = color ?? editingColor;
    if (!color) setEditingId(null);
    if (!newName || (newName === label.name && newColor === label.color)) return;

    try {
      await api.updateLabel(label.id, newName, newColor);
      loadLabels();
    } catch (err: any) {
      alert(err.message || 'Failed to update label');
    }
  };

  const handleColorChange = async (label: Label, color: string) => {
    setEditingColor(color);
    await handleSaveLabel(label, editingName, color);
  };

  const handleDelete = async (id: string, name: string) => {
    if (!await confirm(`Delete label "${name}"?`, { confirmLabel: 'Delete' })) return;
    try {
      await api.deleteLabel(id);
      loadLabels();
    } catch (err: any) {
      alert(err.message || 'Failed to delete label');
    }
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal modal-wide" onClick={(e) => e.stopPropagation()}>
        <h2>Manage Labels</h2>
        <p className="modal-subtitle">Create color-coded labels to categorize cards.</p>

        {loading ? (
          <div className="loading-inline"><div className="spinner"></div></div>
        ) : (
          <>
            <form onSubmit={handleAdd} className="label-form">
              <input
                type="text"
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                placeholder="Label name..."
                className="label-name-input"
                autoFocus
              />
              <div className="color-picker">
                {PRESET_COLORS.map((color) => (
                  <button
                    key={color}
                    type="button"
                    className={`color-swatch ${newColor === color ? 'selected' : ''}`}
                    style={{ background: color }}
                    onClick={() => setNewColor(color)}
                    aria-label={`Color ${color}`}
                  />
                ))}
              </div>
              <button type="submit" className="btn-primary btn-sm" disabled={!newName.trim()}>
                Add
              </button>
            </form>

            <div className="labels-list">
              {labels.length === 0 ? (
                <p className="empty-assignees">No labels yet.</p>
              ) : (
                labels.map((label) => (
                  <div key={label.id} className={`label-item ${editingId === label.id ? 'label-item-editing' : ''}`}>
                    {editingId === label.id ? (
                      <div className="label-edit-row">
                        <input
                          type="text"
                          value={editingName}
                          onChange={(e) => setEditingName(e.target.value)}
                          onBlur={() => handleSaveLabel(label)}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') handleSaveLabel(label);
                            if (e.key === 'Escape') setEditingId(null);
                          }}
                          className="label-rename-input"
                          style={{ borderColor: editingColor }}
                          autoFocus
                        />
                        <div className="color-picker color-picker-inline">
                          {PRESET_COLORS.map((color) => (
                            <button
                              key={color}
                              type="button"
                              className={`color-swatch ${editingColor === color ? 'selected' : ''}`}
                              style={{ background: color }}
                              onMouseDown={(e) => e.preventDefault()}
                              onClick={() => handleColorChange(label, color)}
                              aria-label={`Color ${color}`}
                            />
                          ))}
                        </div>
                      </div>
                    ) : (
                      <span
                        className="label-pill label-pill-editable"
                        style={{ background: label.color }}
                        onClick={() => { setEditingId(label.id); setEditingName(label.name); setEditingColor(label.color); }}
                        title="Click to edit"
                      >
                        {label.name}
                      </span>
                    )}
                    <button
                      onClick={() => handleDelete(label.id, label.name)}
                      className="btn-sm btn-delete-assignee"
                      title="Delete label"
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
          <button onClick={onClose} className="btn-secondary">Close</button>
        </div>
      </div>
    </div>
  );
}
