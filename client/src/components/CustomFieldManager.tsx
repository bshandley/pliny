import { useState } from 'react';
import { CustomField } from '../types';
import { api } from '../api';
import { useConfirm } from '../contexts/ConfirmContext';

const FIELD_TYPES = [
  { value: 'text', label: 'Text' },
  { value: 'number', label: 'Number' },
  { value: 'date', label: 'Date' },
  { value: 'dropdown', label: 'Dropdown' },
  { value: 'checkbox', label: 'Checkbox' },
] as const;

interface CustomFieldManagerProps {
  boardId: string;
  fields: CustomField[];
  onClose: () => void;
  onFieldsChanged: () => void;
}

export default function CustomFieldManager({ boardId, fields, onClose, onFieldsChanged }: CustomFieldManagerProps) {
  const confirm = useConfirm();
  const [newName, setNewName] = useState('');
  const [newType, setNewType] = useState<string>('text');
  const [newOptions, setNewOptions] = useState<string[]>(['']);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingName, setEditingName] = useState('');
  const [editingOptions, setEditingOptions] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);

  const handleAdd = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newName.trim() || saving) return;
    const opts = newType === 'dropdown'
      ? newOptions.map(o => o.trim()).filter(Boolean)
      : undefined;
    if (newType === 'dropdown' && (!opts || opts.length === 0)) return;

    setSaving(true);
    try {
      await api.createCustomField(boardId, {
        name: newName.trim(),
        field_type: newType,
        options: opts,
      });
      setNewName('');
      setNewType('text');
      setNewOptions(['']);
      onFieldsChanged();
    } catch (err: any) {
      alert(err.message || 'Failed to create field');
    } finally {
      setSaving(false);
    }
  };

  const handleSaveEdit = async (field: CustomField) => {
    const trimmed = editingName.trim();
    if (!trimmed) {
      setEditingId(null);
      return;
    }
    const opts = field.field_type === 'dropdown'
      ? editingOptions.map(o => o.trim()).filter(Boolean)
      : undefined;

    try {
      await api.updateCustomField(field.id, {
        name: trimmed,
        ...(opts !== undefined ? { options: opts } : {}),
      });
      setEditingId(null);
      onFieldsChanged();
    } catch (err: any) {
      alert(err.message || 'Failed to update field');
    }
  };

  const handleToggleShowOnCard = async (field: CustomField) => {
    try {
      await api.updateCustomField(field.id, { show_on_card: !field.show_on_card });
      onFieldsChanged();
    } catch (err: any) {
      alert(err.message || 'Failed to update field');
    }
  };

  const handleDelete = async (field: CustomField) => {
    if (!await confirm(`Delete field "${field.name}"? All card values for this field will be removed.`, { confirmLabel: 'Delete' })) return;
    try {
      await api.deleteCustomField(field.id);
      onFieldsChanged();
    } catch (err: any) {
      alert(err.message || 'Failed to delete field');
    }
  };

  const startEdit = (field: CustomField) => {
    setEditingId(field.id);
    setEditingName(field.name);
    setEditingOptions(field.field_type === 'dropdown' && field.options ? [...field.options] : []);
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal modal-wide" onClick={(e) => e.stopPropagation()}>
        <h2>Custom Fields</h2>
        <p className="modal-subtitle">Define custom metadata fields for cards on this board.</p>

        <form onSubmit={handleAdd} className="field-add-form">
          <input
            type="text"
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            placeholder="Field name..."
            className="field-add-name"
            maxLength={100}
            autoFocus
          />
          <select
            value={newType}
            onChange={(e) => { setNewType(e.target.value); setNewOptions(['']); }}
            className="field-add-type"
          >
            {FIELD_TYPES.map(t => (
              <option key={t.value} value={t.value}>{t.label}</option>
            ))}
          </select>
          <button type="submit" className="btn-primary btn-sm" disabled={!newName.trim() || saving}>
            Add
          </button>
        </form>

        {newType === 'dropdown' && (
          <div className="field-options-editor">
            <span className="field-options-label">Options:</span>
            {newOptions.map((opt, i) => (
              <div key={i} className="field-option-row">
                <input
                  type="text"
                  value={opt}
                  onChange={(e) => {
                    const updated = [...newOptions];
                    updated[i] = e.target.value;
                    setNewOptions(updated);
                  }}
                  placeholder={`Option ${i + 1}`}
                  className="field-option-input"
                  maxLength={100}
                />
                {newOptions.length > 1 && (
                  <button
                    type="button"
                    className="btn-icon btn-sm field-option-remove"
                    onClick={() => setNewOptions(newOptions.filter((_, j) => j !== i))}
                  >
                    ×
                  </button>
                )}
              </div>
            ))}
            <button
              type="button"
              className="btn-secondary btn-sm field-option-add"
              onClick={() => setNewOptions([...newOptions, ''])}
            >
              + Add option
            </button>
          </div>
        )}

        <div className="field-manager-list">
          {fields.length === 0 ? (
            <p className="empty-assignees">No custom fields yet.</p>
          ) : (
            fields.map((field) => (
              <div key={field.id} className="field-row">
                {editingId === field.id ? (
                  <div className="field-edit-block">
                    <div className="field-edit-row">
                      <input
                        type="text"
                        value={editingName}
                        onChange={(e) => setEditingName(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') handleSaveEdit(field);
                          if (e.key === 'Escape') setEditingId(null);
                        }}
                        className="field-edit-input"
                        autoFocus
                        maxLength={100}
                      />
                      <span className="field-type-badge">{field.field_type}</span>
                      <button className="btn-primary btn-sm" onClick={() => handleSaveEdit(field)}>Save</button>
                      <button className="btn-secondary btn-sm" onClick={() => setEditingId(null)}>Cancel</button>
                    </div>
                    {field.field_type === 'dropdown' && (
                      <div className="field-options-editor">
                        <span className="field-options-label">Options:</span>
                        {editingOptions.map((opt, i) => (
                          <div key={i} className="field-option-row">
                            <input
                              type="text"
                              value={opt}
                              onChange={(e) => {
                                const updated = [...editingOptions];
                                updated[i] = e.target.value;
                                setEditingOptions(updated);
                              }}
                              placeholder={`Option ${i + 1}`}
                              className="field-option-input"
                              maxLength={100}
                            />
                            {editingOptions.length > 1 && (
                              <button
                                type="button"
                                className="btn-icon btn-sm field-option-remove"
                                onClick={() => setEditingOptions(editingOptions.filter((_, j) => j !== i))}
                              >
                                ×
                              </button>
                            )}
                          </div>
                        ))}
                        <button
                          type="button"
                          className="btn-secondary btn-sm field-option-add"
                          onClick={() => setEditingOptions([...editingOptions, ''])}
                        >
                          + Add option
                        </button>
                      </div>
                    )}
                  </div>
                ) : (
                  <>
                    <span className="field-name" onClick={() => startEdit(field)} title="Click to edit">
                      {field.name}
                    </span>
                    <span className="field-type-badge">{field.field_type}</span>
                    <button
                      className={`field-show-toggle${field.show_on_card ? ' active' : ''}`}
                      onClick={() => handleToggleShowOnCard(field)}
                      title={field.show_on_card ? 'Shown on card' : 'Hidden on card'}
                    >
                      {field.show_on_card ? 'On card' : 'Hidden'}
                    </button>
                    <button
                      onClick={() => handleDelete(field)}
                      className="btn-sm btn-delete-assignee"
                      title="Delete field"
                    >
                      ×
                    </button>
                  </>
                )}
              </div>
            ))
          )}
        </div>

        <div className="modal-actions">
          <button onClick={onClose} className="btn-secondary">Close</button>
        </div>
      </div>
    </div>
  );
}
