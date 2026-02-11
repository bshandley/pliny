import { useState, useEffect } from 'react';
import { api } from '../api';
import { User } from '../types';
import { useConfirm } from '../contexts/ConfirmContext';

interface UserManagementProps {
  onBack: () => void;
  onLogout: () => void;
  currentUser: User;
}

export default function UserManagement({ onBack, onLogout, currentUser }: UserManagementProps) {
  const confirm = useConfirm();
  const [users, setUsers] = useState<User[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [editingUser, setEditingUser] = useState<User | null>(null);
  const [formData, setFormData] = useState({ username: '', password: '', role: 'READ' as 'READ' | 'COLLABORATOR' | 'ADMIN' });
  const [error, setError] = useState('');

  useEffect(() => {
    loadUsers();
  }, []);

  const loadUsers = async () => {
    try {
      const data = await api.getUsers();
      setUsers(data);
    } catch (err) {
      console.error('Failed to load users:', err);
    } finally {
      setLoading(false);
    }
  };

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    try {
      await api.register(formData.username, formData.password, formData.role);
      setShowCreateModal(false);
      setFormData({ username: '', password: '', role: 'READ' });
      loadUsers();
    } catch (err: any) {
      setError(err.message || 'Failed to create user');
    }
  };

  const handleUpdate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingUser) return;
    setError('');

    try {
      const updates: { username?: string; password?: string; role?: 'READ' | 'COLLABORATOR' | 'ADMIN' } = {};
      if (formData.username && formData.username !== editingUser.username) {
        updates.username = formData.username;
      }
      if (formData.password) {
        updates.password = formData.password;
      }
      if (formData.role !== editingUser.role) {
        updates.role = formData.role;
      }

      if (Object.keys(updates).length === 0) {
        setEditingUser(null);
        return;
      }

      await api.updateUser(editingUser.id, updates);
      setEditingUser(null);
      setFormData({ username: '', password: '', role: 'READ' });
      loadUsers();
    } catch (err: any) {
      setError(err.message || 'Failed to update user');
    }
  };

  const handleDelete = async (user: User) => {
    if (!await confirm(`Delete user "${user.username}"? This cannot be undone.`, { confirmLabel: 'Delete' })) return;

    try {
      await api.deleteUser(user.id);
      loadUsers();
    } catch (err: any) {
      alert(err.message || 'Failed to delete user');
    }
  };

  const openEditModal = (user: User) => {
    setEditingUser(user);
    setFormData({ username: user.username, password: '', role: user.role });
    setError('');
  };

  const openCreateModal = () => {
    setShowCreateModal(true);
    setFormData({ username: '', password: '', role: 'READ' });
    setError('');
  };

  if (loading) {
    return <div className="loading"><div className="spinner"></div></div>;
  }

  return (
    <div className="board-list-container">
      <header className="board-list-header">
        <div className="header-left">
          <button onClick={onBack} className="btn-icon">←</button>
          <h1>User Management</h1>
        </div>
        <div className="header-actions">
          <button onClick={openCreateModal} className="btn-primary">
            + New User
          </button>
          <button onClick={onLogout} className="btn-secondary hide-mobile">
            Logout
          </button>
        </div>
      </header>

      <div className="users-table-container">
        <table className="users-table">
          <thead>
            <tr>
              <th>Username</th>
              <th>Role</th>
              <th>Created</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {users.map((user) => (
              <tr key={user.id}>
                <td className="user-name-cell">{user.username}</td>
                <td className="user-role-cell">
                  <span className={`role-badge role-${user.role.toLowerCase()}`}>
                    {user.role}
                  </span>
                </td>
                <td className="user-created-cell">{user.created_at ? new Date(user.created_at).toLocaleDateString() : '-'}</td>
                <td className="actions-cell">
                  <button
                    onClick={() => openEditModal(user)}
                    className="btn-sm btn-primary"
                  >
                    Edit
                  </button>
                  {user.id !== currentUser.id && (
                    <button
                      onClick={() => handleDelete(user)}
                      className="btn-sm btn-danger"
                    >
                      Delete
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Create User Modal */}
      {showCreateModal && (
        <div className="modal-overlay" onClick={() => setShowCreateModal(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h2>Create New User</h2>
            <form onSubmit={handleCreate}>
              <div className="form-group">
                <label htmlFor="new-username">Username</label>
                <input
                  type="text"
                  id="new-username"
                  value={formData.username}
                  onChange={(e) => setFormData({ ...formData, username: e.target.value })}
                  required
                  autoFocus
                  maxLength={255}
                />
              </div>
              <div className="form-group">
                <label htmlFor="new-password">Password</label>
                <input
                  type="password"
                  id="new-password"
                  value={formData.password}
                  onChange={(e) => setFormData({ ...formData, password: e.target.value })}
                  required
                  autoComplete="new-password"
                />
              </div>
              <div className="form-group">
                <label htmlFor="new-role">Role</label>
                <select
                  id="new-role"
                  value={formData.role}
                  onChange={(e) => setFormData({ ...formData, role: e.target.value as 'READ' | 'COLLABORATOR' | 'ADMIN' })}
                >
                  <option value="READ">READ - View only</option>
                  <option value="COLLABORATOR">COLLABORATOR - Can comment</option>
                  <option value="ADMIN">ADMIN - Full access</option>
                </select>
              </div>
              {error && <div className="error">{error}</div>}
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

      {/* Edit User Modal */}
      {editingUser && (
        <div className="modal-overlay" onClick={() => setEditingUser(null)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h2>Edit User</h2>
            <form onSubmit={handleUpdate}>
              <div className="form-group">
                <label htmlFor="edit-username">Username</label>
                <input
                  type="text"
                  id="edit-username"
                  value={formData.username}
                  onChange={(e) => setFormData({ ...formData, username: e.target.value })}
                  required
                  autoFocus
                  maxLength={255}
                />
              </div>
              <div className="form-group">
                <label htmlFor="edit-password">New Password (leave blank to keep current)</label>
                <input
                  type="password"
                  id="edit-password"
                  value={formData.password}
                  onChange={(e) => setFormData({ ...formData, password: e.target.value })}
                  autoComplete="new-password"
                />
              </div>
              <div className="form-group">
                <label htmlFor="edit-role">Role</label>
                <select
                  id="edit-role"
                  value={formData.role}
                  onChange={(e) => setFormData({ ...formData, role: e.target.value as 'READ' | 'COLLABORATOR' | 'ADMIN' })}
                  disabled={editingUser.id === currentUser.id}
                >
                  <option value="READ">READ - View only</option>
                  <option value="COLLABORATOR">COLLABORATOR - Can comment</option>
                  <option value="ADMIN">ADMIN - Full access</option>
                </select>
                {editingUser.id === currentUser.id && (
                  <small className="form-hint">Cannot change your own role</small>
                )}
              </div>
              {error && <div className="error">{error}</div>}
              <div className="modal-actions">
                <button type="button" onClick={() => setEditingUser(null)} className="btn-secondary">
                  Cancel
                </button>
                <button type="submit" className="btn-primary">
                  Save Changes
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
