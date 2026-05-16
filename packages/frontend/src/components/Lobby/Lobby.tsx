import React, { useState } from 'react';
import styles from './Lobby.module.css';

interface LobbyProps {
  onCreateRoom: (name: string) => void;
  onJoinRoom: (roomId: string, name: string) => void;
  errorMsg: string;
}

export function Lobby({ onCreateRoom, onJoinRoom, errorMsg }: LobbyProps) {
  const [name, setName] = useState('');
  const [joinId, setJoinId] = useState('');

  return (
    <div className={styles.container}>
      <h1 className={styles.title}>💣 Minesweeper PvP</h1>

      <div className={styles.card}>
        <h2>Создать комнату</h2>
        <input
          className={styles.input}
          placeholder="Ваше имя"
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
        <button
          className={styles.btnRed}
          onClick={() => onCreateRoom(name || 'Player')}
        >
          Создать (играть за красных)
        </button>
      </div>

      <div className={styles.card}>
        <h2>Войти в комнату</h2>
        <input
          className={styles.input}
          placeholder="ID комнаты"
          value={joinId}
          onChange={(e) => setJoinId(e.target.value.toUpperCase())}
        />
        <button
          className={styles.btnBlue}
          onClick={() => onJoinRoom(joinId, name || 'Player')}
        >
          Войти (играть за синих)
        </button>
      </div>

      {errorMsg && <div className={styles.error}>{errorMsg}</div>}
    </div>
  );
}
