import React, { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useGameSession } from './context/GameSessionContext';
import { useAuth } from './hooks/useAuth';
import { useSettings } from './hooks/useSettings';
import { useSound } from './hooks/useSound';
import { Lobby } from './components/Lobby/Lobby';
import { NavBar } from './components/NavBar/NavBar';
import styles from './App.module.css';

export default function App() {
  const navigate = useNavigate();
  const auth = useAuth();
  const settingsApi = useSettings();
  const { mutedRef, volumeRef } = settingsApi;
  const { preload } = useSound({ mutedRef, volumeRef });

  const {
    screen,
    roomId,
    errorMsg,
    serverReachable,
    createRoom,
    joinRoom,
    startBotGame,
  } = useGameSession();

  // Preload sounds early so they are ready when the user enters a room.
  useEffect(() => { preload(); }, [preload]);

  // Navigate to the dedicated room page whenever a game starts.
  useEffect(() => {
    if (screen !== 'lobby' && roomId) {
      navigate(`/room/${roomId}`);
    }
  }, [screen, roomId, navigate]);

  // Player name: authenticated users use their login, guests use 'Гость'.
  const playerName = auth.isGuest ? 'Гость' : (auth.user?.login ?? 'Гость');
  const userId = auth.isGuest ? undefined : auth.user?.id;

  return (
    <div className={styles.gameLayout}>
      <NavBar auth={auth} settings={settingsApi} />
      <Lobby
        onCreateRoom={(timeControl, preferredColor) => {
          createRoom(playerName, timeControl, preferredColor);
        }}
        onJoinRoom={(id) => {
          joinRoom(id, playerName);
        }}
        onStartBotGame={(difficulty, humanColor) => {
          startBotGame(playerName, difficulty, humanColor, userId);
        }}
        onUiClick={() => {}}
      />
      {errorMsg && <div className={styles.toastError}>{errorMsg}</div>}
      {!serverReachable && (
        <div className={styles.offlineBanner}>
          ⚠️ Сервер недоступен. Пытаемся переподключиться…
        </div>
      )}
    </div>
  );
}
