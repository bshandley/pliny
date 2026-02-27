import { useState, useEffect, useRef, useCallback } from 'react';
import { DragDropContext, Droppable, Draggable, DropResult } from '@hello-pangea/dnd';
import { io, Socket } from 'socket.io-client';
import { api } from '../api';
import { Board, Card, Label, BoardMember } from '../types';
import { useConfirm } from '../contexts/ConfirmContext';
import { useIsMobile } from '../hooks/useIsMobile';
import KanbanCard from './KanbanCard';
import BoardMembers from './BoardMembers';
import BoardLabels from './BoardLabels';
import AppBar from './AppBar';
import CalendarView from './CalendarView';
import TableView from './TableView';
import TimelineView from './TimelineView';
import CustomFieldManager from './CustomFieldManager';
import DashboardView from './DashboardView';
import CSVImportModal from './CSVImportModal';
import BulkActionToolbar from './BulkActionToolbar';

interface KanbanBoardProps {
  boardId: string;
  onBack: () => void;
  userRole: 'READ' | 'COLLABORATOR' | 'ADMIN';
  viewMode: 'board' | 'calendar' | 'table' | 'timeline' | 'dashboard';
  onViewChange: (mode: 'board' | 'calendar' | 'table' | 'timeline' | 'dashboard') => void;
  initialCardId?: string | null;
  onCardOpened?: () => void;
}

