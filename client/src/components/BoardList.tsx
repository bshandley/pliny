import { useState, useEffect, useRef } from 'react';
import { api } from '../api';
import { Board, User } from '../types';
import { useConfirm } from '../contexts/ConfirmContext';
import PlankLogo from './PlankLogo';

interface BoardListProps {
  onSelectBoard: (boardId: string, boardName: string) => void;
  onLogout: () => void;
  onGoToUsers: () => void;
  user: User | null;
  notificationCount?: number;
  onGoToNotifications?: () => void;
}

export default function BoardList({ onSelectBoard, onLogout, onGoToUsers, user, notificationCount = 0, onGoToNotifications }: BoardListProps) {
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
  const menuRef = useRef<HTMLDivElement>(null);

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

  const activeBoards = boards.filter(b => !b.archived);
  const archivedBoards = boards.filter(b => b.archived);

  if (loading) {
    return <div className="loading"><div className="spinner"></div></div>;
  }

  return (
    <div className="board-list-container">
      <header className="board-list-header">
        <div className="board-list-logo">
          <PlankLogo size={28} />
          <h1>Plank</h1>
        </div>
        <div className="header-actions">
          {onGoToNotifications && (
            <button onClick={onGoToNotifications} className="btn-icon header-bell mobile-only" aria-label="Notifications">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/>
                <path d="M13.73 21a2 2 0 0 1-3.46 0"/>
              </svg>
              {notificationCount > 0 && <span className="notification-badge">{notificationCount > 9 ? '9+' : notificationCount}</span>}
            </button>
          )}
          {isAdmin && (
            <>
              <button onClick={onGoToUsers} className="btn-secondary">
                Users
              </button>
              <button onClick={() => setShowCreateModal(true)} className="btn-primary">
                + New Board
              </button>
            </>
          )}
          <button onClick={onLogout} className="btn-secondary">
            Logout
          </button>
        </div>
      </header>

      <div className="boards-grid">
        {activeBoards.length === 0 && archivedBoards.length === 0 ? (
          <div className="empty-state">
            <p>No boards yet.</p>
            {isAdmin && <p>Create your first board to get started!</p>}
            {!isAdmin && <p>Ask an admin to add you to a board.</p>}
          </div>
        ) : activeBoards.length === 0 ? (
          <div className="empty-state">
            <p>No active boards.</p>
          </div>
        ) : (
          activeBoards.map((board) => (
            <div
              key={board.id}
              className="board-card"
              onClick={() => onSelectBoard(board.id, board.name)}
            >
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
                      <button onClick={(e) => { e.stopPropagation(); handleArchiveBoard(board); }}>Archive</button>
                      <div className="kebab-divider" />
                      <button className="kebab-danger" onClick={(e) => { e.stopPropagation(); handleDeleteBoard(board); }}>Delete</button>
                    </div>
                  )}
                </div>
              )}
              <h3>{board.name}</h3>
              {board.description && <p>{board.description}</p>}
              <div className="board-meta">
                Created {new Date(board.created_at).toLocaleDateString()}
              </div>
            </div>
          ))
        )}
      </div>

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
    </div>
  );
}
