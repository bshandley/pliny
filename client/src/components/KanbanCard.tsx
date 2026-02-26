import { useState, useRef, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { Card, CardAssignee, Column, Label, Comment, ChecklistItem, ActivityEntry, BoardMember, CustomField, CustomFieldValue, Attachment, CardRelations } from '../types';
import { api } from '../api';
import { useConfirm } from '../contexts/ConfirmContext';
import MentionText from './MentionText';
import CustomFieldEditor from './CustomFieldEditor';
import MarkdownRenderer from './MarkdownRenderer';

interface KanbanCardProps {
  card: Card;
  userRole: 'READ' | 'COLLABORATOR' | 'ADMIN';
  isEditing: boolean;
  onEditStart: () => void;
  onEditEnd: () => void;
  onDelete: () => void;
  onArchive: () => void;
  onUpdate: (updates: Partial<Card>) => void;
  boardLabels?: Label[];
  boardId: string;
  isMobile?: boolean;
  columns?: Column[];
  onMoveToColumn?: (cardId: string, columnId: string) => void;
  boardMembers?: BoardMember[];
  customFields?: CustomField[];
}

function getDueBadge(dueDateStr: string): { label: string; className: string } | null {
  if (!dueDateStr || dueDateStr.trim() === '') return null;
  const dateOnly = dueDateStr.split(' ')[0].split('T')[0];
  const parts = dateOnly.split('-');
  if (parts.length !== 3) return null;
  const year = parseInt(parts[0]);
  const month = parseInt(parts[1]) - 1;
  const day = parseInt(parts[2]);
  if (isNaN(year) || isNaN(month) || isNaN(day)) return null;
  const due = new Date(year, month, day, 12, 0, 0);
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 12, 0, 0);
  const daysDiff = Math.round((due.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));
  if (daysDiff < 0) return { label: 'Overdue', className: 'due-badge due-overdue' };
  if (daysDiff === 0) return { label: 'Today', className: 'due-badge due-soon' };
  if (daysDiff === 1) return { label: 'Tomorrow', className: 'due-badge due-soon' };
  const monthStr = due.toLocaleString('en-US', { month: 'short' });
  return { label: `${monthStr} ${day}`, className: 'due-badge' };
}

function timeAgo(dateStr: string): string {
  const now = Date.now();
  const then = new Date(dateStr).getTime();
  const secs = Math.floor((now - then) / 1000);
  if (secs < 60) return 'just now';
  const mins = Math.floor(secs / 60);
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  return `${days}d ago`;
}

function formatActivity(action: string, detail: Record<string, any> | null): string {
  switch (action) {
    case 'created': return 'created this card';
    case 'moved': return `moved this card from ${detail?.from_column} to ${detail?.to_column}`;
    case 'archived': return 'archived this card';
    case 'unarchived': return 'restored this card';
    case 'title_changed': return `renamed this card from "${detail?.from}" to "${detail?.to}"`;
    case 'description_changed': return 'updated the description';
    case 'assignees_changed': {
      const parts: string[] = [];
      if (detail?.added?.length) parts.push(`added ${detail.added.join(', ')}`);
      if (detail?.removed?.length) parts.push(`removed ${detail.removed.join(', ')}`);
      return parts.join(' and ') || 'changed assignees';
    }
    case 'members_changed': {
      const parts: string[] = [];
      if (detail?.added?.length) parts.push(`added ${detail.added.join(', ')}`);
      if (detail?.removed?.length) parts.push(`removed ${detail.removed.join(', ')}`);
      return parts.join(' and ') || 'changed members';
    }
    case 'labels_changed': return 'changed labels';
    case 'due_date_changed': {
      if (!detail?.from && detail?.to) return `set due date to ${detail.to}`;
      if (detail?.from && !detail?.to) return 'removed the due date';
      return `changed due date from ${detail?.from} to ${detail?.to}`;
    }
    case 'start_date_changed': {
      if (!detail?.from && detail?.to) return `set start date to ${detail.to}`;
      if (detail?.from && !detail?.to) return 'removed the start date';
      return `changed start date from ${detail?.from} to ${detail?.to}`;
    }
    default: return action.replace(/_/g, ' ');
  }
}

function formatFieldBadge(field: CustomField, value: string): string {
  switch (field.field_type) {
    case 'text': return value.length > 20 ? value.slice(0, 20) + '...' : value;
    case 'number': return value;
    case 'date': {
      const d = new Date(value + 'T12:00:00');
      return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
    }
    case 'dropdown': return value;
    case 'checkbox': return value === 'true' ? '\u2713' : '\u2717';
    default: return value;
  }
}

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
  return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
}

function getFileIcon(mimeType: string): string {
  if (mimeType.startsWith('image/')) return '\uD83D\uDDBC\uFE0F';
  if (mimeType.startsWith('video/')) return '\uD83C\uDFA5';
  if (mimeType.startsWith('audio/')) return '\uD83C\uDFB5';
  if (mimeType.includes('pdf')) return '\uD83D\uDCC4';
  if (mimeType.includes('spreadsheet') || mimeType.includes('excel') || mimeType.includes('csv')) return '\uD83D\uDCCA';
  if (mimeType.includes('document') || mimeType.includes('word') || mimeType.includes('text')) return '\uD83D\uDCC3';
  return '\uD83D\uDCCE';
}

const AVATAR_COLORS = ['#5746af','#2f855a','#c53030','#d69e2e','#3182ce','#805ad5','#d53f8c','#319795','#dd6b20','#667eea'];
function avatarColor(name: string): string {
  let hash = 0;
  for (let i = 0; i < name.length; i++) hash = name.charCodeAt(i) + ((hash << 5) - hash);
  return AVATAR_COLORS[Math.abs(hash) % AVATAR_COLORS.length];
}
function avatarInitial(name: string): string {
  return (name || '?').charAt(0).toUpperCase();
}

