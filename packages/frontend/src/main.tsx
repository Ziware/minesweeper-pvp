import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter, Routes, Route } from 'react-router-dom';
import App from './App';
import { ProfilePage } from './pages/ProfilePage/ProfilePage';
import { RulesPage } from './pages/RulesPage/RulesPage';
import { ClassicPage } from './pages/ClassicPage/ClassicPage';
import { RoomPage } from './pages/RoomPage/RoomPage';
import { GameSessionProvider } from './context/GameSessionContext';
import './index.css';

function RouterApp() {
  return (
    <Routes>
      <Route path="/profile/:login" element={<ProfilePage />} />
      <Route path="/rules" element={<RulesPage />} />
      <Route path="/classic" element={<ClassicPage />} />
      <Route path="/room/:roomId" element={<RoomPage />} />
      <Route path="/*" element={<App />} />
    </Routes>
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
