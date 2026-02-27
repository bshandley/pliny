import { useState, useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { api } from '../api';
import { User, BoardMember } from '../types';
import { useConfirm } from '../contexts/ConfirmContext';

interface BoardMembersProps {
  boardId: string;
  onClose: () => void;
  currentUserRole: 'READ' | 'COLLABORATOR' | 'ADMIN';
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

const ROLE_META: Record<string, { label: string; cls: string; desc: string }> = {
  ADMIN: { label: 'Admin', cls: 'bm-role--admin', desc: 'Full access' },
  COLLABORATOR: { label: 'Collaborator', cls: 'bm-role--collab', desc: 'Can edit cards' },
  READ: { label: 'Read', cls: 'bm-role--read', desc: 'View only' },
};

function RolePicker({ value, onChange }: { value: string; onChange: (role: string) => void }) {
  const [open, setOpen] = useState(false);
  const [menuPos, setMenuPos] = useState({ top: 0, left: 0 });
  const btnRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => {
      const t = e.target as Node;
      if (
        !(btnRef.current?.contains(t)) &&
        !(menuRef.current?.contains(t))
      ) setOpen(false);
    };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, [open]);

  const handleToggle = () => {
    if (!open && btnRef.current) {
      const rect = btnRef.current.getBoundingClientRect();
      setMenuPos({ top: rect.bottom + 4, left: rect.left });
    }
    setOpen((v) => !v);
  };

  const meta = ROLE_META[value] || ROLE_META.READ;

  return (
    <div className="bm-role-picker">
      <button
        ref={btnRef}
        className={`bm-role-badge bm-role-badge--interactive ${meta.cls}`}
        onClick={handleToggle}
        type="button"
      >
        {meta.label}
        <svg width="10" height="10" viewBox="0 0 10 10" fill="none" style={{ opacity: 0.6 }}>
          <path d="M2.5 4L5 6.5L7.5 4" stroke="currentColor" strokeWidth="1.25" strokeLinecap="round" strokeLinejoin="round"/>
        </svg>
      </button>
      {open && createPortal(
        <div
          ref={menuRef}
          className="bm-role-menu"
          style={{ position: 'fixed', top: menuPos.top, left: menuPos.left }}
        >
          {Object.entries(ROLE_META).map(([key, m]) => (
            <button
              key={key}
              className={`bm-role-option ${key === value ? 'active' : ''}`}
              onClick={() => { onChange(key); setOpen(false); }}
              type="button"
            >
              <span className={`bm-role-dot ${m.cls}`} />
              <span className="bm-role-option-text">
                <span className="bm-role-option-label">{m.label}</span>
                <span className="bm-role-option-desc">{m.desc}</span>
              </span>
              {key === value && (
                <svg className="bm-role-check" width="14" height="14" viewBox="0 0 14 14" fill="none">
                  <path d="M3 7L6 10L11 4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
                </svg>
              )}
            </button>
          ))}
        </div>,
        document.body
      )}
    </div>
  );
}

export default function BoardMembers({ boardId, onClose, currentUserRole }: BoardMembersProps) {
  const confirm = useConfirm();
  const [members, setMembers] = useState<BoardMember[]>([]);
  const [allUsers, setAllUsers] = useState<User[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedUserId, setSelectedUserId] = useState('');
  const [selectedRole, setSelectedRole] = useState<string>('COLLABORATOR');

  useEffect(() => {
    loadData();
  }, [boardId]);

  const loadData = async () => {
    try {
      const [membersData, usersData] = await Promise.all([
        api.getBoardMembers(boardId),
        api.getUsers(),
      ]);
      setMembers(membersData);
      setAllUsers(usersData);
    } catch (err) {
      console.error('Failed to load board members:', err);
    } finally {
      setLoading(false);
    }
  };

  const handleAddMember = async () => {
    if (!selectedUserId) return;
    try {
      await api.addBoardMember(boardId, selectedUserId, selectedRole);
      setSelectedUserId('');
      setSelectedRole('COLLABORATOR');
      loadData();
    } catch (err: any) {
      alert(err.message || 'Failed to add member');
    }
  };

  const handleRemoveMember = async (userId: string, username: string) => {
    if (!await confirm(`Remove "${username}" from this board?`, { confirmLabel: 'Remove' })) return;
    try {
      await api.removeBoardMember(boardId, userId);
      loadData();
    } catch (err: any) {
      alert(err.message || 'Failed to remove member');
    }
  };

  const handleChangeRole = async (userId: string, newRole: string) => {
    try {
      await api.changeBoardMemberRole(boardId, userId, newRole);
      loadData();
    } catch (err: any) {
      alert(err.message || 'Failed to change role');
    }
  };

  const availableUsers = allUsers.filter(
    (u) => !members.some((m) => m.id === u.id)
  );

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal modal-wide bm-modal" onClick={(e) => e.stopPropagation()}>
        {/* Header */}
        <div className="bm-header">
          <div className="bm-header-icon">
            <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
              <path d="M14 17v-1.5A3.5 3.5 0 0010.5 12h-5A3.5 3.5 0 002 15.5V17" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
              <circle cx="8" cy="6.5" r="3.5" stroke="currentColor" strokeWidth="1.5"/>
              <path d="M16 11v4m2-2h-4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
          </div>
          <div>
            <h2>Members</h2>
            <p className="bm-subtitle">
              {currentUserRole === 'ADMIN'
                ? 'Manage who has access and what they can do.'
                : `${members.length} member${members.length !== 1 ? 's' : ''} on this board`}
            </p>
          </div>
        </div>

        {loading ? (
          <div className="loading-inline"><div className="spinner"></div></div>
        ) : (
          <>
            {/* Add member */}
            {currentUserRole === 'ADMIN' && availableUsers.length > 0 && (
              <div className="bm-add-section">
                <div className="bm-add-label">Add a member</div>
                <div className="bm-add-row">
                  <select
                    value={selectedUserId}
                    onChange={(e) => setSelectedUserId(e.target.value)}
                    className="bm-select"
                  >
                    <option value="">Choose a user...</option>
                    {availableUsers.map((user) => (
                      <option key={user.id} value={user.id}>{user.username}</option>
                    ))}
                  </select>
                  <select
                    value={selectedRole}
                    onChange={(e) => setSelectedRole(e.target.value)}
                    className="bm-select bm-select-role"
                  >
                    <option value="ADMIN">Admin</option>
                    <option value="COLLABORATOR">Collaborator</option>
                    <option value="READ">Read</option>
                  </select>
                  <button
                    onClick={handleAddMember}
                    className="btn-primary btn-sm"
                    disabled={!selectedUserId}
                  >
                    Add
                  </button>
                </div>
              </div>
            )}

            {/* Members list */}
            <div className="bm-list">
              {members.length === 0 ? (
                <div className="bm-empty">
                  <svg width="40" height="40" viewBox="0 0 40 40" fill="none">
                    <circle cx="20" cy="15" r="7" stroke="currentColor" strokeWidth="1.5"/>
                    <path d="M8 35c0-6.627 5.373-12 12-12s12 5.373 12 12" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
                  </svg>
                  <span>No members yet</span>
                </div>
              ) : (
                members.map((member, i) => (
                  <div key={member.id} className="bm-member" style={{ animationDelay: `${i * 30}ms` }}>
                    <div className="bm-avatar" style={{ background: avatarColor(member.username) }}>
                      {avatarInitial(member.username)}
                    </div>
                    <div className="bm-member-body">
                      <span className="bm-member-name">{member.username}</span>
                      {currentUserRole === 'ADMIN' ? (
                        <RolePicker
                          value={member.board_role}
                          onChange={(newRole) => handleChangeRole(member.id, newRole)}
                        />
                      ) : (
                        <span className={`bm-role-badge ${(ROLE_META[member.board_role] || ROLE_META.READ).cls}`}>
                          {(ROLE_META[member.board_role] || ROLE_META.READ).label}
                        </span>
                      )}
                    </div>
                    {currentUserRole === 'ADMIN' && (
                      <button
                        onClick={() => handleRemoveMember(member.id, member.username)}
                        className="bm-remove"
                        title="Remove member"
                        type="button"
                      >
                        <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor">
                          <path d="M6.5 1a.5.5 0 0 0 0 1h3a.5.5 0 0 0 0-1h-3zM3.5 3a.5.5 0 0 0 0 1H4v9a2 2 0 0 0 2 2h4a2 2 0 0 0 2-2V4h.5a.5.5 0 0 0 0-1h-7zM5 4h6v9a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1V4zm2 2.5a.5.5 0 0 0-1 0v5a.5.5 0 0 0 1 0v-5zm2 0a.5.5 0 0 0-1 0v5a.5.5 0 0 0 1 0v-5z"/>
                        </svg>
                      </button>
                    )}
                  </div>
                ))
              )}
            </div>
          </>
        )}

        <div className="modal-actions">
          <button onClick={onClose} className="btn-secondary">
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
