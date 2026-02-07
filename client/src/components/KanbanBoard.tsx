import { useState, useEffect } from 'react';
import { DragDropContext, Droppable, Draggable, DropResult } from 'react-beautiful-dnd';
import { io, Socket } from 'socket.io-client';
import { api } from '../api';
import { Board, Card } from '../types';
import KanbanCard from './KanbanCard';
import BoardMembers from './BoardMembers';
import BoardAssignees from './BoardAssignees';

interface KanbanBoardProps {
  boardId: string;
  onBack: () => void;
  onLogout: () => void;
  userRole: 'READ' | 'ADMIN';
}

export default function KanbanBoard({ boardId, onBack, onLogout, userRole }: KanbanBoardProps) {
  const [board, setBoard] = useState<Board | null>(null);
  const [loading, setLoading] = useState(true);
  const [socket, setSocket] = useState<Socket | null>(null);
  const [showNewColumn, setShowNewColumn] = useState(false);
  const [newColumnName, setNewColumnName] = useState('');
  const [showNewCard, setShowNewCard] = useState<string | null>(null);
  const [newCardTitle, setNewCardTitle] = useState('');
  const [showMembers, setShowMembers] = useState(false);
  const [showAssignees, setShowAssignees] = useState(false);

  const isAdmin = userRole === 'ADMIN';

  useEffect(() => {
    loadBoard();

    // Setup WebSocket
    const newSocket = io('/');
    newSocket.emit('join-board', boardId);

    newSocket.on('board-updated', () => {
      loadBoard();
    });

    setSocket(newSocket);

    return () => {
      newSocket.emit('leave-board', boardId);
      newSocket.disconnect();
    };
  }, [boardId]);

  const loadBoard = async () => {
    try {
      const data = await api.getBoard(boardId);
      setBoard(data);
    } catch (error) {
      console.error('Failed to load board:', error);
      alert('Failed to load board');
    } finally {
      setLoading(false);
    }
  };

  const handleDragEnd = async (result: DropResult) => {
    if (!isAdmin || !board) return;

    const { destination, source, type } = result;

    if (!destination) return;
    if (destination.droppableId === source.droppableId && destination.index === source.index) {
      return;
    }

    if (type === 'COLUMN') {
      // Reorder columns
      const newColumns = Array.from(board.columns || []);
      const [removed] = newColumns.splice(source.index, 1);
      newColumns.splice(destination.index, 0, removed);

      // Update positions
      const updates = newColumns.map((col, idx) => ({
        ...col,
        position: idx
      }));

      setBoard({ ...board, columns: updates });

      // Persist to server
      try {
        await Promise.all(
          updates.map(col => api.updateColumn(col.id, { position: col.position }))
        );
        socket?.emit('board-updated', boardId);
      } catch (error) {
        console.error('Failed to update columns:', error);
        loadBoard(); // Revert on error
      }
    } else {
      // Move card
      const sourceColumn = board.columns?.find(col => col.id === source.droppableId);
      const destColumn = board.columns?.find(col => col.id === destination.droppableId);

      if (!sourceColumn || !destColumn) return;

      if (source.droppableId === destination.droppableId) {
        // Same column reorder
        const newCards = Array.from(sourceColumn.cards || []);
        const [removed] = newCards.splice(source.index, 1);
        newCards.splice(destination.index, 0, removed);

        const updatedColumn = {
          ...sourceColumn,
          cards: newCards.map((card, idx) => ({ ...card, position: idx }))
        };

        const newColumns = board.columns?.map(col =>
          col.id === sourceColumn.id ? updatedColumn : col
        );

        setBoard({ ...board, columns: newColumns });

        // Persist
        try {
          await Promise.all(
            updatedColumn.cards!.map(card => api.updateCard(card.id, { position: card.position }))
          );
          socket?.emit('board-updated', boardId);
        } catch (error) {
          console.error('Failed to update cards:', error);
          loadBoard();
        }
      } else {
        // Move between columns
        const sourceCards = Array.from(sourceColumn.cards || []);
        const destCards = Array.from(destColumn.cards || []);
        const [removed] = sourceCards.splice(source.index, 1);

        removed.column_id = destColumn.id;
        destCards.splice(destination.index, 0, removed);

        const updatedSourceColumn = {
          ...sourceColumn,
          cards: sourceCards.map((card, idx) => ({ ...card, position: idx }))
        };

        const updatedDestColumn = {
          ...destColumn,
          cards: destCards.map((card, idx) => ({ ...card, position: idx, column_id: destColumn.id }))
        };

        const newColumns = board.columns?.map(col => {
          if (col.id === sourceColumn.id) return updatedSourceColumn;
          if (col.id === destColumn.id) return updatedDestColumn;
          return col;
        });

        setBoard({ ...board, columns: newColumns });

        // Persist
        try {
          await Promise.all([
            ...updatedSourceColumn.cards!.map(card => api.updateCard(card.id, { position: card.position })),
            ...updatedDestColumn.cards!.map(card =>
              api.updateCard(card.id, { position: card.position, column_id: destColumn.id })
            )
          ]);
          socket?.emit('board-updated', boardId);
        } catch (error) {
          console.error('Failed to move card:', error);
          loadBoard();
        }
      }
    }
  };

  const handleCreateColumn = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!board) return;

    try {
      const position = board.columns?.length || 0;
      await api.createColumn(boardId, newColumnName, position);
      setNewColumnName('');
      setShowNewColumn(false);
      await loadBoard(); // Wait for reload
      socket?.emit('board-updated', boardId);
    } catch (error: any) {
      alert('Failed to create column: ' + error.message);
    }
  };

  const handleCreateCard = async (e: React.FormEvent, columnId: string) => {
    e.preventDefault();
    const column = board?.columns?.find(col => col.id === columnId);
    if (!column) return;

    try {
      const position = column.cards?.length || 0;
      await api.createCard(columnId, newCardTitle, position);
      setNewCardTitle('');
      setShowNewCard(null);
      await loadBoard(); // Wait for reload
      socket?.emit('board-updated', boardId);
    } catch (error: any) {
      alert('Failed to create card: ' + error.message);
    }
  };

  const handleDeleteCard = async (cardId: string) => {
    if (!confirm('Delete this card?')) return;

    try {
      await api.deleteCard(cardId);
      await loadBoard(); // Wait for reload
      socket?.emit('board-updated', boardId);
    } catch (error: any) {
      alert('Failed to delete card: ' + error.message);
    }
  };

  const handleUpdateCard = async (cardId: string, updates: Partial<Card>) => {
    try {
      await api.updateCard(cardId, updates);
      await loadBoard(); // Wait for reload
      socket?.emit('board-updated', boardId);
    } catch (error: any) {
      alert('Failed to update card: ' + error.message);
    }
  };

  const handleDeleteColumn = async (columnId: string, columnName: string) => {
    if (!confirm(`Delete column "${columnName}" and all its cards?`)) return;

    try {
      await api.deleteColumn(columnId);
      await loadBoard(); // Wait for reload before continuing
      socket?.emit('board-updated', boardId);
    } catch (error: any) {
      alert('Failed to delete column: ' + error.message);
    }
  };

  if (loading) {
    return <div className="loading"><div className="spinner"></div></div>;
  }

  if (!board) {
    return <div>Board not found</div>;
  }

  return (
    <div className="kanban-container">
      <header className="kanban-header">
        <div className="header-left">
          <button onClick={onBack} className="btn-icon">←</button>
          <h1>{board.name}</h1>
        </div>
        <div className="header-actions">
          {isAdmin && (
            <>
              <button onClick={() => setShowMembers(true)} className="btn-secondary btn-sm">
                Members
              </button>
              <button onClick={() => setShowAssignees(true)} className="btn-secondary btn-sm">
                Assignees
              </button>
              <button onClick={() => setShowNewColumn(true)} className="btn-primary">
                + Column
              </button>
            </>
          )}
          <button onClick={onLogout} className="btn-secondary">
            Logout
          </button>
        </div>
      </header>

      <DragDropContext onDragEnd={handleDragEnd}>
        <Droppable droppableId="board" direction="horizontal" type="COLUMN" isDropDisabled={!isAdmin}>
          {(provided) => (
            <div className="columns-container" {...provided.droppableProps} ref={provided.innerRef}>
              {board.columns?.map((column, index) => (
                <Draggable key={column.id} draggableId={column.id} index={index} isDragDisabled={!isAdmin}>
                  {(provided) => (
                    <div
                      className="column"
                      ref={provided.innerRef}
                      {...provided.draggableProps}
                    >
                      <div className="column-header" {...provided.dragHandleProps}>
                        <h3>{column.name}</h3>
                        <div className="column-header-actions">
                          <span className="card-count">{column.cards?.length || 0}</span>
                          {isAdmin && (
                            <button
                              className="btn-icon btn-delete"
                              onClick={(e) => {
                                e.stopPropagation();
                                handleDeleteColumn(column.id, column.name);
                              }}
                              title="Delete column"
                            >
                              ×
                            </button>
                          )}
                        </div>
                      </div>

                      <Droppable droppableId={column.id} type="CARD" isDropDisabled={!isAdmin}>
                        {(provided) => (
                          <div className="cards-list" {...provided.droppableProps} ref={provided.innerRef}>
                            {column.cards?.map((card, cardIndex) => (
                              <Draggable key={card.id} draggableId={card.id} index={cardIndex} isDragDisabled={!isAdmin}>
                                {(provided) => (
                                  <div
                                    ref={provided.innerRef}
                                    {...provided.draggableProps}
                                    {...provided.dragHandleProps}
                                  >
                                    <KanbanCard
                                      card={card}
                                      canWrite={isAdmin}
                                      onDelete={() => handleDeleteCard(card.id)}
                                      onUpdate={(updates) => handleUpdateCard(card.id, updates)}
                                    />
                                  </div>
                                )}
                              </Draggable>
                            ))}
                            {provided.placeholder}
                          </div>
                        )}
                      </Droppable>

                      {isAdmin && (
                        showNewCard === column.id ? (
                          <form onSubmit={(e) => handleCreateCard(e, column.id)} className="new-card-form">
                            <input
                              type="text"
                              value={newCardTitle}
                              onChange={(e) => setNewCardTitle(e.target.value)}
                              placeholder="Card title..."
                              autoFocus
                              required
                            />
                            <div className="form-actions">
                              <button type="submit" className="btn-primary btn-sm">Add</button>
                              <button type="button" onClick={() => {
                                setShowNewCard(null);
                                setNewCardTitle('');
                              }} className="btn-secondary btn-sm">Cancel</button>
                            </div>
                          </form>
                        ) : (
                          <button onClick={() => setShowNewCard(column.id)} className="btn-add-card">
                            + Add card
                          </button>
                        )
                      )}
                    </div>
                  )}
                </Draggable>
              ))}
              {provided.placeholder}
            </div>
          )}
        </Droppable>
      </DragDropContext>

      {showNewColumn && (
        <div className="modal-overlay" onClick={() => setShowNewColumn(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h2>New Column</h2>
            <form onSubmit={handleCreateColumn}>
              <div className="form-group">
                <label htmlFor="column-name">Column Name</label>
                <input
                  type="text"
                  id="column-name"
                  value={newColumnName}
                  onChange={(e) => setNewColumnName(e.target.value)}
                  required
                  autoFocus
                />
              </div>
              <div className="modal-actions">
                <button type="button" onClick={() => setShowNewColumn(false)} className="btn-secondary">
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

      {showMembers && (
        <BoardMembers
          boardId={boardId}
          onClose={() => setShowMembers(false)}
        />
      )}

      {showAssignees && (
        <BoardAssignees
          boardId={boardId}
          onClose={() => setShowAssignees(false)}
        />
      )}
    </div>
  );
}