export default function KanbanCard({ card, userRole, isEditing, onEditStart, onEditEnd, onDelete, onArchive, onUpdate, boardLabels = [], boardId, isMobile = false, columns = [], onMoveToColumn, boardMembers = [], customFields = [] }: KanbanCardProps) {
  const canWrite = userRole === 'ADMIN';
  const canComment = userRole === 'ADMIN' || userRole === 'COLLABORATOR';
  const confirm = useConfirm();
  const [editTitle, setEditTitle] = useState(card.title);
  const [editDescription, setEditDescription] = useState(card.description || '');
  const [editDueDate, setEditDueDate] = useState(card.due_date ? card.due_date.split(' ')[0].split('T')[0] : '');
  const [editStartDate, setEditStartDate] = useState(card.start_date ? card.start_date.split(' ')[0].split('T')[0] : '');
  const [editAssignees, setEditAssignees] = useState<CardAssignee[]>(card.assignees || []);
  const [editLabels, setEditLabels] = useState<string[]>(card.labels?.map(l => l.id) || []);
  const [showAutocomplete, setShowAutocomplete] = useState(false);
  const [autocompleteFilter, setAutocompleteFilter] = useState('');
  const [selectedIndex, setSelectedIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const cardRef = useRef<HTMLDivElement>(null);

  // Comments state
  const [comments, setComments] = useState<Comment[]>([]);
  const [newComment, setNewComment] = useState('');
  const [loadingComments, setLoadingComments] = useState(false);

  // Checklist state
  const [checklistItems, setChecklistItems] = useState<ChecklistItem[]>([]);
  const [newChecklistItem, setNewChecklistItem] = useState('');
  const [loadingChecklist, setLoadingChecklist] = useState(false);
  const [showChecklist, setShowChecklist] = useState(!!(card.checklist && card.checklist.total > 0));
  const [showComments, setShowComments] = useState(false);
  const [assigneeDropdownItemId, setAssigneeDropdownItemId] = useState<string | null>(null);

  // Comment @mention state
  const [commentMentionActive, setCommentMentionActive] = useState(false);
  const [commentMentionFilter, setCommentMentionFilter] = useState('');
  const [commentMentionIndex, setCommentMentionIndex] = useState(0);
  const commentInputRef = useRef<HTMLTextAreaElement>(null);

  // Activity state
  const [activityEntries, setActivityEntries] = useState<ActivityEntry[]>([]);
  const [loadingActivity, setLoadingActivity] = useState(false);
  const [showActivity, setShowActivity] = useState(false);

  // Attachments state
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [loadingAttachments, setLoadingAttachments] = useState(false);
  const [showAttachments, setShowAttachments] = useState(false);
  const [uploadProgress, setUploadProgress] = useState<number | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Relations state
  const [relations, setRelations] = useState<CardRelations>({ blocks: [], blocked_by: [], relates_to: [] });
  const [showRelations, setShowRelations] = useState(false);
  const [relationSearch, setRelationSearch] = useState('');
  const [relationSearchResults, setRelationSearchResults] = useState<{ id: string; title: string; column_name: string; board_name: string }[]>([]);
  const [relationTypeSelect, setRelationTypeSelect] = useState<'blocks' | 'blocked_by' | 'relates_to'>('blocks');
  const relationSearchTimeout = useRef<ReturnType<typeof setTimeout> | null>(null);

  const _tokenPayload = api.getToken() ? JSON.parse(atob(api.getToken()!.split('.')[1])) : null;
  const userId = _tokenPayload?.id ?? null;
  const currentUsername: string = _tokenPayload?.username ?? '?';

  // Card overflow menu state
  const [showCardMenu, setShowCardMenu] = useState(false);
  const [cardMenuPos, setCardMenuPos] = useState<{ top: number; left: number } | null>(null);
  const cardMenuRef = useRef<HTMLDivElement>(null);
  const cardMenuBtnRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    setEditTitle(card.title);
    setEditDescription(card.description || '');
    setEditDueDate(card.due_date ? card.due_date.split(' ')[0].split('T')[0] : '');
    setEditAssignees(card.assignees || []);
    setEditLabels(card.labels?.map(l => l.id) || []);
  }, [card.title, card.description, card.due_date, card.assignees, card.labels]);

  useEffect(() => {
    if (isEditing) {
      loadComments();
      loadChecklist();
      loadActivity();
      loadAttachments();
      loadRelations();
    } else {
      setShowCardMenu(false);
    }
  }, [isEditing]);

  // Load relations on mount for the "Blocked" badge on card face
  useEffect(() => {
    loadRelations();
  }, [card.id]);

  const loadComments = async () => {
    setLoadingComments(true);
    try {
      const data = await api.getCardComments(card.id);
      setComments(data);
      if (data.length > 0) setShowComments(true);
    } catch (err) {
      console.error('Failed to load comments:', err);
    } finally {
      setLoadingComments(false);
    }
  };

  const loadChecklist = async () => {
    setLoadingChecklist(true);
    try {
      const data = await api.getCardChecklist(card.id);
      setChecklistItems(data);
      if (data.length > 0) setShowChecklist(true);
    } catch (err) {
      console.error('Failed to load checklist:', err);
    } finally {
      setLoadingChecklist(false);
    }
  };

  const loadActivity = async () => {
    setLoadingActivity(true);
    try {
      const data = await api.getCardActivity(card.id);
      setActivityEntries(data);
    } catch (err) {
      console.error('Failed to load activity:', err);
    } finally {
      setLoadingActivity(false);
    }
  };

  const loadAttachments = async () => {
    setLoadingAttachments(true);
    try {
      const data = await api.getAttachments(card.id);
      setAttachments(data);
      if (data.length > 0) setShowAttachments(true);
    } catch (err) {
      console.error('Failed to load attachments:', err);
    } finally {
      setLoadingAttachments(false);
    }
  };

  const loadRelations = async () => {
    try {
      const data = await api.getCardRelations(card.id);
      setRelations(data);
      if (data.blocks.length > 0 || data.blocked_by.length > 0 || data.relates_to.length > 0) {
        setShowRelations(true);
      }
    } catch (err) {
      console.error('Failed to load relations:', err);
    }
  };

  const handleAddRelation = async (targetCardId: string) => {
    try {
      await api.addCardRelation(card.id, targetCardId, relationTypeSelect);
      setRelationSearch('');
      setRelationSearchResults([]);
      await loadRelations();
    } catch (err: any) {
      console.error('Failed to add relation:', err);
    }
  };

  const handleRemoveRelation = async (targetCardId: string) => {
    try {
      await api.deleteCardRelation(card.id, targetCardId);
      await loadRelations();
    } catch (err: any) {
      console.error('Failed to remove relation:', err);
    }
  };

  // Client-side card search for relations
  useEffect(() => {
    if (relationSearchTimeout.current) clearTimeout(relationSearchTimeout.current);
    if (!relationSearch.trim()) {
      setRelationSearchResults([]);
      return;
    }
    relationSearchTimeout.current = setTimeout(() => {
      const q = relationSearch.toLowerCase();
      const results: { id: string; title: string; column_name: string; board_name: string }[] = [];
      for (const col of columns) {
        for (const c of col.cards || []) {
          if (c.id !== card.id && c.title.toLowerCase().includes(q)) {
            results.push({ id: c.id, title: c.title, column_name: col.name, board_name: '' });
          }
        }
      }
      setRelationSearchResults(results.slice(0, 10));
    }, 200);
    return () => { if (relationSearchTimeout.current) clearTimeout(relationSearchTimeout.current); };
  }, [relationSearch, columns, card.id]);

  const handleFileUpload = async (file: File) => {
    setUploadProgress(0);
    try {
      const attachment = await api.uploadAttachment(card.id, file, setUploadProgress);
      setAttachments(prev => [attachment, ...prev]);
      setShowAttachments(true);
    } catch (err: any) {
      alert(err.message || 'Upload failed');
    } finally {
      setUploadProgress(null);
    }
  };

  const handleFileDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    const files = Array.from(e.dataTransfer.files);
    files.forEach(f => handleFileUpload(f));
  };

  const handleDeleteAttachment = async (id: string) => {
    try {
      await api.deleteAttachment(id);
      setAttachments(prev => prev.filter(a => a.id !== id));
    } catch (err) {
      console.error('Failed to delete attachment:', err);
    }
  };

  const handlePaste = (e: React.ClipboardEvent) => {
    const items = Array.from(e.clipboardData.items);
    for (const item of items) {
      if (item.type.startsWith('image/')) {
        const file = item.getAsFile();
        if (file) {
          e.preventDefault();
          handleFileUpload(file);
          break;
        }
      }
    }
  };


  const handleSaveDescription = () => {
    onUpdate({ description: editDescription });
  };

  const handleClose = () => {
    if (editDescription !== (card.description || '')) {
      if (!window.confirm('You have unsaved description changes. Discard?')) return;
      setEditDescription(card.description || '');
    }
    onEditEnd();
  };

  const handleCloseRef = useRef(handleClose);
  useEffect(() => { handleCloseRef.current = handleClose; });

  // Close edit/detail panel when clicking outside the card
  useEffect(() => {
    if (!isEditing || isMobile) return;
    const handleClickOutside = (e: MouseEvent) => {
      if (cardRef.current && !cardRef.current.contains(e.target as Node)) {
        if (canWrite) {
          handleCloseRef.current();
        } else {
          onEditEnd();
        }
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [isEditing, isMobile, canWrite]);

  // Close card overflow menu on outside click or scroll
  useEffect(() => {
    if (!showCardMenu) return;
    const handleClick = (e: MouseEvent) => {
      const target = e.target as Node;
      if (cardMenuRef.current?.contains(target)) return;
      if (cardMenuBtnRef.current?.contains(target)) return;
      setShowCardMenu(false);
    };
    const handleScroll = () => setShowCardMenu(false);
    document.addEventListener('mousedown', handleClick);
    document.addEventListener('scroll', handleScroll, true);
    return () => {
      document.removeEventListener('mousedown', handleClick);
      document.removeEventListener('scroll', handleScroll, true);
    };
  }, [showCardMenu]);


  const handleCustomFieldChange = async (fieldId: string, value: string | null) => {
    try {
      await api.setCardCustomFields(card.id, { [fieldId]: value });
      onUpdate({});
    } catch (err) {
      console.error('Failed to update custom field:', err);
    }
  };

  const handleAssigneeInputChange = (value: string) => {
    if (value.startsWith('@')) {
      setAutocompleteFilter(value.substring(1));
      setShowAutocomplete(true);
      setSelectedIndex(0);
    } else {
      setAutocompleteFilter(value);
      if (value === '') setShowAutocomplete(false);
    }
  };

  const addAssignee = (assignee: CardAssignee) => {
    const isDup = editAssignees.some(a =>
      (assignee.user_id && a.user_id === assignee.user_id) ||
      (!assignee.user_id && a.display_name === assignee.display_name)
    );
    if (isDup) return;
    const updated = [...editAssignees, assignee];
    setEditAssignees(updated);
    onUpdate({ assignees: updated } as any);
    setShowAutocomplete(false);
    setAutocompleteFilter('');
    if (inputRef.current) inputRef.current.value = '';
  };

  const removeAssignee = (assignee: CardAssignee) => {
    const updated = editAssignees.filter(a =>
      assignee.user_id ? a.user_id !== assignee.user_id : a.display_name !== assignee.display_name
    );
    setEditAssignees(updated);
    onUpdate({ assignees: updated } as any);
  };

  const toggleLabel = (labelId: string) => {
    const newLabels = editLabels.includes(labelId) ? editLabels.filter(id => id !== labelId) : [...editLabels, labelId];
    setEditLabels(newLabels);
    onUpdate({ labels: newLabels as any });
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (showAutocomplete) {
      const filterLower = autocompleteFilter.toLowerCase();
      const assignedUserIds = new Set(editAssignees.filter(a => a.user_id).map(a => a.user_id));
      const assignedNames = new Set(editAssignees.filter(a => !a.user_id).map(a => a.display_name?.toLowerCase()));

      const filteredMembersList = boardMembers.filter(m =>
        m.username.toLowerCase().includes(filterLower) &&
        !assignedUserIds.has(m.id)
      );

      const exactMemberMatch = boardMembers.some(m => m.username.toLowerCase() === filterLower);
      const alreadyAssignedAsName = assignedNames.has(filterLower);
      const alreadyAssignedAsMember = assignedUserIds.has(
        boardMembers.find(m => m.username.toLowerCase() === filterLower)?.id || ''
      );
      const showFreeText = autocompleteFilter.trim() && !exactMemberMatch && !alreadyAssignedAsName && !alreadyAssignedAsMember;

      const totalItems = filteredMembersList.length + (showFreeText ? 1 : 0);
      if (totalItems > 0) {
        if (e.key === 'ArrowDown') { e.preventDefault(); setSelectedIndex(prev => Math.min(prev + 1, totalItems - 1)); }
        else if (e.key === 'ArrowUp') { e.preventDefault(); setSelectedIndex(prev => Math.max(prev - 1, 0)); }
        else if (e.key === 'Enter' || e.key === 'Tab') {
          e.preventDefault();
          if (selectedIndex < filteredMembersList.length) {
            addAssignee({ id: '', user_id: filteredMembersList[selectedIndex].id, username: filteredMembersList[selectedIndex].username, display_name: null });
          } else if (showFreeText) {
            addAssignee({ id: '', user_id: null, username: null, display_name: autocompleteFilter.trim() });
          }
        }
        else if (e.key === 'Escape') { setShowAutocomplete(false); setAutocompleteFilter(''); }
        return;
      }
    }
    if (e.key === 'Enter') {
      const input = inputRef.current?.value.trim();
      if (input && input !== '') {
        e.preventDefault();
        const name = input.startsWith('@') ? input.substring(1) : input;
        const existingMember = boardMembers.find(m => m.username.toLowerCase() === name.toLowerCase());
        if (existingMember) {
          addAssignee({ id: '', user_id: existingMember.id, username: existingMember.username, display_name: null });
        } else {
          addAssignee({ id: '', user_id: null, username: null, display_name: name });
        }
      }
    }
  };

  const handleAddComment = async () => {
    if (!newComment.trim()) return;
    try {
      const comment = await api.addCardComment(card.id, newComment.trim());
      setComments([...comments, comment]);
      setNewComment('');
    } catch (err) {
      console.error('Failed to add comment:', err);
    }
  };

  const handleDeleteComment = async (id: string) => {
    try {
      await api.deleteComment(id);
      setComments(comments.filter(c => c.id !== id));
    } catch (err) {
      console.error('Failed to delete comment:', err);
    }
  };

  const handleAddChecklistItem = async () => {
    if (!newChecklistItem.trim()) return;
    try {
      const item = await api.addChecklistItem(card.id, newChecklistItem.trim());
      setChecklistItems([...checklistItems, item]);
      setNewChecklistItem('');
    } catch (err) {
      console.error('Failed to add checklist item:', err);
    }
  };

  const handleToggleChecklistItem = async (item: ChecklistItem) => {
    try {
      const updated = await api.updateChecklistItem(item.id, { checked: !item.checked });
      setChecklistItems(checklistItems.map(i => i.id === item.id ? updated : i));
    } catch (err) {
      console.error('Failed to toggle checklist item:', err);
    }
  };

  const handleDeleteChecklistItem = async (id: string) => {
    try {
      await api.deleteChecklistItem(id);
      setChecklistItems(checklistItems.filter(i => i.id !== id));
    } catch (err) {
      console.error('Failed to delete checklist item:', err);
    }
  };

  const handleChecklistItemUpdate = async (itemId: string, updates: Partial<ChecklistItem>) => {
    try {
      const updated = await api.updateChecklistItem(itemId, updates);
      setChecklistItems(checklistItems.map(i => i.id === itemId ? updated : i));
    } catch (err) {
      console.error('Failed to update checklist item:', err);
    }
  };

  const cyclePriority = (item: ChecklistItem) => {
    const cycle: (string | null)[] = [null, 'low', 'medium', 'high'];
    const currentIdx = cycle.indexOf(item.priority || null);
    const next = cycle[(currentIdx + 1) % cycle.length];
    handleChecklistItemUpdate(item.id, { priority: next } as any);
  };

  const openChecklistDatePicker = (itemId: string, currentDate?: string | null, event?: React.MouseEvent) => {
    const input = document.createElement('input');
    input.type = 'date';
    const normalized = currentDate ? currentDate.split('T')[0].split(' ')[0] : '';
    if (normalized) input.value = normalized;
    input.style.position = 'fixed';
    input.style.opacity = '0';
    input.style.pointerEvents = 'none';
    if (event) {
      const rect = (event.currentTarget as HTMLElement).getBoundingClientRect();
      input.style.top = `${rect.bottom}px`;
      input.style.left = `${rect.left}px`;
    }
    document.body.appendChild(input);
    input.addEventListener('change', () => {
      handleChecklistItemUpdate(itemId, { due_date: input.value || null } as any);
      if (document.body.contains(input)) document.body.removeChild(input);
    });
    input.addEventListener('blur', () => {
      setTimeout(() => {
        if (document.body.contains(input)) document.body.removeChild(input);
      }, 200);
    });
    input.showPicker();
  };

  const handleCommentChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const value = e.target.value;
    setNewComment(value);

    const cursorPos = e.target.selectionStart || value.length;
    const textUpToCursor = value.substring(0, cursorPos);
    const lastAtIndex = textUpToCursor.lastIndexOf('@');

    if (lastAtIndex >= 0) {
      const charBefore = lastAtIndex > 0 ? textUpToCursor[lastAtIndex - 1] : ' ';
      if (charBefore === ' ' || charBefore === '\n' || lastAtIndex === 0) {
        const filterText = textUpToCursor.substring(lastAtIndex + 1);
        if (!/\s/.test(filterText)) {
          setCommentMentionActive(true);
          setCommentMentionFilter(filterText);
          setCommentMentionIndex(0);
          return;
        }
      }
    }
    setCommentMentionActive(false);
  };

  const handleCommentMentionSelect = (name: string) => {
    const cursorPos = commentInputRef.current?.selectionStart || newComment.length;
    const textUpToCursor = newComment.substring(0, cursorPos);
    const lastAtIndex = textUpToCursor.lastIndexOf('@');
    const before = newComment.substring(0, lastAtIndex);
    const after = newComment.substring(cursorPos);
    setNewComment(`${before}@${name} ${after}`);
    setCommentMentionActive(false);
  };

  const getCommentMentionItems = () => {
    const filter = commentMentionFilter.toLowerCase();
    const members = boardMembers.filter(m =>
      m.username.toLowerCase().includes(filter)
    );
    return { members };
  };

  const handleCommentKeyDown = (e: React.KeyboardEvent) => {
    if (commentMentionActive) {
      const { members } = getCommentMentionItems();
      const totalItems = members.length;
      if (totalItems > 0) {
        if (e.key === 'ArrowDown') {
          e.preventDefault();
          setCommentMentionIndex(prev => Math.min(prev + 1, totalItems - 1));
          return;
        }
        if (e.key === 'ArrowUp') {
          e.preventDefault();
          setCommentMentionIndex(prev => Math.max(prev - 1, 0));
          return;
        }
        if (e.key === 'Enter' || e.key === 'Tab') {
          e.preventDefault();
          if (commentMentionIndex < members.length) {
            handleCommentMentionSelect(members[commentMentionIndex].username);
          }
          return;
        }
        if (e.key === 'Escape') {
          setCommentMentionActive(false);
          return;
        }
      }
    }
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleAddComment();
    }
  };

  // Shared edit form fields (used by both inline and fullscreen)
  const renderEditFields = () => (
    <>
      <input
        type="text"
        value={editTitle}
        onChange={(e) => setEditTitle(e.target.value)}
        className="card-edit-title"
        placeholder="Card title"
        autoFocus={!isMobile}
        onBlur={() => {
          if (editTitle.trim() && editTitle !== card.title) {
            onUpdate({ title: editTitle });
          }
        }}
        onKeyDown={(e) => {
          if (!isMobile && e.key === 'Enter' && !e.shiftKey && !showAutocomplete) { e.preventDefault(); (e.target as HTMLInputElement).blur(); }
          else if (!isMobile && e.key === 'Escape') handleClose();
        }}
        maxLength={255}
      />

      {/* Labels */}
      {boardLabels.length > 0 && (
        <div className="label-picker">
          {boardLabels.map(label => (
            <button
              key={label.id}
              type="button"
              className={`label-toggle ${editLabels.includes(label.id) ? 'selected' : ''}`}
              style={{ '--label-color': label.color } as React.CSSProperties}
              onClick={() => toggleLabel(label.id)}
            >
              {label.name}
            </button>
          ))}
        </div>
      )}

      {/* Assignees */}
      <div className="assignee-picker">
        {editAssignees.length > 0 && (
          <div className="assignee-chips">
            {editAssignees.map((assignee, index) => (
              <div key={assignee.user_id || assignee.display_name || index} className={`assignee-chip${assignee.user_id ? ' member-chip' : ''}`}>
                <span className="chip-name">{assignee.username || assignee.display_name}</span>
                <button type="button" onClick={() => removeAssignee(assignee)} className="chip-remove" aria-label="Remove">×</button>
              </div>
            ))}
          </div>
        )}
        <div className="assignee-input-wrapper">
          <input ref={inputRef} type="text" onChange={(e) => handleAssigneeInputChange(e.target.value)} onKeyDown={handleKeyDown} placeholder="Type @ to assign..." className="assignee-input" maxLength={100} />
          {(() => {
            const filterLower = autocompleteFilter.toLowerCase();
            const assignedUserIds = new Set(editAssignees.filter(a => a.user_id).map(a => a.user_id));
            const assignedNames = new Set(editAssignees.filter(a => !a.user_id).map(a => a.display_name?.toLowerCase()));

            const filteredMembers = boardMembers.filter(m =>
              m.username.toLowerCase().includes(filterLower) &&
              !assignedUserIds.has(m.id)
            );

            const exactMemberMatch = boardMembers.some(m => m.username.toLowerCase() === filterLower);
            const alreadyAssignedAsName = assignedNames.has(filterLower);
            const alreadyAssignedAsMember = assignedUserIds.has(
              boardMembers.find(m => m.username.toLowerCase() === filterLower)?.id || ''
            );
            const showFreeText = autocompleteFilter.trim() && !exactMemberMatch && !alreadyAssignedAsName && !alreadyAssignedAsMember;

            if (!showAutocomplete || (filteredMembers.length === 0 && !showFreeText)) return null;

            return (
              <div className="mention-autocomplete">
                {filteredMembers.map((member, index) => (
                  <div key={member.id}
                    className={`mention-item${index === selectedIndex ? ' selected' : ''}`}
                    onClick={() => addAssignee({ id: '', user_id: member.id, username: member.username, display_name: null })}
                    onMouseEnter={() => setSelectedIndex(index)}>
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>
                    {member.username}
                  </div>
                ))}
                {showFreeText && (
                  <div
                    className={`mention-item mention-item-freetext${filteredMembers.length === selectedIndex ? ' selected' : ''}`}
                    onClick={() => addAssignee({ id: '', user_id: null, username: null, display_name: autocompleteFilter.trim() })}
                    onMouseEnter={() => setSelectedIndex(filteredMembers.length)}>
                    Add "{autocompleteFilter.trim()}"
                  </div>
                )}
              </div>
            );
          })()}
        </div>
      </div>

      {/* Move to column (mobile only) */}
      {isMobile && columns.length > 1 && onMoveToColumn && (
        <div className="card-move-to">
          <label htmlFor={`move-to-${card.id}`}>Move to</label>
          <select
            id={`move-to-${card.id}`}
            value={card.column_id}
            onChange={(e) => {
              if (e.target.value !== card.column_id) {
                onMoveToColumn(card.id, e.target.value);
              }
            }}
            className="move-to-select"
          >
            {columns.map(col => (
              <option key={col.id} value={col.id}>{col.name}</option>
            ))}
          </select>
        </div>
      )}

      <textarea value={editDescription} onChange={(e) => setEditDescription(e.target.value)} placeholder="Description (optional)" className="card-edit-description" rows={3} maxLength={10000}
        onKeyDown={(e) => {
          if (!isMobile && e.key === 'Escape') { e.preventDefault(); handleClose(); }
        }}
      />
      {editDescription !== (card.description || '') && (
        <button type="button" onClick={handleSaveDescription} className="btn-secondary btn-sm" style={{ alignSelf: 'flex-start', marginTop: 0, marginBottom: '0.5rem' }}>Save description</button>
      )}

      <div className="date-range-picker">
        <div className="due-date-picker">
          <label htmlFor={`start-date-${card.id}`}>Start date</label>
          <div className="due-date-input-row">
            <input type="date" id={`start-date-${card.id}`} value={editStartDate} onChange={(e) => { setEditStartDate(e.target.value); onUpdate({ start_date: e.target.value || null }); }} className="due-date-input" />
            {editStartDate && (
              <button type="button" onClick={() => { setEditStartDate(''); onUpdate({ start_date: null }); }} className="btn-icon btn-sm due-date-clear" aria-label="Clear start date">×</button>
            )}
          </div>
        </div>
        <div className="due-date-picker">
          <label htmlFor={`due-date-${card.id}`}>Due date</label>
          <div className="due-date-input-row">
            <input type="date" id={`due-date-${card.id}`} value={editDueDate} onChange={(e) => { setEditDueDate(e.target.value); onUpdate({ due_date: e.target.value || null }); }} className="due-date-input" />
            {editDueDate && (
              <button type="button" onClick={() => { setEditDueDate(''); onUpdate({ due_date: null }); }} className="btn-icon btn-sm due-date-clear" aria-label="Clear due date">×</button>
            )}
          </div>
        </div>
      </div>

      {/* Custom Fields */}
      {customFields.length > 0 && (
        <div className="custom-fields-section">
          <span className="section-label">Custom Fields</span>
          {customFields.map(field => (
            <div key={field.id} className="custom-field-row">
              <label className="custom-field-label">{field.name}</label>
              <CustomFieldEditor
                field={field}
                value={card.custom_field_values?.[field.id]?.value || null}
                onChange={(val) => handleCustomFieldChange(field.id, val)}
                readOnly={!canWrite}
              />
            </div>
          ))}
        </div>
      )}

      {/* Checklist */}
      <div className="checklist-section">
        <button type="button" className="section-toggle" onClick={() => setShowChecklist(!showChecklist)}>
          <svg className={`section-chevron${showChecklist ? ' open' : ''}`} width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="9 18 15 12 9 6"/></svg>
          <svg className="section-type-icon" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="9 11 12 14 22 4"/><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"/></svg>
          <span className="section-toggle-label">Checklist</span>
          {checklistItems.length > 0 && (
            <span className="checklist-progress-text">
              {checklistItems.filter(i => i.checked).length}/{checklistItems.length}
            </span>
          )}
        </button>
        {showChecklist && (
          <div className="section-content">
          {loadingChecklist ? (
            <div className="loading-inline"><div className="spinner" style={{ width: 20, height: 20, borderWidth: 2 }}></div></div>
          ) : (
            <>
              {checklistItems.map(item => (
                <div key={item.id} className="checklist-item-group">
                  <div className="checklist-item">
                    <input type="checkbox" checked={item.checked} onChange={() => handleToggleChecklistItem(item)} />
                    <span className={item.checked ? 'checked-text' : ''}>{item.text}</span>
                    <button type="button" onClick={() => handleDeleteChecklistItem(item.id)} className="checklist-delete" aria-label="Delete item">×</button>
                  </div>
                  <div className="checklist-meta-row">
                    <div className="checklist-meta-assignee-wrapper">
                      <button
                        type="button"
                        className={`checklist-meta-chip${item.assignee_name ? '' : ' placeholder'}`}
                        onClick={() => setAssigneeDropdownItemId(assigneeDropdownItemId === item.id ? null : item.id)}
                      >
                        {item.assignee_name || 'Assign'}
                      </button>
                      {assigneeDropdownItemId === item.id && (
                        <div className="checklist-assignee-dropdown">
                          <button type="button" className="checklist-assignee-option"
                            onClick={() => { handleChecklistItemUpdate(item.id, { assignee_name: null, assignee_user_id: null } as any); setAssigneeDropdownItemId(null); }}>
                            Unassign
                          </button>
                          {boardMembers.map(m => (
                            <button type="button" key={m.id}
                              className={`checklist-assignee-option${item.assignee_user_id === m.id ? ' selected' : ''}`}
                              onClick={() => { handleChecklistItemUpdate(item.id, { assignee_user_id: m.id, assignee_name: m.username } as any); setAssigneeDropdownItemId(null); }}>
                              {m.username}
                            </button>
                          ))}
                        </div>
                      )}
                    </div>
                    <button
                      type="button"
                      className={`checklist-meta-chip${item.due_date && new Date(item.due_date.split('T')[0] + 'T12:00:00') < new Date() && !item.checked ? ' overdue' : ''}${!item.due_date ? ' placeholder' : ''}`}
                      onClick={(e) => openChecklistDatePicker(item.id, item.due_date, e)}
                    >
                      {item.due_date
                        ? new Date(item.due_date.split('T')[0].split(' ')[0] + 'T12:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
                        : 'Date'}
                    </button>
                    <button
                      type="button"
                      className={`checklist-meta-chip priority-${item.priority || 'none'}`}
                      onClick={() => cyclePriority(item)}
                    >
                      {item.priority ? item.priority.charAt(0).toUpperCase() + item.priority.slice(1) : 'Priority'}
                    </button>
                  </div>
                </div>
              ))}
              <div className="checklist-add">
                <input
                  type="text"
                  value={newChecklistItem}
                  onChange={(e) => setNewChecklistItem(e.target.value)}
                  placeholder="Add item..."
                  className="checklist-input"
                  onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); handleAddChecklistItem(); } }}
                  maxLength={500}
                />
                <button type="button" onClick={handleAddChecklistItem} className="btn-primary btn-sm" disabled={!newChecklistItem.trim()}>+</button>
              </div>
            </>
          )}
          </div>
        )}
      </div>

      {/* Attachments */}
      <div className="attachments-section" onPaste={handlePaste}>
        <button type="button" className="section-toggle" onClick={() => setShowAttachments(!showAttachments)}>
          <svg className={`section-chevron${showAttachments ? ' open' : ''}`} width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="9 18 15 12 9 6"/></svg>
          <svg className="section-type-icon" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48"/></svg>
          <span className="section-toggle-label">Attachments</span>
          {attachments.length > 0 && (
            <span className="section-toggle-count">{attachments.length}</span>
          )}
        </button>
        {showAttachments && (
          <div className="section-content">
          {loadingAttachments ? (
            <div className="loading-inline"><div className="spinner" style={{ width: 20, height: 20, borderWidth: 2 }}></div></div>
          ) : (
            <>
              <div
                className={`attachment-dropzone${dragOver ? ' drag-over' : ''}`}
                onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
                onDragLeave={() => setDragOver(false)}
                onDrop={handleFileDrop}
                onClick={() => fileInputRef.current?.click()}
              >
                <span className="dropzone-text">{dragOver ? 'Drop files here' : 'Drop files or click to upload'}</span>
                <input
                  ref={fileInputRef}
                  type="file"
                  className="dropzone-input"
                  onChange={(e) => { if (e.target.files?.[0]) handleFileUpload(e.target.files[0]); e.target.value = ''; }}
                />
              </div>
              {uploadProgress !== null && (
                <div className="attachment-progress">
                  <div className="attachment-progress-bar" style={{ width: `${uploadProgress}%` }} />
                </div>
              )}
              {attachments.length === 0 && <p className="empty-comments">No attachments yet. You can also paste images.</p>}
              <div className="attachment-list">
                {attachments.map(att => (
                  <div key={att.id} className="attachment-item">
                    {att.mime_type.startsWith('image/') && (
                      <a href={`/api/attachments/${att.id}`} target="_blank" rel="noopener noreferrer" className="attachment-thumb-link">
                        <img src={`/api/attachments/${att.id}`} alt={att.original_name} className="attachment-thumbnail" />
                      </a>
                    )}
                    <div className="attachment-info">
                      <div className="attachment-name-row">
                        <span className="attachment-icon">{getFileIcon(att.mime_type)}</span>
                        <a href={`/api/attachments/${att.id}`} download={att.original_name} className="attachment-filename">{att.original_name}</a>
                      </div>
                      <div className="attachment-meta">
                        <span>{formatFileSize(att.size)}</span>
                        {att.uploader_name && <span>{att.uploader_name}</span>}
                        <span>{timeAgo(att.created_at)}</span>
                      </div>
                    </div>
                    {(String(att.uploader_id) === String(userId) || userRole === 'ADMIN') && (
                      <button type="button" className="attachment-delete" onClick={() => handleDeleteAttachment(att.id)} aria-label="Delete attachment">&times;</button>
                    )}
                  </div>
                ))}
              </div>
            </>
          )}
          </div>
        )}
      </div>

      {/* Relations */}
      <div className="relations-section">
        <button type="button" className="section-toggle" onClick={() => setShowRelations(!showRelations)}>
          <svg className={`section-chevron${showRelations ? ' open' : ''}`} width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="9 18 15 12 9 6"/></svg>
          <svg className="section-type-icon" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/></svg>
          <span className="section-toggle-label">Relations</span>
          {(relations.blocks.length + relations.blocked_by.length + relations.relates_to.length) > 0 && (
            <span className="section-toggle-count">{relations.blocks.length + relations.blocked_by.length + relations.relates_to.length}</span>
          )}
        </button>
        {showRelations && (
          <div className="section-content">
            {relations.blocks.length > 0 && (
              <div className="relation-group">
                <div className="relation-group-label">Blocks</div>
                <div className="relation-chips">
                  {relations.blocks.map(r => (
                    <span key={r.id} className="relation-chip relation-chip-blocks">
                      {r.board_name ? `${r.board_name} / ` : ''}{r.column_name && `${r.column_name} / `}{r.title}
                      {canWrite && <button type="button" className="relation-chip-remove" onClick={() => handleRemoveRelation(r.card_id)}>&times;</button>}
                    </span>
                  ))}
                </div>
              </div>
            )}
            {relations.blocked_by.length > 0 && (
              <div className="relation-group">
                <div className="relation-group-label">Blocked by</div>
                <div className="relation-chips">
                  {relations.blocked_by.map(r => (
                    <span key={r.id} className="relation-chip relation-chip-blocked">
                      {r.board_name ? `${r.board_name} / ` : ''}{r.column_name && `${r.column_name} / `}{r.title}
                      {canWrite && <button type="button" className="relation-chip-remove" onClick={() => handleRemoveRelation(r.card_id)}>&times;</button>}
                    </span>
                  ))}
                </div>
              </div>
            )}
            {relations.relates_to.length > 0 && (
              <div className="relation-group">
                <div className="relation-group-label">Related to</div>
                <div className="relation-chips">
                  {relations.relates_to.map(r => (
                    <span key={r.id} className="relation-chip relation-chip-related">
                      {r.board_name ? `${r.board_name} / ` : ''}{r.column_name && `${r.column_name} / `}{r.title}
                      {canWrite && <button type="button" className="relation-chip-remove" onClick={() => handleRemoveRelation(r.card_id)}>&times;</button>}
                    </span>
                  ))}
                </div>
              </div>
            )}
            {canWrite && (
              <div className="relation-add">
                <div className="relation-add-row">
                  <select value={relationTypeSelect} onChange={(e) => setRelationTypeSelect(e.target.value as any)} className="relation-type-select">
                    <option value="blocks">Blocks</option>
                    <option value="blocked_by">Blocked by</option>
                    <option value="relates_to">Relates to</option>
                  </select>
                  <div className="relation-search-wrapper">
                    <input
                      type="text"
                      value={relationSearch}
                      onChange={(e) => setRelationSearch(e.target.value)}
                      placeholder="Search cards..."
                      className="relation-search-input"
                    />
                    {relationSearchResults.length > 0 && (
                      <div className="relation-search-dropdown">
                        {relationSearchResults.map(r => (
                          <button key={r.id} type="button" className="relation-search-item" onClick={() => handleAddRelation(r.id)}>
                            <span className="relation-search-col">{r.column_name}</span>
                            <span className="relation-search-title">{r.title}</span>
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Comments */}
      <div className="comments-section">
        <button type="button" className="section-toggle" onClick={() => setShowComments(!showComments)}>
          <svg className={`section-chevron${showComments ? ' open' : ''}`} width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="9 18 15 12 9 6"/></svg>
          <svg className="section-type-icon" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>
          <span className="section-toggle-label">Comments</span>
          {comments.length > 0 && (
            <span className="section-toggle-count">{comments.length}</span>
          )}
        </button>
        {showComments && (
          <div className="section-content">
          {loadingComments ? (
            <div className="loading-inline"><div className="spinner" style={{ width: 20, height: 20, borderWidth: 2 }}></div></div>
          ) : (
            <>
              {comments.length === 0 && <p className="empty-comments">No comments yet.</p>}
              {comments.map(comment => (
                <div key={comment.id} className="comment-item">
                  <div className="comment-avatar" style={{ background: avatarColor(comment.username) }}>{avatarInitial(comment.username)}</div>
                  <div className="comment-body">
                    <div className="comment-header">
                      <strong>{comment.username}</strong>
                      <span className="comment-time">{timeAgo(comment.created_at)}</span>
                      <button type="button" onClick={() => handleDeleteComment(comment.id)} className="comment-delete" aria-label="Delete comment">×</button>
                    </div>
                    <div className="comment-bubble"><MarkdownRenderer content={comment.text} /></div>
                  </div>
                </div>
              ))}
              <div className="comment-compose">
                <div className="comment-avatar comment-avatar-sm" style={{ background: avatarColor(currentUsername) }}>{avatarInitial(currentUsername)}</div>
                <div className="comment-compose-input-wrapper assignee-input-wrapper">
                  <textarea
                    ref={commentInputRef}
                    value={newComment}
                    onChange={handleCommentChange}
                    placeholder="Add a comment..."
                    className="comment-input"
                    onKeyDown={handleCommentKeyDown}
                    maxLength={5000}
                    rows={1}
                  />
                  <button type="button" onClick={handleAddComment} className="comment-send-btn" disabled={!newComment.trim()} aria-label="Post comment">
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/></svg>
                  </button>
                  {(() => {
                    if (!commentMentionActive) return null;
                    const { members } = getCommentMentionItems();
                    if (members.length === 0) return null;
                    return (
                      <div className="mention-autocomplete">
                        {members.map((member, index) => (
                          <div key={member.id}
                            className={`mention-item${index === commentMentionIndex ? ' selected' : ''}`}
                            onClick={() => handleCommentMentionSelect(member.username)}
                            onMouseEnter={() => setCommentMentionIndex(index)}>
                            {member.username}
                          </div>
                        ))}
                      </div>
                    );
                  })()}
                </div>
              </div>
            </>
          )}
          </div>
        )}
      </div>

      {/* Activity */}
      <div className="activity-section">
        <button type="button" className="section-toggle" onClick={() => setShowActivity(!showActivity)}>
          <svg className={`section-chevron${showActivity ? ' open' : ''}`} width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="9 18 15 12 9 6"/></svg>
          <svg className="section-type-icon" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
          <span className="section-toggle-label">Activity</span>
          {activityEntries.length > 0 && (
            <span className="section-toggle-count">{activityEntries.length}</span>
          )}
        </button>
        {showActivity && (
          <div className="section-content">
          {loadingActivity ? (
            <div className="loading-inline"><div className="spinner" style={{ width: 20, height: 20, borderWidth: 2 }}></div></div>
          ) : (
            <div className="activity-list">
              {activityEntries.length === 0 && <p className="empty-comments">No activity yet.</p>}
              {activityEntries.map(entry => (
                <div key={entry.id} className="activity-item">
                  <span className="activity-text">
                    <strong>{entry.username}</strong>{' '}
                    {formatActivity(entry.action, entry.detail)}
                  </span>
                  <span className="activity-time">{timeAgo(entry.created_at)}</span>
                </div>
              ))}
            </div>
          )}
          </div>
        )}
      </div>
    </>
  );

  // Read-only detail view for COLLABORATOR and READ
  const renderDetailFields = () => (
    <>
      <h3 className="card-detail-title">{card.title}</h3>

      {/* Labels */}
      {card.labels && card.labels.length > 0 && (
        <div className="card-detail-labels">
          {card.labels.map(label => (
            <span key={label.id} className="label-toggle selected" style={{ '--label-color': label.color } as React.CSSProperties}>
              {label.name}
            </span>
          ))}
        </div>
      )}

      {/* Assignees */}
      {card.assignees?.length ? (
        <div className="card-detail-chips">
          {card.assignees.map((a, i) => (
            <span key={a.id || i} className={`assignee-chip${a.user_id ? ' member-chip' : ''}`}>
              <span className="chip-name">{a.username || a.display_name}</span>
            </span>
          ))}
        </div>
      ) : null}

      {/* Description */}
      {card.description && (
        <MarkdownRenderer content={card.description} className="card-detail-description" />
      )}

      {/* Dates */}
      {card.start_date && (
        <div className="card-detail-field">
          <span className="card-detail-field-label">Start date</span>
          <span>{new Date(card.start_date.split('T')[0] + 'T12:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}</span>
        </div>
      )}
      {card.due_date && (() => {
        const badge = getDueBadge(card.due_date);
        return badge ? (
          <div className="card-detail-field">
            <span className="card-detail-field-label">Due date</span>
            <span className={badge.className}>{badge.label}</span>
          </div>
        ) : null;
      })()}

      {/* Custom Fields */}
      {customFields.length > 0 && (
        <div className="custom-fields-section">
          <span className="section-label">Custom Fields</span>
          {customFields.map(field => (
            <div key={field.id} className="custom-field-row">
              <label className="custom-field-label">{field.name}</label>
              <CustomFieldEditor
                field={field}
                value={card.custom_field_values?.[field.id]?.value || null}
                onChange={(val) => handleCustomFieldChange(field.id, val)}
                readOnly={true}
              />
            </div>
          ))}
        </div>
      )}

      {/* Checklist */}
      <div className="checklist-section">
        <button type="button" className="section-toggle" onClick={() => setShowChecklist(!showChecklist)}>
          <svg className={`section-chevron${showChecklist ? ' open' : ''}`} width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="9 18 15 12 9 6"/></svg>
          <svg className="section-type-icon" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="9 11 12 14 22 4"/><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"/></svg>
          <span className="section-toggle-label">Checklist</span>
          {checklistItems.length > 0 && (
            <span className="checklist-progress-text">
              {checklistItems.filter(i => i.checked).length}/{checklistItems.length}
            </span>
          )}
        </button>
        {showChecklist && (
          <div className="section-content">
          {loadingChecklist ? (
            <div className="loading-inline"><div className="spinner" style={{ width: 20, height: 20, borderWidth: 2 }}></div></div>
          ) : (
            <>
              {checklistItems.length === 0 && <p className="empty-comments">No checklist items.</p>}
              {checklistItems.map(item => (
                <div key={item.id} className="checklist-item-group">
                  <div className="checklist-item">
                    <input type="checkbox" checked={item.checked} disabled />
                    <span className={item.checked ? 'checked-text' : ''}>{item.text}</span>
                  </div>
                  {(item.assignee_name || item.due_date || item.priority) && (
                    <div className="checklist-meta-row read-only">
                      {item.assignee_name && <span className="checklist-meta-chip">{item.assignee_name}</span>}
                      {item.due_date && (
                        <span className={`checklist-meta-chip${new Date(item.due_date.split('T')[0] + 'T12:00:00') < new Date() && !item.checked ? ' overdue' : ''}`}>
                          {new Date(item.due_date.split('T')[0].split(' ')[0] + 'T12:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                        </span>
                      )}
                      {item.priority && <span className={`checklist-meta-chip priority-${item.priority}`}>{item.priority.charAt(0).toUpperCase() + item.priority.slice(1)}</span>}
                    </div>
                  )}
                </div>
              ))}
            </>
          )}
          </div>
        )}
      </div>

      {/* Attachments (read-only) */}
      <div className="attachments-section">
        <button type="button" className="section-toggle" onClick={() => setShowAttachments(!showAttachments)}>
          <svg className={`section-chevron${showAttachments ? ' open' : ''}`} width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="9 18 15 12 9 6"/></svg>
          <svg className="section-type-icon" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48"/></svg>
          <span className="section-toggle-label">Attachments</span>
          {attachments.length > 0 && (
            <span className="section-toggle-count">{attachments.length}</span>
          )}
        </button>
        {showAttachments && (
          <div className="section-content">
          {loadingAttachments ? (
            <div className="loading-inline"><div className="spinner" style={{ width: 20, height: 20, borderWidth: 2 }}></div></div>
          ) : (
            <>
              {attachments.length === 0 && <p className="empty-comments">No attachments.</p>}
              <div className="attachment-list">
                {attachments.map(att => (
                  <div key={att.id} className="attachment-item">
                    {att.mime_type.startsWith('image/') && (
                      <a href={`/api/attachments/${att.id}`} target="_blank" rel="noopener noreferrer" className="attachment-thumb-link">
                        <img src={`/api/attachments/${att.id}`} alt={att.original_name} className="attachment-thumbnail" />
                      </a>
                    )}
                    <div className="attachment-info">
                      <div className="attachment-name-row">
                        <span className="attachment-icon">{getFileIcon(att.mime_type)}</span>
                        <a href={`/api/attachments/${att.id}`} download={att.original_name} className="attachment-filename">{att.original_name}</a>
                      </div>
                      <div className="attachment-meta">
                        <span>{formatFileSize(att.size)}</span>
                        {att.uploader_name && <span>{att.uploader_name}</span>}
                        <span>{timeAgo(att.created_at)}</span>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </>
          )}
          </div>
        )}
      </div>

      {/* Relations (read-only view) */}
      <div className="relations-section">
        <button type="button" className="section-toggle" onClick={() => setShowRelations(!showRelations)}>
          <svg className={`section-chevron${showRelations ? ' open' : ''}`} width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="9 18 15 12 9 6"/></svg>
          <svg className="section-type-icon" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/></svg>
          <span className="section-toggle-label">Relations</span>
          {(relations.blocks.length + relations.blocked_by.length + relations.relates_to.length) > 0 && (
            <span className="section-toggle-count">{relations.blocks.length + relations.blocked_by.length + relations.relates_to.length}</span>
          )}
        </button>
        {showRelations && (
          <div className="section-content">
            {relations.blocks.length > 0 && (
              <div className="relation-group">
                <div className="relation-group-label">Blocks</div>
                <div className="relation-chips">
                  {relations.blocks.map(r => (
                    <span key={r.id} className="relation-chip relation-chip-blocks">
                      {r.board_name ? `${r.board_name} / ` : ''}{r.column_name && `${r.column_name} / `}{r.title}
                    </span>
                  ))}
                </div>
              </div>
            )}
            {relations.blocked_by.length > 0 && (
              <div className="relation-group">
                <div className="relation-group-label">Blocked by</div>
                <div className="relation-chips">
                  {relations.blocked_by.map(r => (
                    <span key={r.id} className="relation-chip relation-chip-blocked">
                      {r.board_name ? `${r.board_name} / ` : ''}{r.column_name && `${r.column_name} / `}{r.title}
                    </span>
                  ))}
                </div>
              </div>
            )}
            {relations.relates_to.length > 0 && (
              <div className="relation-group">
                <div className="relation-group-label">Related to</div>
                <div className="relation-chips">
                  {relations.relates_to.map(r => (
                    <span key={r.id} className="relation-chip relation-chip-related">
                      {r.board_name ? `${r.board_name} / ` : ''}{r.column_name && `${r.column_name} / `}{r.title}
                    </span>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Comments */}
      <div className="comments-section">
        <button type="button" className="section-toggle" onClick={() => setShowComments(!showComments)}>
          <svg className={`section-chevron${showComments ? ' open' : ''}`} width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="9 18 15 12 9 6"/></svg>
          <svg className="section-type-icon" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>
          <span className="section-toggle-label">Comments</span>
          {comments.length > 0 && (
            <span className="section-toggle-count">{comments.length}</span>
          )}
        </button>
        {showComments && (
          <div className="section-content">
          {loadingComments ? (
            <div className="loading-inline"><div className="spinner" style={{ width: 20, height: 20, borderWidth: 2 }}></div></div>
          ) : (
            <>
              {comments.length === 0 && <p className="empty-comments">No comments yet.</p>}
              {comments.map(comment => (
                <div key={comment.id} className="comment-item">
                  <div className="comment-avatar" style={{ background: avatarColor(comment.username) }}>{avatarInitial(comment.username)}</div>
                  <div className="comment-body">
                    <div className="comment-header">
                      <strong>{comment.username}</strong>
                      <span className="comment-time">{timeAgo(comment.created_at)}</span>
                      {canComment && (
                        <button type="button" onClick={() => handleDeleteComment(comment.id)} className="comment-delete" aria-label="Delete comment">×</button>
                      )}
                    </div>
                    <div className="comment-bubble"><MarkdownRenderer content={comment.text} /></div>
                  </div>
                </div>
              ))}
              {canComment && (
                <div className="comment-compose">
                  <div className="comment-avatar comment-avatar-sm" style={{ background: avatarColor(currentUsername) }}>{avatarInitial(currentUsername)}</div>
                  <div className="comment-compose-input-wrapper assignee-input-wrapper">
                    <textarea
                      ref={commentInputRef}
                      value={newComment}
                      onChange={handleCommentChange}
                      placeholder="Add a comment..."
                      className="comment-input"
                      onKeyDown={handleCommentKeyDown}
                      maxLength={5000}
                      rows={1}
                    />
                    <button type="button" onClick={handleAddComment} className="comment-send-btn" disabled={!newComment.trim()} aria-label="Post comment">
                      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/></svg>
                    </button>
                    {(() => {
                      if (!commentMentionActive) return null;
                      const { members } = getCommentMentionItems();
                      if (members.length === 0) return null;
                      return (
                        <div className="mention-autocomplete">
                          {members.map((member, index) => (
                            <div key={member.id}
                              className={`mention-item${index === commentMentionIndex ? ' selected' : ''}`}
                              onClick={() => handleCommentMentionSelect(member.username)}
                              onMouseEnter={() => setCommentMentionIndex(index)}>
                              {member.username}
                            </div>
                          ))}
                        </div>
                      );
                    })()}
                  </div>
                </div>
              )}
            </>
          )}
          </div>
        )}
      </div>

      {/* Activity */}
      <div className="activity-section">
        <button type="button" className="section-toggle" onClick={() => setShowActivity(!showActivity)}>
          <svg className={`section-chevron${showActivity ? ' open' : ''}`} width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="9 18 15 12 9 6"/></svg>
          <svg className="section-type-icon" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
          <span className="section-toggle-label">Activity</span>
          {activityEntries.length > 0 && (
            <span className="section-toggle-count">{activityEntries.length}</span>
          )}
        </button>
        {showActivity && (
          <div className="section-content">
          {loadingActivity ? (
            <div className="loading-inline"><div className="spinner" style={{ width: 20, height: 20, borderWidth: 2 }}></div></div>
          ) : (
            <div className="activity-list">
              {activityEntries.length === 0 && <p className="empty-comments">No activity yet.</p>}
              {activityEntries.map(entry => (
                <div key={entry.id} className="activity-item">
                  <span className="activity-text">
                    <strong>{entry.username}</strong>{' '}
                    {formatActivity(entry.action, entry.detail)}
                  </span>
                  <span className="activity-time">{timeAgo(entry.created_at)}</span>
                </div>
              ))}
            </div>
          )}
          </div>
        )}
      </div>
    </>
  );

  // Detail view for non-admin users (COLLABORATOR / READ)
  if (isEditing && !canWrite) {
    if (isMobile) {
      return createPortal(
        <div className="card-fullscreen-overlay">
          <div className="card-fullscreen-header">
            <button onClick={onEditEnd} className="btn-icon" aria-label="Back">←</button>
            <h2>{card.title}</h2>
          </div>
          <div className="card-fullscreen-body">
            {renderDetailFields()}
          </div>
        </div>,
        document.body
      );
    }

    return (
      <div ref={cardRef} className="kanban-card card-detail" onClick={(e) => e.stopPropagation()}>
        <button onClick={onEditEnd} className="card-detail-close" aria-label="Close">×</button>
        {renderDetailFields()}
      </div>
    );
  }

  if (isEditing && canWrite) {
    // Mobile: fullscreen portal
    if (isMobile) {
      return createPortal(
        <div className="card-fullscreen-overlay">
          <div className="card-fullscreen-header">
            <button onClick={handleClose} className="btn-icon" aria-label="Back">←</button>
            <h2>{card.title}</h2>
            <div className="card-edit-actions-menu" ref={showCardMenu ? cardMenuRef : undefined}>
              <button
                className="btn-kebab"
                onClick={() => setShowCardMenu(!showCardMenu)}
                title="Card actions"
              >
                <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><circle cx="12" cy="5" r="2"/><circle cx="12" cy="12" r="2"/><circle cx="12" cy="19" r="2"/></svg>
              </button>
              {showCardMenu && (
                <div className="kebab-dropdown">
                  <button onClick={() => { setShowCardMenu(false); onEditEnd(); onArchive(); }}>Archive</button>
                  <div className="kebab-divider" />
                  <button className="kebab-danger" onClick={() => { setShowCardMenu(false); onEditEnd(); onDelete(); }}>Delete</button>
                </div>
              )}
            </div>
            <button onClick={handleClose} className="btn-primary btn-sm">Done</button>
          </div>
          <div className="card-fullscreen-body">
            {renderEditFields()}
          </div>
        </div>,
        document.body
      );
    }

    // Desktop: inline editing
    return (
      <div ref={cardRef} className="kanban-card editing" onClick={(e) => e.stopPropagation()}>
        {renderEditFields()}
        <div className="card-edit-actions">
          <button onClick={handleClose} className="btn-primary btn-sm">Done</button>
          <div className="card-edit-actions-menu">
            <button
              ref={cardMenuBtnRef}
              className="btn-kebab"
              onClick={(e) => {
                if (!showCardMenu) {
                  const rect = e.currentTarget.getBoundingClientRect();
                  setCardMenuPos({ top: rect.bottom + 4, left: rect.right });
                }
                setShowCardMenu(!showCardMenu);
              }}
              title="Card actions"
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><circle cx="12" cy="5" r="2"/><circle cx="12" cy="12" r="2"/><circle cx="12" cy="19" r="2"/></svg>
            </button>
            {showCardMenu && cardMenuPos && createPortal(
              <div
                ref={cardMenuRef}
                className="kebab-dropdown kebab-dropdown-portal"
                style={{ top: cardMenuPos.top, left: cardMenuPos.left }}
                onClick={(e) => e.stopPropagation()}
              >
                <button onClick={() => { setShowCardMenu(false); onEditEnd(); onArchive(); }}>Archive</button>
                <div className="kebab-divider" />
                <button className="kebab-danger" onClick={() => { setShowCardMenu(false); onEditEnd(); onDelete(); }}>Delete</button>
              </div>,
              document.body
            )}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div
      className={`kanban-card ${card.archived ? 'archived' : ''}`}
      onClick={() => onEditStart()}
      style={{ cursor: 'pointer' }}
    >
      {/* Label color bars */}
      {card.labels && card.labels.length > 0 && (
        <div className="card-labels">
          {card.labels.map(label => (
            <span key={label.id} className="card-label-bar" style={{ background: label.color }} title={label.name} />
          ))}
        </div>
      )}
      <div className="card-header">
        <h4>{card.title}</h4>
        {canWrite && (
          <div className="card-header-menu">
            <button
              ref={cardMenuBtnRef}
              className="btn-kebab"
              onClick={(e) => {
                e.stopPropagation();
                if (!showCardMenu) {
                  const rect = e.currentTarget.getBoundingClientRect();
                  setCardMenuPos({ top: rect.bottom + 4, left: rect.right });
                }
                setShowCardMenu(!showCardMenu);
              }}
              title="Card actions"
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><circle cx="12" cy="5" r="2"/><circle cx="12" cy="12" r="2"/><circle cx="12" cy="19" r="2"/></svg>
            </button>
            {showCardMenu && cardMenuPos && createPortal(
              <div
                ref={cardMenuRef}
                className="kebab-dropdown kebab-dropdown-portal"
                style={{ top: cardMenuPos.top, left: cardMenuPos.left }}
                onClick={(e) => e.stopPropagation()}
              >
                <button onClick={() => { setShowCardMenu(false); onArchive(); }}>Archive</button>
                <div className="kebab-divider" />
                <button className="kebab-danger" onClick={() => { setShowCardMenu(false); onDelete(); }}>Delete</button>
              </div>,
              document.body
            )}
          </div>
        )}
      </div>
      {card.description && (
        <MarkdownRenderer content={card.description} className="card-description" />
      )}
      {(() => {
        const showOnCardFields = customFields.filter(f => f.show_on_card && card.custom_field_values?.[f.id]?.value);
        const hasFooter = card.assignees?.length || card.due_date || card.checklist || showOnCardFields.length > 0 || relations.blocked_by.length > 0;
        if (!hasFooter) return null;
        return (
          <div className="card-footer">
            <div className="card-footer-left">
              {card.assignees?.map((a, i) => (
                <span key={a.id || i} className={`assignee-badge${a.user_id ? ' member-badge' : ''}`}>
                  {a.username || a.display_name}
                </span>
              ))}
              {showOnCardFields.slice(0, 3).map(field => (
                <span key={field.id} className={`custom-field-badge field-type-${field.field_type}`}>
                  {formatFieldBadge(field, card.custom_field_values![field.id].value)}
                </span>
              ))}
              {showOnCardFields.length > 3 && (
                <span className="custom-field-badge">+{showOnCardFields.length - 3}</span>
              )}
            </div>
            <div className="card-footer-right">
              {card.due_date && (() => {
                const badge = getDueBadge(card.due_date);
                return badge ? <span className={badge.className}>{badge.label}</span> : null;
              })()}
              {card.checklist && card.checklist.total > 0 && (
                <span className={`checklist-badge ${card.checklist.checked === card.checklist.total ? 'checklist-done' : ''}`}>
                  {card.checklist.checked}/{card.checklist.total}
                </span>
              )}
              {(card.checklist?.overdue ?? 0) > 0 && (
                <span className="checklist-overdue-badge">
                  {card.checklist!.overdue} overdue
                </span>
              )}
              {relations.blocked_by.length > 0 && (
                <span className="blocked-badge">Blocked ({relations.blocked_by.length})</span>
              )}
            </div>
          </div>
        );
      })()}
    </div>
  );
}
