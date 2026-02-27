import { useState, useEffect } from 'react';
import { api } from '../api';
import { User, BoardMember } from '../types';
import { useConfirm } from '../contexts/ConfirmContext';

interface BoardMembersProps {
  boardId: string;
  onClose: () => void;
  currentUserRole: 'READ' | 'COLLABORATOR' | 'ADMIN';
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

  // Users not yet members
  const availableUsers = allUsers.filter(
    (u) => !members.some((m) => m.id === u.id)
  );

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal modal-wide" onClick={(e) => e.stopPropagation()}>
        <h2>Board Members</h2>
        <p className="modal-subtitle">
          {currentUserRole === 'ADMIN' ? 'Board members and their roles. You can add members and change roles.' : 'Board members and their roles. Contact a board admin to change roles.'}
        </p>

        {loading ? (
          <div className="loading-inline"><div className="spinner"></div></div>
        ) : (
          <>
            {/* Add member section */}
            {currentUserRole === 'ADMIN' && availableUsers.length > 0 && (
              <div className="add-member-section">
                <select
                  value={selectedUserId}
                  onChange={(e) => setSelectedUserId(e.target.value)}
                  className="member-select"
                >
                  <option value="">Select a user to add...</option>
                  {availableUsers.map((user) => (
                    <option key={user.id} value={user.id}>
                      {user.username}
                    </option>
                  ))}
                </select>
                <select
                  value={selectedRole}
                  onChange={(e) => setSelectedRole(e.target.value)}
                  className="role-select"
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
            )}

            {/* Members list */}
            <div className="members-list">
              {members.length === 0 ? (
                <p className="empty-members">No members assigned to this board yet.</p>
              ) : (
                members.map((member) => (
                  <div key={member.id} className="member-row">
                    <div className="member-info">
                      <span className="member-name">{member.username}</span>
                      {currentUserRole === 'ADMIN' ? (
                        <select
                          value={member.board_role}
                          onChange={(e) => handleChangeRole(member.id, e.target.value)}
                          className="role-select-inline"
                        >
                          <option value="ADMIN">Admin</option>
                          <option value="COLLABORATOR">Collaborator</option>
                          <option value="READ">Read</option>
                        </select>
                      ) : (
                        <span className={`role-badge role-${member.board_role.toLowerCase()}`}>
                          {member.board_role}
                        </span>
                      )}
                    </div>
                    {currentUserRole === 'ADMIN' && (
                      <button
                        onClick={() => handleRemoveMember(member.id, member.username)}
                        className="btn-sm btn-danger"
                      >
                        Remove
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
