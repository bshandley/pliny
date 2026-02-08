import { useState, useEffect } from 'react';
import { api } from '../api';
import { User, BoardMember } from '../types';
import { useConfirm } from '../contexts/ConfirmContext';

interface BoardMembersProps {
  boardId: string;
  onClose: () => void;
}

export default function BoardMembers({ boardId, onClose }: BoardMembersProps) {
  const confirm = useConfirm();
  const [members, setMembers] = useState<BoardMember[]>([]);
  const [allUsers, setAllUsers] = useState<User[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedUserId, setSelectedUserId] = useState('');

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
      await api.addBoardMember(boardId, selectedUserId);
      setSelectedUserId('');
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

  // Users not yet members (only show READ users since ADMINs already have access)
  const availableUsers = allUsers.filter(
    (u) => u.role === 'READ' && !members.some((m) => m.id === u.id)
  );

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal modal-wide" onClick={(e) => e.stopPropagation()}>
        <h2>Board Members</h2>
        <p className="modal-subtitle">
          Manage which READ users can access this board. ADMIN users always have access.
        </p>

        {loading ? (
          <div className="loading-inline"><div className="spinner"></div></div>
        ) : (
          <>
            {/* Add member section */}
            {availableUsers.length > 0 && (
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
                <p className="empty-members">No READ users assigned to this board yet.</p>
              ) : (
                members.map((member) => (
                  <div key={member.id} className="member-row">
                    <div className="member-info">
                      <span className="member-name">{member.username}</span>
                      <span className={`role-badge role-${member.role.toLowerCase()}`}>
                        {member.role}
                      </span>
                    </div>
                    <button
                      onClick={() => handleRemoveMember(member.id, member.username)}
                      className="btn-sm btn-danger"
                    >
                      Remove
                    </button>
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
