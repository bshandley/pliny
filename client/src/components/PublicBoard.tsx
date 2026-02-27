import { useState, useEffect } from 'react';
import { api } from '../api';

interface PublicColumn {
  id: string;
  name: string;
  position: number;
  cards: PublicCard[];
}

interface PublicCard {
  id: string;
  title: string;
  description: string;
  due_date: string | null;
  start_date: string | null;
  position: number;
  assignees: { display_name: string | null; username: string | null }[];
  labels: { name: string; color: string }[];
}

interface PublicBoardData {
  name: string;
  description: string;
  columns: PublicColumn[];
}

interface PublicBoardProps {
  token: string;
}

export default function PublicBoard({ token }: PublicBoardProps) {
  const [board, setBoard] = useState<PublicBoardData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  useEffect(() => {
    const loadBoard = async () => {
      try {
        const data = await api.getPublicBoard(token);
        setBoard(data);
      } catch {
        setError(true);
      } finally {
        setLoading(false);
      }
    };
    loadBoard();
  }, [token]);

  if (loading) {
    return (
      <div className="public-board">
        <div className="loading">
          <div className="spinner"></div>
          <p>Loading...</p>
        </div>
      </div>
    );
  }

  if (error || !board) {
    return (
      <div className="public-board-not-found">
        <h2>Board not found</h2>
        <p>This board may have been removed or the link is invalid.</p>
        <a href="/">Go to Pliny</a>
      </div>
    );
  }

  return (
    <div className="public-board">
      <div className="public-board-header">
        <h1>{board.name}</h1>
        <a href="/">View in Pliny</a>
      </div>

      <div className="public-board-columns">
        {board.columns.map(column => (
          <div key={column.id} className="public-board-column">
            <div className="public-board-column-header">
              {column.name}
              <span className="card-count">{column.cards.length}</span>
            </div>
            <div className="public-board-cards">
              {column.cards.map(card => (
                <div key={card.id} className="public-card">
                  {card.labels.length > 0 && (
                    <div className="public-card-labels">
                      {card.labels.map((label, i) => (
                        <span key={i} className="public-card-label" style={{ background: label.color }}>
                          {label.name}
                        </span>
                      ))}
                    </div>
                  )}
                  <p className="public-card-title">{card.title}</p>
                  {card.description && (
                    <p className="public-card-description">{card.description}</p>
                  )}
                  <div className="public-card-meta">
                    {card.due_date && (
                      <span>Due: {new Date(card.due_date).toLocaleDateString()}</span>
                    )}
                    {card.assignees.length > 0 && (
                      <div className="public-card-assignees">
                        {card.assignees.map((a, i) => (
                          <span key={i} className="public-card-assignee">
                            {a.display_name || a.username}
                          </span>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
