import { useState, useEffect } from 'react';
import { api } from './api';
import { User } from './types';
import Login from './components/Login';
import BoardList from './components/BoardList';
import KanbanBoard from './components/KanbanBoard';
import UserManagement from './components/UserManagement';

type Page = 'boards' | 'users' | 'board';

function App() {
  const [user, setUser] = useState<User | null>(null);
  const [currentBoardId, setCurrentBoardId] = useState<string | null>(null);
  const [page, setPage] = useState<Page>('boards');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const token = api.getToken();
    if (token) {
      api.getBoards()
        .then(() => {
          setLoading(false);
        })
        .catch(() => {
          api.setToken(null);
          setLoading(false);
        });
    } else {
      setLoading(false);
    }
  }, []);

  const handleLogin = async (username: string, password: string) => {
    try {
      const userData = await api.login(username, password);
      setUser(userData);
    } catch (error: any) {
      throw error;
    }
  };

  const handleLogout = () => {
    api.setToken(null);
    setUser(null);
    setCurrentBoardId(null);
    setPage('boards');
  };

  const handleSelectBoard = (boardId: string) => {
    setCurrentBoardId(boardId);
    setPage('board');
  };

  const handleBackToBoards = () => {
    setCurrentBoardId(null);
    setPage('boards');
  };

  const handleGoToUsers = () => {
    setPage('users');
  };

  if (loading) {
    return (
      <div className="loading">
        <div className="spinner"></div>
        <p>Loading...</p>
      </div>
    );
  }

  if (!user && !api.getToken()) {
    return <Login onLogin={handleLogin} />;
  }

  if (page === 'board' && currentBoardId) {
    return (
      <KanbanBoard
        boardId={currentBoardId}
        onBack={handleBackToBoards}
        onLogout={handleLogout}
        userRole={user?.role || 'READ'}
      />
    );
  }

  if (page === 'users' && user?.role === 'ADMIN') {
    return (
      <UserManagement
        onBack={handleBackToBoards}
        onLogout={handleLogout}
        currentUser={user}
      />
    );
  }

  return (
    <BoardList
      onSelectBoard={handleSelectBoard}
      onLogout={handleLogout}
      onGoToUsers={handleGoToUsers}
      user={user}
    />
  );
}

export default App;
