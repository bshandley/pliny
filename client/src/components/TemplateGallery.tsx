import { useState, useEffect } from 'react';
import { api } from '../api';
import { BoardTemplate, Board } from '../types';
import { useConfirm } from '../contexts/ConfirmContext';

export default function TemplateGallery() {
  const confirm = useConfirm();
  const [templates, setTemplates] = useState<BoardTemplate[]>([]);
  const [boards, setBoards] = useState<Board[]>([]);
  const [loading, setLoading] = useState(true);

  // "Use template" modal state
  const [usingTemplate, setUsingTemplate] = useState<BoardTemplate | null>(null);
  const [newBoardName, setNewBoardName] = useState('');
  const [newBoardDesc, setNewBoardDesc] = useState('');

  // "Save as template" modal state
  const [showSaveModal, setShowSaveModal] = useState(false);
  const [saveBoardId, setSaveBoardId] = useState('');
  const [saveTemplateName, setSaveTemplateName] = useState('');
  const [saveTemplateDesc, setSaveTemplateDesc] = useState('');

  const [error, setError] = useState('');

  useEffect(() => {
    loadTemplates();
    loadBoards();
  }, []);

  const loadTemplates = async () => {
    try {
      const data = await api.getTemplates();
      setTemplates(data);
    } catch (err) {
      console.error('Failed to load templates:', err);
    } finally {
      setLoading(false);
    }
  };

  const loadBoards = async () => {
    try {
      const data = await api.getBoards();
      setBoards(data.filter((b: Board) => !b.archived));
    } catch (err) {
      console.error('Failed to load boards:', err);
    }
  };

  const handleUseTemplate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!usingTemplate) return;
    setError('');
    try {
      await api.useTemplate(usingTemplate.id, newBoardName, newBoardDesc);
      setUsingTemplate(null);
      setNewBoardName('');
      setNewBoardDesc('');
      window.location.href = '/';
    } catch (err: any) {
      setError(err.message || 'Failed to create board from template');
    }
  };

  const handleSaveAsTemplate = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    try {
      await api.createTemplateFromBoard(saveBoardId, saveTemplateName, saveTemplateDesc);
      setShowSaveModal(false);
      setSaveBoardId('');
      setSaveTemplateName('');
      setSaveTemplateDesc('');
      loadTemplates();
    } catch (err: any) {
      setError(err.message || 'Failed to save template');
    }
  };

  const handleDeleteTemplate = async (tpl: BoardTemplate) => {
    if (!await confirm(`Delete template "${tpl.name}"? This cannot be undone.`, { confirmLabel: 'Delete' })) return;
    try {
      await api.deleteTemplate(tpl.id);
      loadTemplates();
    } catch (err: any) {
      alert(err.message || 'Failed to delete template');
    }
  };

  if (loading) {
    return <div className="loading"><div className="spinner"></div></div>;
  }

  return (
    <div className="template-gallery">
      <div className="panel-header">
        <h2>Templates</h2>
        <button onClick={() => { setShowSaveModal(true); setError(''); }} className="btn-primary btn-sm">
          + Save Board as Template
        </button>
      </div>

      {templates.length === 0 ? (
        <div className="empty-state"><p>No templates yet.</p></div>
      ) : (
        <div className="templates-grid">
          {templates.map(tpl => (
            <div key={tpl.id} className="template-card">
              <div className="template-card-preview">
                {(tpl.data?.columns || []).map((col, i) => (
                  <div key={i} className="template-col-preview">
                    <div className="template-col-name">{col.name}</div>
                    {(col.cards || []).slice(0, 3).map((_, j) => (
                      <div key={j} className="template-card-line" />
                    ))}
                  </div>
                ))}
              </div>
              <div className="template-card-body">
                <div className="template-card-header">
                  <h3>{tpl.name}</h3>
                  {tpl.is_builtin && <span className="template-badge">Built-in</span>}
                </div>
                {tpl.description && <p className="template-desc">{tpl.description}</p>}
                <div className="template-meta">
                  {tpl.column_count} columns · {tpl.card_count} cards
                </div>
                <div className="template-actions">
                  <button
                    className="btn-primary btn-sm"
                    onClick={() => { setUsingTemplate(tpl); setNewBoardName(''); setNewBoardDesc(''); setError(''); }}
                  >
                    Use Template
                  </button>
                  {!tpl.is_builtin && (
                    <button
                      className="btn-danger btn-sm"
                      onClick={() => handleDeleteTemplate(tpl)}
                    >
                      Delete
                    </button>
                  )}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Use Template Modal */}
      {usingTemplate && (
        <div className="modal-overlay" onClick={() => setUsingTemplate(null)}>
          <div className="modal" onClick={e => e.stopPropagation()}>
            <h3>Create Board from "{usingTemplate.name}"</h3>
            <form onSubmit={handleUseTemplate}>
              <div className="form-group">
                <label htmlFor="tpl-board-name">Board Name</label>
                <input
                  id="tpl-board-name"
                  type="text"
                  value={newBoardName}
                  onChange={e => setNewBoardName(e.target.value)}
                  required
                  maxLength={255}
                  autoFocus
                />
              </div>
              <div className="form-group">
                <label htmlFor="tpl-board-desc">Description (optional)</label>
                <textarea
                  id="tpl-board-desc"
                  value={newBoardDesc}
                  onChange={e => setNewBoardDesc(e.target.value)}
                  maxLength={10000}
                  rows={3}
                />
              </div>
              {error && <div className="error">{error}</div>}
              <div className="modal-actions">
                <button type="button" className="btn-secondary" onClick={() => setUsingTemplate(null)}>Cancel</button>
                <button type="submit" className="btn-primary">Create Board</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Save Board as Template Modal */}
      {showSaveModal && (
        <div className="modal-overlay" onClick={() => setShowSaveModal(false)}>
          <div className="modal" onClick={e => e.stopPropagation()}>
            <h3>Save Board as Template</h3>
            <form onSubmit={handleSaveAsTemplate}>
              <div className="form-group">
                <label htmlFor="save-board-select">Board</label>
                <select
                  id="save-board-select"
                  value={saveBoardId}
                  onChange={e => {
                    setSaveBoardId(e.target.value);
                    if (!saveTemplateName) {
                      const board = boards.find(b => b.id === e.target.value);
                      if (board) setSaveTemplateName(board.name + ' Template');
                    }
                  }}
                  required
                >
                  <option value="">Select a board...</option>
                  {boards.map(b => (
                    <option key={b.id} value={b.id}>{b.name}</option>
                  ))}
                </select>
              </div>
              <div className="form-group">
                <label htmlFor="save-tpl-name">Template Name</label>
                <input
                  id="save-tpl-name"
                  type="text"
                  value={saveTemplateName}
                  onChange={e => setSaveTemplateName(e.target.value)}
                  required
                  maxLength={255}
                />
              </div>
              <div className="form-group">
                <label htmlFor="save-tpl-desc">Description (optional)</label>
                <textarea
                  id="save-tpl-desc"
                  value={saveTemplateDesc}
                  onChange={e => setSaveTemplateDesc(e.target.value)}
                  maxLength={10000}
                  rows={3}
                />
              </div>
              {error && <div className="error">{error}</div>}
              <div className="modal-actions">
                <button type="button" className="btn-secondary" onClick={() => setShowSaveModal(false)}>Cancel</button>
                <button type="submit" className="btn-primary">Save Template</button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
