import React, { useEffect, useState } from 'react';
import { TimeControl, TIME_CONTROL_PRESETS, BALANCE, PlayerColor } from '@minesweeper-pvp/shared';
import type { Difficulty } from '../../ai/types';
import { DIFFICULTY_LABELS } from '../../ai/difficulty';
import styles from './Lobby.module.css';

interface LobbyProps {
  onCreateRoom:        (name: string, timeControl: TimeControl) => void;
  onJoinRoom:          (roomId: string, name: string) => void;
  /** Запустить локальную игру против компьютера. */
  onStartSolo?:        (name: string, difficulty: Difficulty, humanColor: PlayerColor) => void;
  /** Опциональный звук-эффект «клик», прокидывается из App. */
  onUiClick?:          () => void;
}

const DEFAULT_PRESET_INDEX = BALANCE.timeControls.defaultPresetIndex;
const NAME_STORAGE_KEY = 'minesweeper_player_name';
const MODE_STORAGE_KEY = 'minesweeper_mode';
const DIFFICULTY_STORAGE_KEY = 'minesweeper_solo_difficulty';
const COLOR_STORAGE_KEY = 'minesweeper_solo_color';

type Mode = 'pvp' | 'solo';

function loadStored<T extends string>(key: string, fallback: T): T {
  try {
    const v = localStorage.getItem(key);
    return (v as T) ?? fallback;
  } catch {
    return fallback;
  }
}

function loadStoredName(): string {
  try {
    return localStorage.getItem(NAME_STORAGE_KEY) ?? '';
  } catch {
    return '';
  }
}

