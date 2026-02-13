import { useState, useEffect, useRef } from 'react';
import { api } from '../api';
import { User } from '../types';
import { useConfirm } from '../contexts/ConfirmContext';

interface UserManagementProps {
  onBack: () => void;
  onLogout: () => void;
  currentUser: User;
  subRoute: string | null;
  onNavigate: (sub: string | null) => void;
}

export default function UserManagement({ onBack, onLogout, currentUser, subRoute, onNavigate }: UserManagementProps) {
  const confirm = useConfirm();
  const [users, setUsers] = useState<User[]>([]);
  const [loading, setLoading] = useState(true);
  const [formData, setFormData] = useState({ username: '', password: '', role: 'READ' as 'READ' | 'COLLABORATOR' | 'ADMIN' });
  const [error, setError] = useState('');
  const [openMenuId, setOpenMenuId] = useState<string | null>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  const editingUser = subRoute && subRoute !== 'new'
    ? users.find(u => u.username.toLowerCase() === subRoute.toLowerCase()) ?? null
    : null;

  useEffect(() => {
    loadUsers();
  }, []);

  useEffect(() => {
    if (subRoute === 'new') {
      setFormData({ username: '', password: '', role: 'READ' });
      setError('');
    } else if (editingUser) {
      setFormData({ username: editingUser.username, password: '', role: editingUser.role });
      setError('');
    }
  }, [subRoute, editingUser?.id]);

  // Close kebab on outside click
  useEffect(() => {
    if (!openMenuId) return;
    const handleClick = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setOpenMenuId(null);
      }
    };
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [openMenuId]);

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
      await loadUsers();
      onNavigate(null);
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
      if (formData.username && formData.username !== editingUser.username) updates.username = formData.username;
      if (formData.password) updates.password = formData.password;
      if (formData.role !== editingUser.role) updates.role = formData.role;

      if (Object.keys(updates).length === 0) {
        onNavigate(null);
        return;
      }

      await api.updateUser(editingUser.id, updates);
      await loadUsers();
      onNavigate(null);
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

  if (loading) {
    return <div className="loading"><div className="spinner"></div></div>;
  }

  // Shared form fields for create/edit
  const renderFormFields = (mode: 'create' | 'edit') => {
    return (
      <>
        <div className="form-group">
          <label htmlFor={`${mode}-username`}>Username</label>
          <input
            type="text"
            id={`${mode}-username`}
            value={formData.username}
            onChange={(e) => setFormData({ ...formData, username: e.target.value })}
            required
            maxLength={255}
          />
        </div>
        <div className="form-group">
          <label htmlFor={`${mode}-password`}>
            {mode === 'edit' ? 'New Password (leave blank to keep current)' : 'Password'}
          </label>
          <input
            type="password"
            id={`${mode}-password`}
            value={formData.password}
            onChange={(e) => setFormData({ ...formData, password: e.target.value })}
            required={mode === 'create'}
            autoComplete="new-password"
          />
        </div>
        <div className="form-group">
          <label htmlFor={`${mode}-role`}>Role</label>
          <select
            id={`${mode}-role`}
            value={formData.role}
            onChange={(e) => setFormData({ ...formData, role: e.target.value as 'READ' | 'COLLABORATOR' | 'ADMIN' })}
            disabled={mode === 'edit' && editingUser?.id === currentUser.id}
          >
            <option value="READ">READ - View only</option>
            <option value="COLLABORATOR">COLLABORATOR - Can comment</option>
            <option value="ADMIN">ADMIN - Full access</option>
          </select>
          {mode === 'edit' && editingUser?.id === currentUser.id && (
            <small className="form-hint">Cannot change your own role</small>
          )}
        </div>
        {error && <div className="error">{error}</div>}
      </>
    );
  };

  const renderFormPage = () => {
    const isCreate = subRoute === 'new';
    const title = isCreate ? 'New User' : `Edit ${editingUser?.username}`;
    const onSubmit = isCreate ? handleCreate : handleUpdate;
    const submitLabel = isCreate ? 'Create' : 'Save';

    if (!isCreate && !editingUser) {
      // Don't redirect until users have loaded — editingUser may be null
      // simply because loadUsers() hasn't completed yet
      if (!loading && users.length > 0) {
        onNavigate(null);
      }
      return loading
        ? <div className="loading"><div className="spinner"></div></div>
        : null;
    }

    return (
      <div className="board-list-container">
        <header className="board-list-header">
          <div className="header-left">
            <button onClick={() => onNavigate(null)} className="btn-icon">←</button>
            <h1>{title}</h1>
          </div>
          <div className="header-actions">
            <button type="submit" form="user-form" className="btn-primary btn-sm">{submitLabel}</button>
          </div>
        </header>
        <div className="user-form-page">
          <form id="user-form" onSubmit={onSubmit}>
            {renderFormFields(isCreate ? 'create' : 'edit')}
          </form>
        </div>
      </div>
    );
  };

  if (subRoute) {
    return renderFormPage();
  }

  return (
    <div className="board-list-container">
      <header className="board-list-header">
        <div className="header-left">
          <button onClick={onBack} className="btn-icon">←</button>
          <h1>User Management</h1>
        </div>
        <div className="header-actions">
          <button onClick={() => onNavigate('new')} className="btn-primary">
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
              <th></th>
            </tr>
          </thead>
          <tbody>
            {users.map((user) => (
              <tr
                key={user.id}
                className="user-row-clickable"
                onClick={() => onNavigate(user.username)}
              >
                <td className="user-name-cell">{user.username}</td>
                <td className="user-role-cell">
                  <span className={`role-badge role-${user.role.toLowerCase()}`}>
                    {user.role}
                  </span>
                </td>
                <td className="user-created-cell">
                  {user.created_at ? new Date(user.created_at).toLocaleDateString() : '-'}
                </td>
                <td className="actions-cell">
                  {user.id !== currentUser.id && (
                    <div className="user-kebab" ref={openMenuId === user.id ? menuRef : undefined}>
                      <button
                        className="btn-kebab"
                        onClick={(e) => { e.stopPropagation(); setOpenMenuId(openMenuId === user.id ? null : user.id); }}
                        title="User actions"
                      >
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
                          <circle cx="12" cy="5" r="2"/><circle cx="12" cy="12" r="2"/><circle cx="12" cy="19" r="2"/>
                        </svg>
                      </button>
                      {openMenuId === user.id && (
                        <div className="kebab-dropdown">
                          <button className="kebab-danger" onClick={(e) => { e.stopPropagation(); setOpenMenuId(null); handleDelete(user); }}>Delete</button>
                        </div>
                      )}
                    </div>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
