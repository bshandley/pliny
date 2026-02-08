import { useState, useEffect } from 'react';
import { DragDropContext, Droppable, Draggable, DropResult } from 'react-beautiful-dnd';
import { io, Socket } from 'socket.io-client';
import { api } from '../api';
import { Board, Card, Label } from '../types';
import { useConfirm } from '../contexts/ConfirmContext';
import KanbanCard from './KanbanCard';
import BoardMembers from './BoardMembers';
import BoardAssignees from './BoardAssignees';
import BoardLabels from './BoardLabels';
import PlankLogo from './PlankLogo';

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
  const [assignees, setAssignees] = useState<{ id: string; name: string }[]>([]);
  const [boardLabels, setBoardLabels] = useState<Label[]>([]);
  const [showNewColumn, setShowNewColumn] = useState(false);
  const [newColumnName, setNewColumnName] = useState('');
  const [showNewCard, setShowNewCard] = useState<string | null>(null);
  const [newCardTitle, setNewCardTitle] = useState('');
  const [showMembers, setShowMembers] = useState(false);
  const [showAssignees, setShowAssignees] = useState(false);
  const [showLabels, setShowLabels] = useState(false);
  const [showArchived, setShowArchived] = useState(false);
  const [editingCardId, setEditingCardId] = useState<string | null>(null);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [mobileFiltersOpen, setMobileFiltersOpen] = useState(false);
  const [showSettingsDropdown, setShowSettingsDropdown] = useState(false);

  // Filters
  const [filterText, setFilterText] = useState('');
  const [filterAssignee, setFilterAssignee] = useState('');
  const [filterLabel, setFilterLabel] = useState('');
  const [filterDue, setFilterDue] = useState('');

  const confirm = useConfirm();
  const isAdmin = userRole === 'ADMIN';
  const hasFilters = filterText || filterAssignee || filterLabel || filterDue;

  useEffect(() => {
    loadBoard();
    loadAssignees();
    loadLabels();

    const token = localStorage.getItem('token');
    const newSocket = io('/', { auth: { token } });
    newSocket.emit('join-board', boardId);
    newSocket.on('board-updated', () => {
      loadBoard();
      loadAssignees();
      loadLabels();
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

  const loadAssignees = async () => {
    try {
      const data = await api.getBoardAssignees(boardId);
      setAssignees(data);
    } catch (error) {
      console.error('Failed to load assignees:', error);
    }
  };

  const loadLabels = async () => {
    try {
      const data = await api.getBoardLabels(boardId);
      setBoardLabels(data);
    } catch (error) {
      console.error('Failed to load labels:', error);
    }
  };

  const filterCard = (card: Card): boolean => {
    if (!showArchived && card.archived) return false;
    if (showArchived && !card.archived) return false;
    if (filterText && !card.title.toLowerCase().includes(filterText.toLowerCase())) return false;
    if (filterAssignee && (!card.assignees || !card.assignees.includes(filterAssignee))) return false;
    if (filterLabel && (!card.labels || !card.labels.some(l => l.id === filterLabel))) return false;
    if (filterDue === 'overdue') {
      if (!card.due_date) return false;
      const due = new Date(card.due_date.split('T')[0] + 'T12:00:00');
      if (due >= new Date(new Date().toDateString())) return false;
    }
    if (filterDue === 'soon') {
      if (!card.due_date) return false;
      const due = new Date(card.due_date.split('T')[0] + 'T12:00:00');
      const now = new Date(new Date().toDateString());
      const tomorrow = new Date(now);
      tomorrow.setDate(tomorrow.getDate() + 2);
      if (due < now || due >= tomorrow) return false;
    }
    if (filterDue === 'none') {
      if (card.due_date) return false;
    }
    return true;
  };

  const handleDragEnd = async (result: DropResult) => {
    if (!isAdmin || !board) return;
    const { destination, source, type } = result;
    if (!destination) return;
    if (destination.droppableId === source.droppableId && destination.index === source.index) return;

    if (type === 'COLUMN') {
      const newColumns = Array.from(board.columns || []);
      const [removed] = newColumns.splice(source.index, 1);
      newColumns.splice(destination.index, 0, removed);
      const updates = newColumns.map((col, idx) => ({ ...col, position: idx }));
      setBoard({ ...board, columns: updates });
      try {
        await Promise.all(updates.map(col => api.updateColumn(col.id, { position: col.position })));
        socket?.emit('board-updated', boardId);
      } catch (error) {
        console.error('Failed to update columns:', error);
        loadBoard();
      }
    } else {
      const sourceColumn = board.columns?.find(col => col.id === source.droppableId);
      const destColumn = board.columns?.find(col => col.id === destination.droppableId);
      if (!sourceColumn || !destColumn) return;

      if (source.droppableId === destination.droppableId) {
        const newCards = Array.from(sourceColumn.cards || []);
        const [removed] = newCards.splice(source.index, 1);
        newCards.splice(destination.index, 0, removed);
        const updatedColumn = { ...sourceColumn, cards: newCards.map((card, idx) => ({ ...card, position: idx })) };
        setBoard({ ...board, columns: board.columns?.map(col => col.id === sourceColumn.id ? updatedColumn : col) });
        try {
          await Promise.all(updatedColumn.cards!.map(card => api.updateCard(card.id, { position: card.position })));
          socket?.emit('board-updated', boardId);
        } catch (error) {
          console.error('Failed to update cards:', error);
          loadBoard();
        }
      } else {
        const sourceCards = Array.from(sourceColumn.cards || []);
        const destCards = Array.from(destColumn.cards || []);
        const [removed] = sourceCards.splice(source.index, 1);
        removed.column_id = destColumn.id;
        destCards.splice(destination.index, 0, removed);
        const updatedSourceColumn = { ...sourceColumn, cards: sourceCards.map((card, idx) => ({ ...card, position: idx })) };
        const updatedDestColumn = { ...destColumn, cards: destCards.map((card, idx) => ({ ...card, position: idx, column_id: destColumn.id })) };
        setBoard({
          ...board,
          columns: board.columns?.map(col => {
            if (col.id === sourceColumn.id) return updatedSourceColumn;
            if (col.id === destColumn.id) return updatedDestColumn;
            return col;
          })
        });
        try {
          await Promise.all([
            ...updatedSourceColumn.cards!.map(card => api.updateCard(card.id, { position: card.position })),
            ...updatedDestColumn.cards!.map(card => api.updateCard(card.id, { position: card.position, column_id: destColumn.id }))
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
      await loadBoard();
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
      await loadBoard();
      socket?.emit('board-updated', boardId);
    } catch (error: any) {
      alert('Failed to create card: ' + error.message);
    }
  };

  const handleArchiveCard = async (cardId: string) => {
    try {
      await api.updateCard(cardId, { archived: true } as any);
      await loadBoard();
      socket?.emit('board-updated', boardId);
    } catch (error: any) {
      alert('Failed to archive card: ' + error.message);
    }
  };

  const handleRestoreCard = async (cardId: string) => {
    try {
      await api.updateCard(cardId, { archived: false } as any);
      await loadBoard();
      socket?.emit('board-updated', boardId);
    } catch (error: any) {
      alert('Failed to restore card: ' + error.message);
    }
  };

  const handleDeleteCard = async (cardId: string) => {
    if (!await confirm('Permanently delete this card?', { confirmLabel: 'Delete' })) return;
    try {
      await api.deleteCard(cardId);
      await loadBoard();
      socket?.emit('board-updated', boardId);
    } catch (error: any) {
      alert('Failed to delete card: ' + error.message);
    }
  };

  const handleUpdateCard = async (cardId: string, updates: Partial<Card>) => {
    try {
      await api.updateCard(cardId, updates);
      await loadBoard();
      socket?.emit('board-updated', boardId);
    } catch (error: any) {
      alert('Failed to update card: ' + error.message);
    }
  };

  const handleAddAssignee = async (name: string): Promise<boolean> => {
    try {
      const newAssignee = await api.addBoardAssignee(boardId, name);
      setAssignees(prev => [...prev, newAssignee]);
      socket?.emit('board-updated', boardId);
      return true;
    } catch (error: any) {
      console.error('Failed to add assignee:', error);
      return false;
    }
  };

  const handleDeleteColumn = async (columnId: string, columnName: string) => {
    if (!await confirm(`Delete column "${columnName}" and all its cards?`, { confirmLabel: 'Delete' })) return;
    try {
      await api.deleteColumn(columnId);
      await loadBoard();
      socket?.emit('board-updated', boardId);
    } catch (error: any) {
      alert('Failed to delete column: ' + error.message);
    }
  };

  if (loading) return <div className="loading"><div className="spinner"></div></div>;
  if (!board) return <div>Board not found</div>;

  return (
    <div className="kanban-container">
      <header className="kanban-header">
        <div className="header-left">
          <button onClick={onBack} className="btn-icon">←</button>
          <PlankLogo size={24} />
          <h1>{board.name}</h1>
        </div>
        <div className="header-actions">
          <button
            onClick={() => setMobileFiltersOpen(!mobileFiltersOpen)}
            className={`btn-icon mobile-only${mobileFiltersOpen ? ' mobile-active' : ''}${hasFilters ? ' has-filters' : ''}`}
            title="Filters"
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><circle cx="10.5" cy="10.5" r="7.5"/><path d="M21 21l-5.2-5.2"/></svg>
          </button>
          <button
            onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
            className={`btn-icon mobile-only${mobileMenuOpen ? ' mobile-active' : ''}`}
            title="Menu"
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><circle cx="12" cy="5" r="2"/><circle cx="12" cy="12" r="2"/><circle cx="12" cy="19" r="2"/></svg>
          </button>
          <div className={`header-actions-menu${mobileMenuOpen ? ' open' : ''}`}>
            {isAdmin && (
              <>
                <div className="board-settings">
                  <button
                    onClick={() => setShowSettingsDropdown(!showSettingsDropdown)}
                    className="board-settings-trigger btn-secondary btn-sm"
                  >
                    Board ▾
                  </button>
                  <div className={`board-settings-menu${showSettingsDropdown ? ' open' : ''}`}>
                    <button onClick={() => { setShowMembers(true); setShowSettingsDropdown(false); setMobileMenuOpen(false); }} className="btn-secondary btn-sm">Members</button>
                    <button onClick={() => { setShowAssignees(true); setShowSettingsDropdown(false); setMobileMenuOpen(false); }} className="btn-secondary btn-sm">Assignees</button>
                    <button onClick={() => { setShowLabels(true); setShowSettingsDropdown(false); setMobileMenuOpen(false); }} className="btn-secondary btn-sm">Labels</button>
                  </div>
                </div>
                <button onClick={() => { setShowNewColumn(true); setMobileMenuOpen(false); }} className="btn-primary btn-sm">+ Column</button>
              </>
            )}
            <button
              onClick={() => { setShowArchived(!showArchived); setMobileMenuOpen(false); }}
              className={`btn-secondary btn-sm ${showArchived ? 'active-filter' : ''}`}
            >
              {showArchived ? 'Show Active' : 'Archived'}
            </button>
            <button onClick={() => { onLogout(); setMobileMenuOpen(false); }} className="btn-secondary btn-sm">Logout</button>
          </div>
        </div>
      </header>

      {/* Mobile menu backdrop */}
      {mobileMenuOpen && <div className="mobile-backdrop" onClick={() => setMobileMenuOpen(false)} />}
      {showSettingsDropdown && <div className="settings-backdrop" onClick={() => setShowSettingsDropdown(false)} />}

      {/* Filter bar */}
      <div className={`filter-bar${mobileFiltersOpen ? ' mobile-open' : ''}`}>
        <input
          type="text"
          value={filterText}
          onChange={(e) => setFilterText(e.target.value)}
          placeholder="Search cards..."
          className="filter-input"
        />
        <select value={filterAssignee} onChange={(e) => setFilterAssignee(e.target.value)} className="filter-select">
          <option value="">All assignees</option>
          {assignees.map(a => <option key={a.id} value={a.name}>{a.name}</option>)}
        </select>
        {boardLabels.length > 0 && (
          <select value={filterLabel} onChange={(e) => setFilterLabel(e.target.value)} className="filter-select">
            <option value="">All labels</option>
            {boardLabels.map(l => <option key={l.id} value={l.id}>{l.name}</option>)}
          </select>
        )}
        <select value={filterDue} onChange={(e) => setFilterDue(e.target.value)} className="filter-select">
          <option value="">All dates</option>
          <option value="overdue">Overdue</option>
          <option value="soon">Due soon</option>
          <option value="none">No date</option>
        </select>
        {hasFilters && (
          <button onClick={() => { setFilterText(''); setFilterAssignee(''); setFilterLabel(''); setFilterDue(''); }} className="btn-secondary btn-sm">
            Clear
          </button>
        )}
      </div>

      <DragDropContext onDragEnd={handleDragEnd}>
        <Droppable droppableId="board" direction="horizontal" type="COLUMN" isDropDisabled={!isAdmin}>
          {(provided) => (
            <div className="columns-container" {...provided.droppableProps} ref={provided.innerRef}>
              {board.columns?.map((column, index) => {
                const visibleCards = column.cards?.filter(filterCard) || [];
                return (
                  <Draggable key={column.id} draggableId={column.id} index={index} isDragDisabled={!isAdmin}>
                    {(provided) => (
                      <div className="column" ref={provided.innerRef} {...provided.draggableProps}>
                        <div className="column-header" {...provided.dragHandleProps}>
                          <h3>{column.name}</h3>
                          <div className="column-header-actions">
                            <span className="card-count">{visibleCards.length}</span>
                            {isAdmin && (
                              <button
                                className="btn-icon btn-delete"
                                onClick={(e) => { e.stopPropagation(); handleDeleteColumn(column.id, column.name); }}
                                title="Delete column"
                              >×</button>
                            )}
                          </div>
                        </div>

                        <Droppable droppableId={column.id} type="CARD" isDropDisabled={!isAdmin || showArchived}>
                          {(provided) => (
                            <div className="cards-list" {...provided.droppableProps} ref={provided.innerRef}>
                              {visibleCards.map((card, cardIndex) => (
                                <Draggable key={card.id} draggableId={card.id} index={cardIndex} isDragDisabled={!isAdmin || showArchived}>
                                  {(provided) => (
                                    <div ref={provided.innerRef} {...provided.draggableProps} {...provided.dragHandleProps}>
                                      {showArchived ? (
                                        <div className="kanban-card archived">
                                          <div className="card-header">
                                            <h4>{card.title}</h4>
                                          </div>
                                          {isAdmin && (
                                            <div className="archive-actions">
                                              <button onClick={() => handleRestoreCard(card.id)} className="btn-primary btn-sm">Restore</button>
                                              <button onClick={() => handleDeleteCard(card.id)} className="btn-danger btn-sm">Delete</button>
                                            </div>
                                          )}
                                        </div>
                                      ) : (
                                        <KanbanCard
                                          card={card}
                                          canWrite={isAdmin}
                                          isEditing={editingCardId === card.id}
                                          onEditStart={() => setEditingCardId(card.id)}
                                          onEditEnd={() => setEditingCardId(null)}
                                          onDelete={() => handleDeleteCard(card.id)}
                                          onArchive={() => handleArchiveCard(card.id)}
                                          onUpdate={(updates) => handleUpdateCard(card.id, updates)}
                                          assignees={assignees}
                                          boardLabels={boardLabels}
                                          boardId={boardId}
                                          onAddAssignee={handleAddAssignee}
                                        />
                                      )}
                                    </div>
                                  )}
                                </Draggable>
                              ))}
                              {provided.placeholder}
                            </div>
                          )}
                        </Droppable>

                        {isAdmin && !showArchived && (
                          showNewCard === column.id ? (
                            <form onSubmit={(e) => handleCreateCard(e, column.id)} className="new-card-form">
                              <input type="text" value={newCardTitle} onChange={(e) => setNewCardTitle(e.target.value)} placeholder="Card title..." autoFocus required />
                              <div className="form-actions">
                                <button type="submit" className="btn-primary btn-sm">Add</button>
                                <button type="button" onClick={() => { setShowNewCard(null); setNewCardTitle(''); }} className="btn-secondary btn-sm">Cancel</button>
                              </div>
                            </form>
                          ) : (
                            <button onClick={() => setShowNewCard(column.id)} className="btn-add-card">+ Add card</button>
                          )
                        )}
                      </div>
                    )}
                  </Draggable>
                );
              })}
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
                <input type="text" id="column-name" value={newColumnName} onChange={(e) => setNewColumnName(e.target.value)} required autoFocus />
              </div>
              <div className="modal-actions">
                <button type="button" onClick={() => setShowNewColumn(false)} className="btn-secondary">Cancel</button>
                <button type="submit" className="btn-primary">Create</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {showMembers && <BoardMembers boardId={boardId} onClose={() => setShowMembers(false)} />}
      {showAssignees && (
        <BoardAssignees
          boardId={boardId}
          onClose={() => { setShowAssignees(false); loadAssignees(); }}
        />
      )}
      {showLabels && (
        <BoardLabels
          boardId={boardId}
          onClose={() => { setShowLabels(false); loadLabels(); loadBoard(); }}
        />
      )}
    </div>
  );
}
