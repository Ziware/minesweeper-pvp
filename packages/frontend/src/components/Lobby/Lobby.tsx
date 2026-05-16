import React, { useState } from 'react';
import styles from './Lobby.module.css';

interface LobbyProps {
  onCreateRoom: (name: string) => void;
  onJoinRoom:   (roomId: string, name: string) => void;
  errorMsg: string;
}

export function Lobby({ onCreateRoom, onJoinRoom, errorMsg }: LobbyProps) {
  const [name,   setName]   = useState('');
  const [joinId, setJoinId] = useState('');
  const [nameErr, setNameErr] = useState('');

  const handleCreate = () => {
    if (!name.trim()) { setNameErr('Введите имя'); return; }
    setNameErr('');
    onCreateRoom(name.trim());
  };

  const handleJoin = () => {
    if (!name.trim()) { setNameErr('Введите имя'); return; }
    if (!joinId.trim()) return;
    setNameErr('');
    onJoinRoom(joinId.trim(), name.trim());
  };

  return (
    <div className={styles.container}>
      <h1 className={styles.title}>💣 Minesweeper PvP</h1>

      {/* Имя — общее для обоих действий */}
      <div className={styles.card}>
        <h2>Ваше имя</h2>
        <input
          className={`${styles.input} ${nameErr ? styles.inputError : ''}`}
          placeholder="Введите имя игрока"
          value={name}
          onChange={(e) => { setName(e.target.value); setNameErr(''); }}
          maxLength={20}
        />
        {nameErr && <div className={styles.fieldError}>{nameErr}</div>}
      </div>

      <div className={styles.row}>
        {/* Создать комнату */}
        <div className={styles.card}>
          <h2>Создать комнату</h2>
          <p className={styles.hint}>Вы будете играть за 🔴 Красного</p>
          <button className={styles.btnRed} onClick={handleCreate}>
            Создать комнату
          </button>
        </div>

        {/* Войти в комнату */}
        <div className={styles.card}>
          <h2>Войти в комнату</h2>
          <input
            className={styles.input}
            placeholder="ID комнаты"
            value={joinId}
            onChange={(e) => setJoinId(e.target.value.toUpperCase())}
            maxLength={6}
          />
          <p className={styles.hint}>Вы будете играть за 🔵 Синего</p>
          <button
            className={styles.btnBlue}
            onClick={handleJoin}
            disabled={!joinId.trim()}
          >
            Войти
          </button>
        </div>
      </div>

      {errorMsg && <div className={styles.error}>{errorMsg}</div>}
    </div>
  );
}
