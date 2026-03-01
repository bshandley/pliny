import { useState, useEffect } from 'react';
import { api } from '../api';
import { SharedBoard } from '../types';
import { useConfirm } from '../contexts/ConfirmContext';

export default function SharedBoards() {
  const confirm = useConfirm();
  const [boards, setBoards] = useState<SharedBoard[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    loadSharedBoards();
  }, []);

  const loadSharedBoards = async () => {
    try {
      const data = await api.getSharedBoards();
      setBoards(data);
    } catch (err: any) {
      setError(err.message || 'Failed to load shared boards');
    } finally {
      setLoading(false);
    }
  };

  const handleRevoke = async (board: SharedBoard) => {
    const confirmed = await confirm(
      `Remove public link for '${board.name}'? Anyone with the link will lose access.`
    );
    if (!confirmed) return;

    // Optimistic removal
    setBoards(prev => prev.filter(b => b.id !== board.id));

    try {
      await api.revokePublicLink(board.id);
    } catch (err: any) {
      // Restore on error
      setBoards(prev => [...prev, board].sort(
        (a, b) => new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime()
      ));
      setError(err.message || 'Failed to revoke link');
    }
  };

  const getPublicUrl = (token: string) =>
    `${window.location.origin}/public/${token}`;

  if (loading) {
    return (
      <div className="shared-boards-page">
        <div className="panel-header">
          <h2>Sharing</h2>
        </div>
        <div className="shared-boards-list">
          <div className="shared-boards-loading">Loading shared boards...</div>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="shared-boards-page">
        <div className="panel-header">
          <h2>Sharing</h2>
        </div>
        <div className="shared-boards-list">
          <div className="shared-boards-error">{error}</div>
        </div>
      </div>
    );
  }

  if (boards.length === 0) {
    return (
      <div className="shared-boards-page">
        <div className="panel-header">
          <h2>Sharing</h2>
        </div>
        <div className="shared-boards-empty">
          <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
            <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
            <path d="M7 11V7a5 5 0 0 1 10 0v4" />
          </svg>
          <p>No boards are publicly shared.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="shared-boards-page">
      <div className="panel-header">
        <h2>Sharing</h2>
      </div>
      <div className="shared-boards-list">
        {boards.map(board => (
          <div key={board.id} className="shared-board-row">
            <div className="shared-board-info">
              <span className="shared-board-name">{board.name}</span>
              <a
                className="shared-board-url"
                href={getPublicUrl(board.public_token)}
                target="_blank"
                rel="noopener noreferrer"
                title={getPublicUrl(board.public_token)}
              >
                {getPublicUrl(board.public_token)}
              </a>
            </div>
            <button
              className="btn btn-sm btn-revoke"
              onClick={() => handleRevoke(board)}
            >
              Revoke
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}
