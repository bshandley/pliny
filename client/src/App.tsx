import { useState, useEffect } from 'react';
import { api } from './api';
import { User } from './types';
import Login from './components/Login';
import BoardList from './components/BoardList';
import KanbanBoard from './components/KanbanBoard';

function App() {
  const [user, setUser] = useState<User | null>(null);
  const [currentBoardId, setCurrentBoardId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    // Check for existing token
    const token = api.getToken();
    if (token) {
      // Token exists, but we need to verify it by making a request
      api.getBoards()
        .then(() => {
          // Token is valid, we'll get user info from first successful request
          setLoading(false);
        })
        .catch(() => {
          // Token invalid
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
  };

  const handleSelectBoard = (boardId: string) => {
    setCurrentBoardId(boardId);
  };

  const handleBackToBoards = () => {
    setCurrentBoardId(null);
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

  if (currentBoardId) {
    return (
      <KanbanBoard
        boardId={currentBoardId}
        onBack={handleBackToBoards}
        onLogout={handleLogout}
        userRole={user?.role || 'READ'}
      />
    );
  }

  return (
    <BoardList
      onSelectBoard={handleSelectBoard}
      onLogout={handleLogout}
      user={user}
    />
  );
}

export default App;
