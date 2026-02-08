import { useState, useEffect } from 'react';
import { api } from '../api';
import { Board, User } from '../types';

interface BoardListProps {
  onSelectBoard: (boardId: string, boardName: string) => void;
  onLogout: () => void;
  onGoToUsers: () => void;
  user: User | null;
}

export default function BoardList({ onSelectBoard, onLogout, onGoToUsers, user }: BoardListProps) {
  const [boards, setBoards] = useState<Board[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [newBoardName, setNewBoardName] = useState('');
  const [newBoardDesc, setNewBoardDesc] = useState('');

  const isAdmin = user?.role === 'ADMIN';

  useEffect(() => {
    loadBoards();
  }, []);

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

  if (loading) {
    return <div className="loading"><div className="spinner"></div></div>;
  }

  return (
    <div className="board-list-container">
      <header className="board-list-header">
        <h1>Wiz Kanban Boards</h1>
        <div className="header-actions">
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
        {boards.length === 0 ? (
          <div className="empty-state">
            <p>No boards yet.</p>
            {isAdmin && <p>Create your first board to get started!</p>}
            {!isAdmin && <p>Ask an admin to add you to a board.</p>}
          </div>
        ) : (
          boards.map((board) => (
            <div
              key={board.id}
              className="board-card"
              onClick={() => onSelectBoard(board.id, board.name)}
            >
              <h3>{board.name}</h3>
              {board.description && <p>{board.description}</p>}
              <div className="board-meta">
                Created {new Date(board.created_at).toLocaleDateString()}
              </div>
            </div>
          ))
        )}
      </div>

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
                />
              </div>
              <div className="form-group">
                <label htmlFor="board-desc">Description (optional)</label>
                <textarea
                  id="board-desc"
                  value={newBoardDesc}
                  onChange={(e) => setNewBoardDesc(e.target.value)}
                  rows={3}
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
    </div>
  );
}