export function Lobby({ onCreateRoom, onJoinRoom, onStartSolo, onUiClick }: LobbyProps) {
  const [name,   setName]   = useState<string>(() => loadStoredName());
  const [joinId, setJoinId] = useState('');
  const [nameErr, setNameErr] = useState('');
  const [presetIdx, setPresetIdx] = useState(DEFAULT_PRESET_INDEX);
  const [mode, setMode] = useState<Mode>(() => loadStored<Mode>(MODE_STORAGE_KEY, 'pvp'));
  const [difficulty, setDifficulty] = useState<Difficulty>(() =>
    loadStored<Difficulty>(DIFFICULTY_STORAGE_KEY, 'normal'),
  );
  const [humanColor, setHumanColor] = useState<PlayerColor>(() =>
    loadStored<PlayerColor>(COLOR_STORAGE_KEY, 'red'),
  );

  useEffect(() => {
    try {
      const trimmed = name.trim();
      if (trimmed) localStorage.setItem(NAME_STORAGE_KEY, trimmed);
    } catch { /* ignore */ }
  }, [name]);

  useEffect(() => {
    try { localStorage.setItem(MODE_STORAGE_KEY, mode); } catch { /* ignore */ }
  }, [mode]);
  useEffect(() => {
    try { localStorage.setItem(DIFFICULTY_STORAGE_KEY, difficulty); } catch { /* ignore */ }
  }, [difficulty]);
  useEffect(() => {
    try { localStorage.setItem(COLOR_STORAGE_KEY, humanColor); } catch { /* ignore */ }
  }, [humanColor]);

  const handleCreate = () => {
    if (!name.trim()) { setNameErr('Введите имя'); return; }
    setNameErr('');
    onCreateRoom(name.trim(), TIME_CONTROL_PRESETS[presetIdx].timeControl);
  };

  const handleJoin = () => {
    if (!name.trim()) { setNameErr('Введите имя'); return; }
    if (!joinId.trim()) return;
    setNameErr('');
    onJoinRoom(joinId.trim(), name.trim());
  };

  const handleStartSolo = () => {
    if (!name.trim()) { setNameErr('Введите имя'); return; }
    setNameErr('');
    onStartSolo?.(name.trim(), difficulty, humanColor);
  };

  const switchMode = (next: Mode) => {
    if (next === mode) return;
    onUiClick?.();
    setMode(next);
  };

  return (
    <div className={styles.container}>
      <div className={styles.brandHeader}>
        <h1 className={styles.brandTitle}>Minesweeper PvP</h1>
        <p className={styles.brandSubtitle}>Дуэль на минном поле</p>
      </div>

      {/* Имя — общее для обоих режимов */}
      <div className={styles.card}>
        <input
          className={`${styles.input} ${nameErr ? styles.inputError : ''}`}
          placeholder="Ваше имя"
          value={name}
          onChange={(e) => { setName(e.target.value); setNameErr(''); }}
          maxLength={20}
        />
        {nameErr && <div className={styles.fieldError}>{nameErr}</div>}

        <div className={styles.tcOptions}>
          <button
            type="button"
            className={`${styles.tcOption} ${mode === 'pvp' ? styles.tcOptionActive : ''}`}
            onClick={() => switchMode('pvp')}
          >
            👥 Против игрока
          </button>
          <button
            type="button"
            className={`${styles.tcOption} ${mode === 'solo' ? styles.tcOptionActive : ''}`}
            onClick={() => switchMode('solo')}
          >
            🤖 Против компьютера
          </button>
        </div>
      </div>

      {mode === 'pvp' ? (
        <>
          {/* Контроль времени — единая карточка над парой Создать/Войти */}
          <div className={styles.card}>
            <div className={styles.tcLabel}>⏱️ Контроль времени</div>
            <div className={`${styles.tcOptions} ${styles.tcOptionsGrid}`}>
              {TIME_CONTROL_PRESETS.map((preset, idx) => (
                <button
                  key={preset.label}
                  className={`${styles.tcOption} ${idx === presetIdx ? styles.tcOptionActive : ''}`}
                  onClick={() => {
                    if (idx !== presetIdx) onUiClick?.();
                    setPresetIdx(idx);
                  }}
                  type="button"
                >
                  {preset.label}
                </button>
              ))}
            </div>
          </div>

          <div className={styles.row}>
            {/* Создать комнату */}
            <div className={styles.card}>
              <h2>Создать комнату</h2>
              <p className={styles.hint}>Вы будете играть за 🔴 Красного</p>
              <p className={styles.hint}>Красный ходит первым</p>
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
                onChange={(e) => setJoinId(e.target.value.replace(/[^A-Za-z]/g, '').toUpperCase())}
                maxLength={5}
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
        </>
      ) : (
        <div className={styles.card}>
          <h2>Против компьютера</h2>

          <div className={styles.tcLabel}>Сложность</div>
          <div className={styles.tcOptions}>
            {(['easy', 'normal', 'hard'] as const).map((d) => (
              <button
                key={d}
                type="button"
                className={`${styles.tcOption} ${difficulty === d ? styles.tcOptionActive : ''}`}
                onClick={() => {
                  if (d !== difficulty) onUiClick?.();
                  setDifficulty(d);
                }}
              >
                {DIFFICULTY_LABELS[d]}
              </button>
            ))}
          </div>

          <div className={styles.tcLabel}>Ваш цвет</div>
          <p className={styles.hint}>Красный ходит первым</p>
          <div className={styles.tcOptions}>
            <button
              type="button"
              className={`${styles.tcOption} ${humanColor === 'red' ? styles.tcOptionActive : ''}`}
              onClick={() => {
                if (humanColor !== 'red') onUiClick?.();
                setHumanColor('red');
              }}
            >
              🔴 Красный
            </button>
            <button
              type="button"
              className={`${styles.tcOption} ${humanColor === 'blue' ? styles.tcOptionActive : ''}`}
              onClick={() => {
                if (humanColor !== 'blue') onUiClick?.();
                setHumanColor('blue');
              }}
            >
              🔵 Синий
            </button>
          </div>

          <button
            className={humanColor === 'red' ? styles.btnRed : styles.btnBlue}
            onClick={handleStartSolo}
          >
            Начать игру
          </button>
        </div>
      )}
    </div>
  );
}
