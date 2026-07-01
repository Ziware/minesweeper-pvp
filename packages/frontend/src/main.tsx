import React, { useEffect, useRef } from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter, Routes, Route } from 'react-router-dom';
import App from './App';
import { ProfilePage } from './pages/ProfilePage/ProfilePage';
import { RulesPage } from './pages/RulesPage/RulesPage';
import { ClassicPage } from './pages/ClassicPage/ClassicPage';
import { RoomPage } from './pages/RoomPage/RoomPage';
import { GameSessionProvider, useGameSession } from './context/GameSessionContext';
import { useAuth } from './hooks/useAuth';
import './index.css';

/**
 * Global bridge: whenever the player logs in / registers on ANY page,
 * re-authenticate the existing socket so the backend can link their userId
 * to the running session without interrupting the game.
 */
function AuthSocketBridge() {
  const { token } = useAuth();
  const { authenticateSocket } = useGameSession();
  const prevTokenRef = useRef<string | null>(null);

  useEffect(() => {
    if (token && token !== prevTokenRef.current) {
      authenticateSocket(token);
    }
    prevTokenRef.current = token ?? null;
  }, [token, authenticateSocket]);

  return null;
}

function RouterApp() {
  return (
    <>
      <AuthSocketBridge />
      <Routes>
        <Route path="/profile/:login" element={<ProfilePage />} />
        <Route path="/rules" element={<RulesPage />} />
        <Route path="/classic" element={<ClassicPage />} />
        <Route path="/room/:roomId" element={<RoomPage />} />
        <Route path="/*" element={<App />} />
      </Routes>
    </>
  );
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <BrowserRouter>
      <GameSessionProvider>
        <RouterApp />
      </GameSessionProvider>
    </BrowserRouter>
  </React.StrictMode>
);
