import { useState, useEffect, useRef } from 'react';
import { api } from '../api';
import { Board, User } from '../types';
import { useConfirm } from '../contexts/ConfirmContext';
import AppBar from './AppBar';
import TrelloImportModal from './TrelloImportModal';
import CSVBoardImportModal from './CSVBoardImportModal';

type SortOption = 'recent' | 'name' | 'created';

interface BoardListProps {
  onSelectBoard: (boardId: string, boardName: string) => void;
  onGoToUsers: () => void;
  user: User | null;
}

export default function BoardList({ onSelectBoard, onGoToUsers, user }: BoardListProps) {
  const [boards, setBoards] = useState<Board[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [newBoardName, setNewBoardName] = useState('');
  const [newBoardDesc, setNewBoardDesc] = useState('');
  const [openMenuId, setOpenMenuId] = useState<string | null>(null);
  const [editingBoard, setEditingBoard] = useState<Board | null>(null);
  const [editBoardName, setEditBoardName] = useState('');
  const [editBoardDesc, setEditBoardDesc] = useState('');
  const [showArchivedBoards, setShowArchivedBoards] = useState(false);
  const [savingBoard, setSavingBoard] = useState<Board | null>(null);
  const [saveTemplateName, setSaveTemplateName] = useState('');
  const [saveTemplateDesc, setSaveTemplateDesc] = useState('');
  const [showTrelloImport, setShowTrelloImport] = useState(false);
  const [showCSVBoardImport, setShowCSVBoardImport] = useState(false);
  const [showImportMenu, setShowImportMenu] = useState(false);
  const [sortBy, setSortBy] = useState<SortOption>(() => {
    return (localStorage.getItem('pliny-board-sort') as SortOption) || 'recent';
  });
  const menuRef = useRef<HTMLDivElement>(null);
  const importMenuRef = useRef<HTMLDivElement>(null);

  const confirm = useConfirm();
  const isAdmin = user?.role === 'ADMIN';

  useEffect(() => {
    loadBoards();
  }, []);

  // Close kebab menu on outside click
  useEffect(() => {
    if (!openMenuId) return;
    const handleClick = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setOpenMenuId(null);
      }
    };
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [openMenuId]);

  // Close import menu on outside click
  useEffect(() => {
    if (!showImportMenu) return;
    const handleClick = (e: MouseEvent) => {
      if (importMenuRef.current && !importMenuRef.current.contains(e.target as Node)) {
        setShowImportMenu(false);
      }
    };
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [showImportMenu]);

  const loadBoards = async () => {
    try {
      const data = await api.getBoards();
      setBoards(data);
    } catch (error) {
      console.error('Failed to load boards:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleCreateBoard = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await api.createBoard(newBoardName, newBoardDesc);
      setNewBoardName('');
      setNewBoardDesc('');
      setShowCreateModal(false);
      loadBoards();
    } catch (error: any) {
      alert('Failed to create board: ' + error.message);
    }
  };

  const handleEditBoard = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingBoard) return;
    try {
      await api.updateBoard(editingBoard.id, { name: editBoardName, description: editBoardDesc });
      setEditingBoard(null);
      setEditBoardName('');
      setEditBoardDesc('');
      loadBoards();
    } catch (error: any) {
      alert('Failed to update board: ' + error.message);
    }
  };

  const handleArchiveBoard = async (board: Board) => {
    setOpenMenuId(null);
    if (!await confirm(`Archive board "${board.name}"? It can be restored later.`, { confirmLabel: 'Archive' })) return;
    try {
      await api.updateBoard(board.id, { archived: true });
      loadBoards();
    } catch (error: any) {
      alert('Failed to archive board: ' + error.message);
    }
  };

  const handleRestoreBoard = async (board: Board) => {
    try {
      await api.updateBoard(board.id, { archived: false });
      loadBoards();
    } catch (error: any) {
      alert('Failed to restore board: ' + error.message);
    }
  };

  const handleDeleteBoard = async (board: Board) => {
    setOpenMenuId(null);
    if (!await confirm(`Permanently delete board "${board.name}" and all its data? This cannot be undone.`, { confirmLabel: 'Delete' })) return;
    try {
      await api.deleteBoard(board.id);
      loadBoards();
    } catch (error: any) {
      alert('Failed to delete board: ' + error.message);
    }
  };

  const handleSaveAsTemplate = (board: Board) => {
    setSavingBoard(board);
    setSaveTemplateName(board.name + ' Template');
    setSaveTemplateDesc('');
  };

  const handleConfirmSaveTemplate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!savingBoard) return;
    try {
      await api.createTemplateFromBoard(savingBoard.id, saveTemplateName, saveTemplateDesc);
      setSavingBoard(null);
      alert('Template saved!');
    } catch (err: any) {
      alert(err.message || 'Failed to save template');
    }
  };

  const handleToggleStar = async (e: React.MouseEvent, board: Board) => {
    e.stopPropagation();
    const newStarred = !board.is_starred;
    // Optimistic update
    setBoards(prev => prev.map(b => b.id === board.id ? { ...b, is_starred: newStarred } : b));
    try {
      if (newStarred) {
        await api.starBoard(board.id);
      } else {
        await api.unstarBoard(board.id);
      }
    } catch {
      // Revert on failure
      setBoards(prev => prev.map(b => b.id === board.id ? { ...b, is_starred: !newStarred } : b));
    }
  };

  const handleSortChange = (sort: SortOption) => {
    setSortBy(sort);
    localStorage.setItem('pliny-board-sort', sort);
  };

  const sortBoards = (list: Board[]): Board[] => {
    return [...list].sort((a, b) => {
      switch (sortBy) {
        case 'name':
          return a.name.localeCompare(b.name);
        case 'created':
          return new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
        case 'recent':
        default:
          return new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime();
      }
    });
  };

  const activeBoards = boards.filter(b => !b.archived);
  const archivedBoards = boards.filter(b => b.archived);
  const starredBoards = sortBoards(activeBoards.filter(b => b.is_starred));
  const unstarredBoards = sortBoards(activeBoards.filter(b => !b.is_starred));

  const renderBoardCard = (board: Board) => (
    <div
      key={board.id}
      className="board-card"
      onClick={() => onSelectBoard(board.id, board.name)}
    >
      <div className="board-card-actions">
        <button
          className={`btn-star${board.is_starred ? ' starred' : ''}`}
          onClick={(e) => handleToggleStar(e, board)}
          title={board.is_starred ? 'Unstar board' : 'Star board'}
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill={board.is_starred ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z"/>
          </svg>
        </button>
        {isAdmin && (
          <div className="board-card-menu" ref={openMenuId === board.id ? menuRef : undefined}>
            <button
              className="btn-kebab"
              onClick={(e) => { e.stopPropagation(); setOpenMenuId(openMenuId === board.id ? null : board.id); }}
              title="Board actions"
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><circle cx="12" cy="5" r="2"/><circle cx="12" cy="12" r="2"/><circle cx="12" cy="19" r="2"/></svg>
            </button>
            {openMenuId === board.id && (
              <div className="kebab-dropdown">
                <button onClick={(e) => {
                  e.stopPropagation();
                  setOpenMenuId(null);
                  setEditBoardName(board.name);
                  setEditBoardDesc(board.description || '');
                  setEditingBoard(board);
                }}>Edit Board</button>
                <button onClick={(e) => { e.stopPropagation(); setOpenMenuId(null); handleSaveAsTemplate(board); }}>Save as Template</button>
                <button onClick={(e) => { e.stopPropagation(); handleArchiveBoard(board); }}>Archive</button>
                <div className="kebab-divider" />
                <button className="kebab-danger" onClick={(e) => { e.stopPropagation(); handleDeleteBoard(board); }}>Delete</button>
              </div>
            )}
          </div>
        )}
      </div>
      <h3>{board.name}</h3>
      {board.description && <p>{board.description}</p>}
      <div className="board-meta">
        Created {new Date(board.created_at).toLocaleDateString()}
      </div>
    </div>
  );

  if (loading) {
    return <div className="loading"><div className="spinner"></div></div>;
  }

  return (
    <div className="board-list-container">
      <AppBar title="Pliny" showLogo>
        {isAdmin && (
          <>
            <button onClick={onGoToUsers} className="btn-secondary btn-sm btn-with-icon btn-admin">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>
              </svg>
              <span className="btn-label">Admin</span>
            </button>
            <div className="import-dropdown desktop-only" ref={importMenuRef}>
              <button
                onClick={() => setShowImportMenu(!showImportMenu)}
                className="btn-secondary btn-sm"
              >
                Import
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ marginLeft: '4px' }}>
                  <polyline points="6 9 12 15 18 9" />
                </svg>
              </button>
              {showImportMenu && (
                <div className="import-dropdown-menu">
                  <button onClick={() => { setShowImportMenu(false); setShowTrelloImport(true); }}>
                    Import from Trello
                  </button>
                  <button onClick={() => { setShowImportMenu(false); setShowCSVBoardImport(true); }}>
                    Import from CSV
                  </button>
                </div>
              )}
            </div>
            <button onClick={() => setShowCreateModal(true)} className="btn-primary btn-sm btn-new-board">
              <svg className="btn-new-board-icon" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>
              </svg>
              <span className="btn-label">New Board</span>
            </button>
          </>
        )}
      </AppBar>

      {activeBoards.length === 0 && archivedBoards.length === 0 ? (
        <div className="boards-grid">
          <div className="empty-state">
            <p>No boards yet.</p>
            {isAdmin && <p>Create your first board to get started!</p>}
            {!isAdmin && <p>Ask an admin to add you to a board.</p>}
          </div>
        </div>
      ) : activeBoards.length === 0 ? (
        <div className="boards-grid">
          <div className="empty-state">
            <p>No active boards.</p>
          </div>
        </div>
      ) : (
        <>
          {/* Sort Controls */}
          <div className="boards-sort-bar">
            <div className="boards-sort-tabs">
              <button
                className={`boards-sort-tab${sortBy === 'recent' ? ' active' : ''}`}
                onClick={() => handleSortChange('recent')}
              >Recent</button>
              <button
                className={`boards-sort-tab${sortBy === 'name' ? ' active' : ''}`}
                onClick={() => handleSortChange('name')}
              >Name</button>
              <button
                className={`boards-sort-tab${sortBy === 'created' ? ' active' : ''}`}
                onClick={() => handleSortChange('created')}
              >Created</button>
            </div>
            <select
              className="boards-sort-select"
              value={sortBy}
              onChange={(e) => handleSortChange(e.target.value as SortOption)}
            >
              <option value="recent">Recently active</option>
              <option value="name">Name</option>
              <option value="created">Date created</option>
            </select>
          </div>

          {/* Starred Boards Section */}
          {starredBoards.length > 0 && (
            <div className="starred-boards-section">
              <div className="starred-boards-header">
                <svg className="starred-header-icon" width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z"/></svg>
                Starred
              </div>
              <div className="boards-grid">
                {starredBoards.map((board) => renderBoardCard(board))}
              </div>
            </div>
          )}

          {/* Main Boards Grid */}
          <div className="boards-grid">
            {(starredBoards.length > 0 ? unstarredBoards : sortBoards(activeBoards)).map((board) => renderBoardCard(board))}
          </div>
        </>
      )}

      {/* Archived Boards Section */}
      {isAdmin && archivedBoards.length > 0 && (
        <div className="archived-boards-section">
          <button
            className="archived-boards-toggle"
            onClick={() => setShowArchivedBoards(!showArchivedBoards)}
          >
            <span className="section-toggle-icon">{showArchivedBoards ? '▾' : '▸'}</span>
            Archived Boards
            <span className="archived-count">{archivedBoards.length}</span>
          </button>
          {showArchivedBoards && (
            <div className="boards-grid archived-grid">
              {archivedBoards.map((board) => (
                <div key={board.id} className="board-card archived">
                  <h3>{board.name}</h3>
                  {board.description && <p>{board.description}</p>}
                  <div className="archive-actions">
                    <button onClick={() => handleRestoreBoard(board)} className="btn-primary btn-sm">Restore</button>
                    <button onClick={() => handleDeleteBoard(board)} className="btn-danger btn-sm">Delete</button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Create Board Modal */}
      {showCreateModal && (
        <div className="modal-overlay" onClick={() => setShowCreateModal(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h2>Create New Board</h2>
            <form onSubmit={handleCreateBoard}>
              <div className="form-group">
                <label htmlFor="board-name">Board Name</label>
                <input
                  type="text"
                  id="board-name"
                  value={newBoardName}
                  onChange={(e) => setNewBoardName(e.target.value)}
                  required
                  autoFocus
                  maxLength={255}
                />
              </div>
              <div className="form-group">
                <label htmlFor="board-desc">Description (optional)</label>
                <textarea
                  id="board-desc"
                  value={newBoardDesc}
                  onChange={(e) => setNewBoardDesc(e.target.value)}
                  rows={3}
                  maxLength={10000}
                />
              </div>
              <div className="modal-actions">
                <button type="button" onClick={() => setShowCreateModal(false)} className="btn-secondary">
                  Cancel
                </button>
                <button type="submit" className="btn-primary">
                  Create
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Edit Board Modal */}
      {editingBoard && (
        <div className="modal-overlay" onClick={() => setEditingBoard(null)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h2>Edit Board</h2>
            <form onSubmit={handleEditBoard}>
              <div className="form-group">
                <label htmlFor="edit-board-name">Board Name</label>
                <input
                  type="text"
                  id="edit-board-name"
                  value={editBoardName}
                  onChange={(e) => setEditBoardName(e.target.value)}
                  required
                  autoFocus
                  maxLength={255}
                />
              </div>
              <div className="form-group">
                <label htmlFor="edit-board-desc">Description (optional)</label>
                <textarea
                  id="edit-board-desc"
                  value={editBoardDesc}
                  onChange={(e) => setEditBoardDesc(e.target.value)}
                  rows={3}
                  maxLength={10000}
                />
              </div>
              <div className="modal-actions">
                <button type="button" onClick={() => setEditingBoard(null)} className="btn-secondary">
                  Cancel
                </button>
                <button type="submit" className="btn-primary">
                  Save
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Save as Template Modal */}
      {savingBoard && (
        <div className="modal-overlay" onClick={() => setSavingBoard(null)}>
          <div className="modal" onClick={e => e.stopPropagation()}>
            <h3>Save "{savingBoard.name}" as Template</h3>
            <form onSubmit={handleConfirmSaveTemplate}>
              <div className="form-group">
                <label htmlFor="save-tpl-name">Template Name</label>
                <input
                  id="save-tpl-name"
                  type="text"
                  value={saveTemplateName}
                  onChange={e => setSaveTemplateName(e.target.value)}
                  required
                  maxLength={255}
                  autoFocus
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
              <div className="modal-actions">
                <button type="button" className="btn-secondary" onClick={() => setSavingBoard(null)}>Cancel</button>
                <button type="submit" className="btn-primary">Save Template</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Trello Import Modal */}
      {showTrelloImport && (
        <TrelloImportModal
          onClose={() => setShowTrelloImport(false)}
          onImportComplete={loadBoards}
          onSelectBoard={onSelectBoard}
        />
      )}

      {/* CSV Board Import Modal */}
      {showCSVBoardImport && (
        <CSVBoardImportModal
          onClose={() => setShowCSVBoardImport(false)}
          onImportComplete={loadBoards}
          onSelectBoard={(boardId, boardName) => {
            setShowCSVBoardImport(false);
            onSelectBoard(boardId, boardName);
          }}
        />
      )}
    </div>
  );
}