export default function KanbanBoard({ boardId, onBack, userRole, viewMode, onViewChange, initialCardId, onCardOpened }: KanbanBoardProps) {
  const [board, setBoard] = useState<Board | null>(null);
  const [loading, setLoading] = useState(true);
  const [socket, setSocket] = useState<Socket | null>(null);
  const [boardLabels, setBoardLabels] = useState<Label[]>([]);
  const [boardMembers, setBoardMembers] = useState<BoardMember[]>([]);
  const [showNewColumn, setShowNewColumn] = useState(false);
  const [newColumnName, setNewColumnName] = useState('');
  const [showNewCard, setShowNewCard] = useState<string | null>(null);
  const [newCardTitle, setNewCardTitle] = useState('');
  const [showMembers, setShowMembers] = useState(false);
  const [showLabels, setShowLabels] = useState(false);
  const [showFieldManager, setShowFieldManager] = useState(false);
  const [showArchived, setShowArchived] = useState(false);
  const [editingCardId, setEditingCardId] = useState<string | null>(null);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [mobileFiltersOpen, setMobileFiltersOpen] = useState(false);
  const [showSettingsDropdown, setShowSettingsDropdown] = useState(false);
  const [exportStatus, setExportStatus] = useState<string | null>(null);
  const [showCsvImport, setShowCsvImport] = useState(false);
  const [columnMenuId, setColumnMenuId] = useState<string | null>(null);
  const [renamingColumnId, setRenamingColumnId] = useState<string | null>(null);
  const [renameColumnValue, setRenameColumnValue] = useState('');
  const [labelDropdownOpen, setLabelDropdownOpen] = useState(false);
  const [unscheduledOrder, setUnscheduledOrder] = useState<string[] | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);
  const [publicUrl, setPublicUrl] = useState<string | null>(null);
  const [publicLinkLoading, setPublicLinkLoading] = useState(false);
  const [publicLinkCopied, setPublicLinkCopied] = useState(false);
  const [selectedCardIds, setSelectedCardIds] = useState<Set<string>>(new Set());
  const lastSelectedCardIdRef = useRef<string | null>(null);
  const columnMenuRef = useRef<HTMLDivElement>(null);
  const labelDropdownRef = useRef<HTMLDivElement>(null);
  const newCardFormRef = useRef<HTMLFormElement>(null);

  // Filters
  const [filterText, setFilterText] = useState('');
  const [filterAssignee, setFilterAssignee] = useState('');
  const [filterLabel, setFilterLabel] = useState('');
  const [filterDue, setFilterDue] = useState('');
  const [filterColumn, setFilterColumn] = useState('');
  const [customFieldFilters, setCustomFieldFilters] = useState<Record<string, string>>({});

  const confirm = useConfirm();
  const isMobile = useIsMobile();
  const isAdmin = userRole === 'ADMIN';
  const hasCustomFieldFilters = Object.values(customFieldFilters).some(v => v !== '');
  const hasFilters = filterText || filterAssignee || filterLabel || filterDue || filterColumn || hasCustomFieldFilters;

  // On mobile, push a history entry when a card is opened so the browser
  // back button/gesture closes the card instead of leaving the board.
  const cardHistoryPushed = useRef(false);
  useEffect(() => {
    if (!isMobile) return;
    if (editingCardId) {
      window.history.pushState({ cardOpen: true }, '');
      cardHistoryPushed.current = true;
      const handlePopState = () => {
        cardHistoryPushed.current = false;
        setEditingCardId(null);
      };
      window.addEventListener('popstate', handlePopState);
      return () => window.removeEventListener('popstate', handlePopState);
    }
  }, [isMobile, editingCardId]);

  const clearSelection = useCallback(() => {
    setSelectedCardIds(new Set());
    lastSelectedCardIdRef.current = null;
  }, []);

  // Clear any open card when the view changes (e.g. browser back from board → calendar
  // after opening a card via handleOpenInBoard — prevents stale overlay, issue #8).
  useEffect(() => {
    setEditingCardId(null);
    clearSelection();
  }, [viewMode]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && selectedCardIds.size > 0) {
        clearSelection();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [selectedCardIds.size, clearSelection]);

  // Prune selected card IDs that no longer exist in the visible card set
  // (e.g. after another user deletes/archives a card via websocket)
  useEffect(() => {
    if (!board || selectedCardIds.size === 0) return;
    const visibleIds = new Set<string>();
    for (const col of (board.columns || [])) {
      for (const card of (col.cards || []).filter(filterCard)) {
        visibleIds.add(card.id);
      }
    }
    setSelectedCardIds(prev => {
      const pruned = new Set([...prev].filter(id => visibleIds.has(id)));
      if (pruned.size === prev.size) return prev;
      return pruned;
    });
  }, [board]);

  const openCard = (cardId: string) => {
    clearSelection();
    setEditingCardId(cardId);
  };

  const closeCard = () => {
    if (isMobile && cardHistoryPushed.current) {
      // Let history.back() trigger the popstate handler which clears editingCardId
      window.history.back();
    } else {
      setEditingCardId(null);
    }
  };

  useEffect(() => {
    loadBoard();
    loadLabels();
    loadBoardMembers();

    const token = localStorage.getItem('token');
    const newSocket = io('/', { auth: { token } });
    newSocket.emit('join-board', boardId);
    newSocket.on('board-updated', () => {
      loadBoard();
      loadLabels();
      loadBoardMembers();
      setRefreshKey(k => k + 1);
    });
    setSocket(newSocket);
    return () => {
      newSocket.emit('leave-board', boardId);
      newSocket.disconnect();
    };
  }, [boardId]);

  // Open a specific card when navigated from notification
  useEffect(() => {
    if (initialCardId && board) {
      setEditingCardId(initialCardId);
      onCardOpened?.();
    }
  }, [initialCardId, board]);

  // Close column kebab menu on outside click
  useEffect(() => {
    if (!columnMenuId) return;
    const handleClick = (e: MouseEvent) => {
      if (columnMenuRef.current && !columnMenuRef.current.contains(e.target as Node)) {
        setColumnMenuId(null);
      }
    };
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [columnMenuId]);

  // Close label dropdown on outside click
  useEffect(() => {
    if (!labelDropdownOpen) return;
    const handleClick = (e: MouseEvent) => {
      if (labelDropdownRef.current && !labelDropdownRef.current.contains(e.target as Node)) {
        setLabelDropdownOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [labelDropdownOpen]);

  // Close add card form on outside click
  useEffect(() => {
    if (!showNewCard) return;
    const handleClick = (e: MouseEvent) => {
      if (newCardFormRef.current && !newCardFormRef.current.contains(e.target as Node)) {
        setShowNewCard(null);
        setNewCardTitle('');
      }
    };
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [showNewCard]);


  const loadBoard = async () => {
    try {
      const data = await api.getBoard(boardId);
      if (data.archived) {
        onBack();
        return;
      }
      setBoard(data);
      if (data.public_token) {
        setPublicUrl(`${window.location.origin}/public/${data.public_token}`);
      } else {
        setPublicUrl(null);
      }
    } catch (error: any) {
      console.error('Failed to load board:', error);
      // Board was deleted or we lost access — go back to board list
      onBack();
      return;
    } finally {
      setLoading(false);
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

  const loadBoardMembers = async () => {
    try {
      const data = await api.getBoardMembers(boardId);
      setBoardMembers(data);
    } catch (error) {
      console.error('Failed to load board members:', error);
    }
  };

  const filterCard = (card: Card): boolean => {
    if (!showArchived && card.archived) return false;
    if (showArchived && !card.archived) return false;
    if (filterColumn && card.column_id !== filterColumn) return false;
    if (filterText && !card.title.toLowerCase().includes(filterText.toLowerCase())) return false;
    if (filterAssignee === '__unassigned__') {
      if (card.assignees && card.assignees.length > 0) return false;
    } else if (filterAssignee && (!card.assignees || !card.assignees.some(a => (a.username || a.display_name) === filterAssignee))) return false;
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
    if (filterDue === 'overdue-subtasks') {
      if (!card.checklist?.overdue || card.checklist.overdue === 0) return false;
    }
    // Custom field filters
    for (const [fieldId, filterValue] of Object.entries(customFieldFilters)) {
      if (!filterValue) continue;
      const cardValue = card.custom_field_values?.[fieldId]?.value;
      const field = board?.custom_fields?.find(f => f.id === fieldId);
      if (!field) continue;
      if (field.field_type === 'text') {
        if (!cardValue || !cardValue.toLowerCase().includes(filterValue.toLowerCase())) return false;
      } else {
        if (!cardValue || cardValue !== filterValue) return false;
      }
    }
    return true;
  };

  const handleDragEnd = async (result: DropResult) => {
    if (!isAdmin || !board) return;
    const { destination, source, type } = result;
    if (!destination) return;
    if (destination.droppableId === source.droppableId && destination.index === source.index) return;

    if (type === 'CALENDAR') {
      const cardId = result.draggableId;
      const destId = destination.droppableId;

      // Reordering within the unscheduled sidebar — local-only, no API call
      if (source.droppableId === 'unscheduled' && destId === 'unscheduled') {
        const unscheduledCards: string[] = [];
        board.columns?.forEach(col => {
          col.cards?.filter(c => !c.due_date && !c.archived).forEach(card => {
            unscheduledCards.push(card.id);
          });
        });
        // Apply existing custom order if any
        const ordered = unscheduledOrder
          ? [...unscheduledCards].sort((a, b) => {
              const ai = unscheduledOrder.indexOf(a);
              const bi = unscheduledOrder.indexOf(b);
              return (ai === -1 ? 999 : ai) - (bi === -1 ? 999 : bi);
            })
          : unscheduledCards;
        const [moved] = ordered.splice(source.index, 1);
        ordered.splice(destination.index, 0, moved);
        setUnscheduledOrder(ordered);
        return;
      }

      let newDueDate: string | null = null;
      if (destId.startsWith('calendar-')) {
        newDueDate = destId.replace('calendar-', '');
      }
      // destId === 'unscheduled' means clearing the date (newDueDate stays null)

      try {
        await api.updateCard(cardId, { due_date: newDueDate });
        socket?.emit('board-updated', boardId);
        await loadBoard();
      } catch (error) {
        console.error('Failed to update card date:', error);
        loadBoard();
      }
      return;
    }

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

  const handleDeleteColumn = async (columnId: string, columnName: string) => {
    setColumnMenuId(null);
    if (!await confirm(`Delete column "${columnName}" and all its cards?`, { confirmLabel: 'Delete' })) return;
    try {
      await api.deleteColumn(columnId);
      await loadBoard();
      socket?.emit('board-updated', boardId);
    } catch (error: any) {
      alert('Failed to delete column: ' + error.message);
    }
  };

  const handleRenameColumn = async (columnId: string) => {
    const trimmed = renameColumnValue.trim();
    if (!trimmed) {
      setRenamingColumnId(null);
      return;
    }
    try {
      await api.updateColumn(columnId, { name: trimmed });
      setRenamingColumnId(null);
      setRenameColumnValue('');
      await loadBoard();
      socket?.emit('board-updated', boardId);
    } catch (error: any) {
      alert('Failed to rename column: ' + error.message);
    }
  };

  const handleCalendarCardClick = (card: Card, _columnName: string, _event: React.MouseEvent) => {
    if (isMobile) return;
    handleOpenInBoard(card.id);
  };

  const handleOpenInBoard = (cardId: string) => {
    // Switch to board view then open the card. The viewMode useEffect above clears
    // editingCardId on any view change, so browser-back won't leave a stale overlay (#8).
    onViewChange('board');
    setTimeout(() => setEditingCardId(cardId), 100);
  };

  const handleCalendarChangeDate = async (cardId: string, date: string) => {
    try {
      await api.updateCard(cardId, { due_date: date } as any);
      socket?.emit('board-updated', boardId);
      await loadBoard();
    } catch (error) {
      console.error('Failed to update card date:', error);
      loadBoard();
    }
  };

  const handleCalendarRemoveDate = async (cardId: string) => {
    try {
      await api.updateCard(cardId, { due_date: null } as any);
      socket?.emit('board-updated', boardId);
      await loadBoard();
    } catch (error) {
      console.error('Failed to remove card date:', error);
      loadBoard();
    }
  };

  const handleMoveToColumn = async (cardId: string, columnId: string) => {
    try {
      const targetColumn = board?.columns?.find(c => c.id === columnId);
      const position = targetColumn?.cards?.length || 0;
      await api.updateCard(cardId, { column_id: columnId, position });
      setEditingCardId(null);
      await loadBoard();
      socket?.emit('board-updated', boardId);
    } catch (error: any) {
      console.error('Failed to move card:', error);
      await loadBoard();
    }
  };

  const toggleCardSelection = useCallback((cardId: string, shiftKey: boolean) => {
    setSelectedCardIds(prev => {
      const next = new Set(prev);
      if (shiftKey && lastSelectedCardIdRef.current && board) {
        // Shift+click range select operates within a single column.
        // Cross-column shift+click falls through to single toggle.
        for (const col of (board.columns || [])) {
          const cards = (col.cards || []).filter(filterCard);
          const lastIdx = cards.findIndex(c => c.id === lastSelectedCardIdRef.current);
          const curIdx = cards.findIndex(c => c.id === cardId);
          if (lastIdx !== -1 && curIdx !== -1) {
            const [start, end] = lastIdx < curIdx ? [lastIdx, curIdx] : [curIdx, lastIdx];
            for (let i = start; i <= end; i++) {
              next.add(cards[i].id);
            }
            break;
          }
        }
      } else {
        if (next.has(cardId)) {
          next.delete(cardId);
        } else {
          next.add(cardId);
        }
      }
      lastSelectedCardIdRef.current = cardId;
      return next;
    });
  }, [board, filterCard]);

  const selectAllVisible = useCallback(() => {
    if (!board) return;
    const allVisible = new Set<string>();
    for (const col of (board.columns || [])) {
      for (const card of (col.cards || []).filter(filterCard)) {
        allVisible.add(card.id);
      }
    }
    setSelectedCardIds(allVisible);
  }, [board, filterCard]);

  const handleBulkMoveToColumn = async (targetColumnId: string) => {
    if (selectedCardIds.size === 0 || !board) return;
    const targetColumn = board.columns?.find(c => c.id === targetColumnId);
    let nextPosition = targetColumn?.cards?.length || 0;
    try {
      await Promise.all(
        Array.from(selectedCardIds).map((cardId, i) =>
          api.updateCard(cardId, { column_id: targetColumnId, position: nextPosition + i })
        )
      );
      clearSelection();
      await loadBoard();
      socket?.emit('board-updated', boardId);
    } catch (error: any) {
      alert(`Some cards failed to move: ${error.message}`);
      await loadBoard();
      clearSelection();
    }
  };

  const handleBulkAssignMember = async (member: BoardMember) => {
    if (selectedCardIds.size === 0 || !board) return;
    const allCards = board.columns?.flatMap(c => c.cards || []) || [];
    try {
      await Promise.all(
        Array.from(selectedCardIds).map(cardId => {
          const card = allCards.find(c => c.id === cardId);
          if (!card) return Promise.resolve();
          const existing = card.assignees || [];
          if (existing.some(a => a.username === member.username)) return Promise.resolve();
          return api.updateCard(cardId, {
            assignees: [...existing, { id: '', user_id: member.id, username: member.username }],
          } as any);
        })
      );
      clearSelection();
      await loadBoard();
      socket?.emit('board-updated', boardId);
    } catch (error: any) {
      alert(`Some cards failed to update: ${error.message}`);
      await loadBoard();
      clearSelection();
    }
  };

  const handleBulkAssignLabel = async (labelId: string) => {
    if (selectedCardIds.size === 0 || !board) return;
    const allCards = board.columns?.flatMap(c => c.cards || []) || [];
    try {
      await Promise.all(
        Array.from(selectedCardIds).map(cardId => {
          const card = allCards.find(c => c.id === cardId);
          if (!card) return Promise.resolve();
          const existingLabelIds = (card.labels || []).map(l => l.id);
          if (existingLabelIds.includes(labelId)) return Promise.resolve();
          return api.updateCard(cardId, {
            labels: [...existingLabelIds, labelId],
          } as any);
        })
      );
      clearSelection();
      await loadBoard();
      socket?.emit('board-updated', boardId);
    } catch (error: any) {
      alert(`Some cards failed to update: ${error.message}`);
      await loadBoard();
      clearSelection();
    }
  };

  const handleBulkArchive = async () => {
    if (selectedCardIds.size === 0) return;
    if (!await confirm(`Archive ${selectedCardIds.size} card${selectedCardIds.size > 1 ? 's' : ''}?`, { confirmLabel: 'Archive' })) return;
    try {
      await Promise.all(
        Array.from(selectedCardIds).map(cardId =>
          api.updateCard(cardId, { archived: true } as any)
        )
      );
      clearSelection();
      await loadBoard();
      socket?.emit('board-updated', boardId);
    } catch (error: any) {
      alert(`Some cards failed to archive: ${error.message}`);
      await loadBoard();
      clearSelection();
    }
  };

  const handleBulkDelete = async () => {
    if (selectedCardIds.size === 0) return;
    if (!await confirm(`Permanently delete ${selectedCardIds.size} card${selectedCardIds.size > 1 ? 's' : ''}? This cannot be undone.`, { confirmLabel: 'Delete' })) return;
    try {
      await Promise.all(
        Array.from(selectedCardIds).map(cardId => api.deleteCard(cardId))
      );
      clearSelection();
      await loadBoard();
      socket?.emit('board-updated', boardId);
    } catch (error: any) {
      alert(`Some cards failed to delete: ${error.message}`);
      await loadBoard();
      clearSelection();
    }
  };

  const handleExportCsv = async () => {
    setShowSettingsDropdown(false);
    setMobileMenuOpen(false);
    try {
      await api.exportBoardCsv(boardId);
      setExportStatus('Export complete');
      setTimeout(() => setExportStatus(null), 3000);
    } catch (err: any) {
      setExportStatus(err.message || 'Export failed');
      setTimeout(() => setExportStatus(null), 5000);
    }
  };

  const [exportingJson, setExportingJson] = useState(false);
  const handleExportJson = async () => {
    setShowSettingsDropdown(false);
    setMobileMenuOpen(false);
    setExportingJson(true);
    try {
      const data = await api.exportBoardJson(boardId);
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      const safeName = (board?.name || 'board').replace(/[^a-z0-9_-]/gi, '_').toLowerCase();
      a.download = `${safeName}-export.json`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      setExportStatus('JSON export complete');
      setTimeout(() => setExportStatus(null), 3000);
    } catch (err: any) {
      setExportStatus(err.message || 'JSON export failed');
      setTimeout(() => setExportStatus(null), 5000);
    } finally {
      setExportingJson(false);
    }
  };

  const handleTogglePublicLink = async () => {
    setPublicLinkLoading(true);
    try {
      if (publicUrl) {
        await api.revokePublicLink(boardId);
        setPublicUrl(null);
      } else {
        const result = await api.generatePublicLink(boardId);
        setPublicUrl(`${window.location.origin}/public/${result.token}`);
      }
    } catch (err: any) {
      alert(err.message || 'Failed to update public link');
    } finally {
      setPublicLinkLoading(false);
    }
  };

  const handleCopyPublicUrl = () => {
    if (publicUrl) {
      navigator.clipboard.writeText(publicUrl);
      setPublicLinkCopied(true);
      setTimeout(() => setPublicLinkCopied(false), 2000);
    }
  };

  const handleDashboardFilterNavigate = (filters: { assignee?: string; label?: string; due?: string; column?: string }) => {
    setFilterText('');
    setFilterAssignee(filters.assignee || '');
    setFilterLabel(filters.label || '');
    setFilterDue(filters.due || '');
    setFilterColumn(filters.column || '');
    setCustomFieldFilters({});
    onViewChange('board');
  };

  if (loading) return <div className="loading"><div className="spinner"></div></div>;
  if (!board) return <div>Board not found</div>;

  const totalVisibleCards = board.columns?.reduce((sum, col) => sum + (col.cards || []).filter(filterCard).length, 0) || 0;
  const allVisibleSelected = totalVisibleCards > 0 && selectedCardIds.size === totalVisibleCards;

  return (
    <div className="kanban-container">
      <AppBar title={board.name} onBack={onBack}>
        <div className="view-toggle">
          <button
            className={`btn-icon view-toggle-btn${viewMode === 'board' ? ' active' : ''}`}
            onClick={() => onViewChange('board')}
            title="Board view"
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <rect x="3" y="3" width="7" height="18" rx="1"/><rect x="14" y="3" width="7" height="12" rx="1"/>
            </svg>
          </button>
          <button
            className={`btn-icon view-toggle-btn${viewMode === 'calendar' ? ' active' : ''}`}
            onClick={() => onViewChange('calendar')}
            title="Calendar view"
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <rect x="3" y="4" width="18" height="18" rx="2"/><path d="M16 2v4M8 2v4M3 10h18"/>
            </svg>
          </button>
          <button
            className={`btn-icon view-toggle-btn${viewMode === 'table' ? ' active' : ''}`}
            onClick={() => onViewChange('table')}
            title="Table view"
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <rect x="3" y="3" width="18" height="18" rx="2"/><path d="M3 9h18M3 15h18M9 3v18"/>
            </svg>
          </button>
          <button
            className={`btn-icon view-toggle-btn${viewMode === 'timeline' ? ' active' : ''}`}
            onClick={() => onViewChange('timeline')}
            title="Timeline view"
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M4 6h16M4 12h10M4 18h14"/>
            </svg>
          </button>
          <button
            className={`btn-icon view-toggle-btn${viewMode === 'dashboard' ? ' active' : ''}`}
            onClick={() => onViewChange('dashboard')}
            title="Dashboard"
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M18 20V10M12 20V4M6 20v-6"/>
            </svg>
          </button>
        </div>
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
            <div className="board-settings">
              <button
                onClick={() => setShowSettingsDropdown(!showSettingsDropdown)}
                className="board-settings-trigger btn-secondary btn-sm"
              >
                Board ▾
              </button>
              <div className={`board-settings-menu${showSettingsDropdown ? ' open' : ''}`}>
                <button onClick={() => { setShowNewColumn(true); setShowSettingsDropdown(false); setMobileMenuOpen(false); }}>+ Add Column</button>
                <button onClick={() => { setShowArchived(!showArchived); setShowSettingsDropdown(false); setMobileMenuOpen(false); }} className={showArchived ? 'active' : ''}>
                  {showArchived ? 'Show Active' : 'Archived'}
                </button>
                <div className="board-settings-divider" />
                <button onClick={() => { setShowMembers(true); setShowSettingsDropdown(false); setMobileMenuOpen(false); }}>Members</button>
                <button onClick={() => { setShowLabels(true); setShowSettingsDropdown(false); setMobileMenuOpen(false); }}>Labels</button>
                <button onClick={() => { setShowFieldManager(true); setShowSettingsDropdown(false); setMobileMenuOpen(false); }}>Custom Fields</button>
                <div className="board-settings-divider" />
                <button onClick={handleExportCsv}>Export CSV</button>
                <button onClick={handleExportJson} disabled={exportingJson}>{exportingJson ? 'Exporting...' : 'Export JSON'}</button>
                <button onClick={() => { setShowCsvImport(true); setShowSettingsDropdown(false); setMobileMenuOpen(false); }}>Import CSV</button>
                <div className="board-settings-divider" />
                <div className="board-settings-section">
                  <button onClick={handleTogglePublicLink} disabled={publicLinkLoading}>
                    {publicLinkLoading ? 'Updating...' : publicUrl ? 'Disable Public Link' : 'Share Publicly'}
                  </button>
                  {publicUrl && (
                    <div className="public-link-row" onClick={(e) => e.stopPropagation()}>
                      <input type="text" value={publicUrl} readOnly className="public-link-input" />
                      <button onClick={handleCopyPublicUrl} className="public-link-copy">
                        {publicLinkCopied ? 'Copied!' : 'Copy'}
                      </button>
                    </div>
                  )}
                </div>
              </div>
            </div>
          )}
          {!isAdmin && (
            <button
              onClick={() => { setShowArchived(!showArchived); setMobileMenuOpen(false); }}
              className={`btn-secondary btn-sm ${showArchived ? 'active-filter' : ''}`}
            >
              {showArchived ? 'Show Active' : 'Archived'}
            </button>
          )}
        </div>
      </AppBar>

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
          <option value="__unassigned__">Unassigned</option>
          {(() => {
            const names = new Set<string>();
            board?.columns?.forEach(col => col.cards?.forEach(card => card.assignees?.forEach(a => {
              const name = a.username || a.display_name;
              if (name) names.add(name);
            })));
            return Array.from(names).sort().map(name => <option key={name} value={name}>{name}</option>);
          })()}
        </select>
        {boardLabels.length > 0 && (
          <div className="label-filter-dropdown" ref={labelDropdownRef}>
            <button
              className={`filter-select label-filter-trigger${filterLabel ? ' label-filter-active' : ''}`}
              onClick={() => setLabelDropdownOpen(!labelDropdownOpen)}
              type="button"
            >
              {filterLabel ? (
                <>
                  <span className="label-dot" style={{ background: boardLabels.find(l => l.id === filterLabel)?.color }} />
                  {boardLabels.find(l => l.id === filterLabel)?.name}
                </>
              ) : 'All labels'}
              <span className="filter-chevron">▾</span>
            </button>
            {labelDropdownOpen && (
              <div className="label-filter-menu">
                <button
                  className={`label-filter-option${!filterLabel ? ' selected' : ''}`}
                  onClick={() => { setFilterLabel(''); setLabelDropdownOpen(false); }}
                >
                  All labels
                </button>
                {boardLabels.map(l => (
                  <button
                    key={l.id}
                    className={`label-filter-option${filterLabel === l.id ? ' selected' : ''}`}
                    onClick={() => { setFilterLabel(l.id); setLabelDropdownOpen(false); }}
                  >
                    <span className="label-dot" style={{ background: l.color }} />
                    {l.name}
                  </button>
                ))}
              </div>
            )}
          </div>
        )}
        <select value={filterDue} onChange={(e) => setFilterDue(e.target.value)} className="filter-select">
          <option value="">All dates</option>
          <option value="overdue">Overdue</option>
          <option value="soon">Due soon</option>
          <option value="none">No date</option>
          <option value="overdue-subtasks">Overdue subtasks</option>
        </select>
        {board?.columns && board.columns.length > 0 && (
          <select value={filterColumn} onChange={(e) => setFilterColumn(e.target.value)} className="filter-select">
            <option value="">All lists</option>
            {board.columns.map(col => <option key={col.id} value={col.id}>{col.name}</option>)}
          </select>
        )}
        {board?.custom_fields?.map(field => {
          if (field.field_type === 'dropdown') {
            return (
              <select
                key={field.id}
                value={customFieldFilters[field.id] || ''}
                onChange={(e) => setCustomFieldFilters(prev => ({ ...prev, [field.id]: e.target.value }))}
                className="filter-select"
              >
                <option value="">All {field.name}</option>
                {field.options?.map(opt => (
                  <option key={opt} value={opt}>{opt}</option>
                ))}
              </select>
            );
          }
          if (field.field_type === 'checkbox') {
            return (
              <select
                key={field.id}
                value={customFieldFilters[field.id] || ''}
                onChange={(e) => setCustomFieldFilters(prev => ({ ...prev, [field.id]: e.target.value }))}
                className="filter-select"
              >
                <option value="">{field.name}</option>
                <option value="true">Yes</option>
                <option value="false">No</option>
              </select>
            );
          }
          if (field.field_type === 'text') {
            return (
              <input
                key={field.id}
                type="text"
                value={customFieldFilters[field.id] || ''}
                onChange={(e) => setCustomFieldFilters(prev => ({ ...prev, [field.id]: e.target.value }))}
                placeholder={field.name}
                className="filter-input filter-input-sm"
              />
            );
          }
          return null;
        })}
        {hasFilters && (
          <button onClick={() => { setFilterText(''); setFilterAssignee(''); setFilterLabel(''); setFilterDue(''); setFilterColumn(''); setCustomFieldFilters({}); }} className="btn-secondary btn-sm">
            Clear
          </button>
        )}
      </div>

      <DragDropContext onDragEnd={handleDragEnd}>
        {viewMode === 'calendar' ? (
          <div className="calendar-layout">
            <CalendarView
              board={board}
              onCardClick={handleCalendarCardClick}
              filterCard={filterCard}
              isAdmin={isAdmin}
              isMobile={isMobile}
              onOpenInBoard={handleOpenInBoard}
              onChangeDate={handleCalendarChangeDate}
              onRemoveDate={handleCalendarRemoveDate}
            />
          </div>
        ) : viewMode === 'table' ? (
          <TableView
            board={board}
            filterCard={filterCard}
            isAdmin={isAdmin}
            onCardUpdate={() => { loadBoard(); socket?.emit('board-updated', boardId); }}
            onCardClick={(cardId) => handleOpenInBoard(cardId)}
            boardMembers={boardMembers}
          />
        ) : viewMode === 'timeline' ? (
          <TimelineView
            board={board}
            filterCard={filterCard}
            isAdmin={isAdmin}
            isMobile={isMobile}
            onCardUpdate={() => { loadBoard(); socket?.emit('board-updated', boardId); }}
            onCardClick={(cardId) => { handleOpenInBoard(cardId); }}
          />
        ) : viewMode === 'dashboard' ? (
          <DashboardView
            boardId={boardId}
            refreshKey={refreshKey}
            onFilterNavigate={handleDashboardFilterNavigate}
          />
        ) : (
          <Droppable droppableId="board" direction="horizontal" type="COLUMN" isDropDisabled={!isAdmin}>
            {(provided) => (
              <div className="columns-container" {...provided.droppableProps} ref={provided.innerRef}>
                {board.columns?.filter(col => !filterColumn || col.id === filterColumn).map((column, index) => {
                  const visibleCards = column.cards?.filter(filterCard) || [];
                  return (
                    <Draggable key={column.id} draggableId={column.id} index={index} isDragDisabled={!isAdmin || isMobile}>
                      {(provided) => (
                        <div className="column" ref={provided.innerRef} {...provided.draggableProps}>
                          <div className="column-header" {...(!isMobile ? provided.dragHandleProps : {})}>
                            {renamingColumnId === column.id ? (
                              <input
                                className="column-rename-input"
                                value={renameColumnValue}
                                onChange={(e) => setRenameColumnValue(e.target.value)}
                                onBlur={() => handleRenameColumn(column.id)}
                                onKeyDown={(e) => {
                                  if (e.key === 'Enter') handleRenameColumn(column.id);
                                  if (e.key === 'Escape') { setRenamingColumnId(null); setRenameColumnValue(''); }
                                }}
                                autoFocus
                                onClick={(e) => e.stopPropagation()}
                                maxLength={255}
                              />
                            ) : (
                              <h3>{column.name}</h3>
                            )}
                            <div className="column-header-actions">
                              <span className="card-count">{visibleCards.length}</span>
                              {isAdmin && (
                                <div className="column-kebab" ref={columnMenuId === column.id ? columnMenuRef : undefined}>
                                  <button
                                    className="btn-icon btn-column-kebab"
                                    onClick={(e) => { e.stopPropagation(); setColumnMenuId(columnMenuId === column.id ? null : column.id); }}
                                    title="Column actions"
                                  >
                                    <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><circle cx="12" cy="5" r="2"/><circle cx="12" cy="12" r="2"/><circle cx="12" cy="19" r="2"/></svg>
                                  </button>
                                  {columnMenuId === column.id && (
                                    <div className="kebab-dropdown column-kebab-dropdown">
                                      <button onClick={(e) => {
                                        e.stopPropagation();
                                        setColumnMenuId(null);
                                        setRenameColumnValue(column.name);
                                        setRenamingColumnId(column.id);
                                      }}>Rename</button>
                                      <div className="kebab-divider" />
                                      <button className="kebab-danger" onClick={(e) => { e.stopPropagation(); handleDeleteColumn(column.id, column.name); }}>Delete</button>
                                    </div>
                                  )}
                                </div>
                              )}
                            </div>
                          </div>

                          <Droppable droppableId={column.id} type="CARD" isDropDisabled={!isAdmin || showArchived}>
                            {(provided) => (
                              <div className="cards-list" {...provided.droppableProps} ref={provided.innerRef}>
                                {visibleCards.map((card, cardIndex) => (
                                  <Draggable key={card.id} draggableId={card.id} index={cardIndex} isDragDisabled={!isAdmin || showArchived || isMobile}>
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
                                            userRole={userRole}
                                            isEditing={editingCardId === card.id}
                                            isSelected={selectedCardIds.has(card.id)}
                                            selectionActive={selectedCardIds.size > 0}
                                            onToggleSelect={userRole !== 'READ' ? toggleCardSelection : undefined}
                                            onEditStart={() => openCard(card.id)}
                                            onEditEnd={closeCard}
                                            onDelete={() => handleDeleteCard(card.id)}
                                            onArchive={() => handleArchiveCard(card.id)}
                                            onUpdate={(updates) => handleUpdateCard(card.id, updates)}
                                            boardLabels={boardLabels}
                                            boardId={boardId}
                                            isMobile={isMobile}
                                            columns={board?.columns}
                                            onMoveToColumn={handleMoveToColumn}
                                            boardMembers={boardMembers}
                                            customFields={board?.custom_fields}
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
                              <form onSubmit={(e) => handleCreateCard(e, column.id)} className="new-card-form" ref={newCardFormRef}>
                                <input type="text" value={newCardTitle} onChange={(e) => setNewCardTitle(e.target.value)} placeholder="Card title..." autoFocus required maxLength={255} />
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
        )}
      </DragDropContext>

      {editingCardId && viewMode !== 'board' && (() => {
        const editCard = board.columns?.flatMap(c => c.cards || []).find(c => c.id === editingCardId);
        if (!editCard) return null;
        return (
          <KanbanCard
            card={editCard}
            userRole={userRole}
            isEditing={true}
            onEditStart={() => {}}
            onEditEnd={closeCard}
            onDelete={() => handleDeleteCard(editCard.id)}
            onArchive={() => handleArchiveCard(editCard.id)}
            onUpdate={(updates) => handleUpdateCard(editCard.id, updates)}
            boardLabels={boardLabels}
            boardId={boardId}
            isMobile={true}
            columns={board?.columns}
            onMoveToColumn={handleMoveToColumn}
            boardMembers={boardMembers}
            customFields={board?.custom_fields}
          />
        );
      })()}

      {showNewColumn && (
        <div className="modal-overlay modal-overlay-centered" onClick={() => setShowNewColumn(false)}>
          <div className="modal modal-centered" onClick={(e) => e.stopPropagation()}>
            <h2>New Column</h2>
            <form onSubmit={handleCreateColumn}>
              <div className="form-group">
                <label htmlFor="column-name">Column Name</label>
                <input type="text" id="column-name" value={newColumnName} onChange={(e) => setNewColumnName(e.target.value)} required autoFocus maxLength={255} />
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
      {showLabels && (
        <BoardLabels
          boardId={boardId}
          onClose={() => { setShowLabels(false); loadLabels(); loadBoard(); }}
        />
      )}
      {showFieldManager && board && (
        <CustomFieldManager
          boardId={board.id}
          fields={board.custom_fields || []}
          onClose={() => setShowFieldManager(false)}
          onFieldsChanged={() => { loadBoard(); setShowFieldManager(false); }}
        />
      )}
      {showCsvImport && (
        <CSVImportModal
          boardId={boardId}
          onClose={() => setShowCsvImport(false)}
          onImportComplete={() => loadBoard()}
        />
      )}
      {exportStatus && (
        <div className="csv-toast">{exportStatus}</div>
      )}
      {selectedCardIds.size > 0 && userRole !== 'READ' && (
        <BulkActionToolbar
          selectedCount={selectedCardIds.size}
          totalVisible={totalVisibleCards}
          columns={board.columns || []}
          boardLabels={boardLabels}
          boardMembers={boardMembers}
          onMoveToColumn={handleBulkMoveToColumn}
          onAssignMember={handleBulkAssignMember}
          onAssignLabel={handleBulkAssignLabel}
          onArchive={handleBulkArchive}
          onDelete={handleBulkDelete}
          onSelectAll={selectAllVisible}
          onClearSelection={clearSelection}
          allSelected={allVisibleSelected}
        />
      )}
    </div>
  );
}
