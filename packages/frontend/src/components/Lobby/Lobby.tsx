import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { TimeControl, TIME_CONTROL_PRESETS, BALANCE, PlayerColor } from '@minesweeper-pvp/shared';
import type { Difficulty } from '../../ai/types';
import { DIFFICULTY_LABELS } from '../../ai/difficulty';
import styles from './Lobby.module.css';

interface LobbyProps {
  onCreateRoom:        (timeControl: TimeControl) => void;
  onJoinRoom:          (roomId: string) => void;
  /** Запустить серверную игру против компьютера. */
  onStartBotGame?:     (difficulty: Difficulty, humanColor: PlayerColor) => void;
  /** Опциональный звук-эффект «клик», прокидывается из App. */
  onUiClick?:          () => void;
}

const DEFAULT_PRESET_INDEX = BALANCE.timeControls.defaultPresetIndex;
const DIFFICULTY_STORAGE_KEY = 'minesweeper_solo_difficulty';
const COLOR_STORAGE_KEY = 'minesweeper_solo_color';

type ActiveCard = 'pvp' | 'solo' | null;

function loadStored<T extends string>(key: string, fallback: T): T {
  try {
    const v = localStorage.getItem(key);
    return (v as T) ?? fallback;
  } catch {
    return fallback;
  }
}

export function Lobby({ onCreateRoom, onJoinRoom, onStartBotGame, onUiClick }: LobbyProps) {
  const [activeCard, setActiveCard] = useState<ActiveCard>(null);
  const [joinId, setJoinId] = useState('');
  const [joinErr, setJoinErr] = useState('');
  const [presetIdx, setPresetIdx] = useState(DEFAULT_PRESET_INDEX);
  const [difficulty, setDifficulty] = useState<Difficulty>(() =>
    loadStored<Difficulty>(DIFFICULTY_STORAGE_KEY, 'normal'),
  );
  const [humanColor, setHumanColor] = useState<PlayerColor>(() =>
    loadStored<PlayerColor>(COLOR_STORAGE_KEY, 'red'),
  );

  useEffect(() => {
    try { localStorage.setItem(DIFFICULTY_STORAGE_KEY, difficulty); } catch { /* ignore */ }
  }, [difficulty]);
  useEffect(() => {
    try { localStorage.setItem(COLOR_STORAGE_KEY, humanColor); } catch { /* ignore */ }
  }, [humanColor]);

  const toggleCard = (card: ActiveCard) => {
    onUiClick?.();
    setActiveCard((prev) => (prev === card ? null : card));
  };

  const handleCreate = () => {
    onCreateRoom(TIME_CONTROL_PRESETS[presetIdx].timeControl);
  };

  const handleJoin = () => {
    if (!joinId.trim()) { setJoinErr('Введите ID комнаты'); return; }
    setJoinErr('');
    onJoinRoom(joinId.trim());
  };

  const handleStartBotGame = () => {
    onStartBotGame?.(difficulty, humanColor);
  };

  return (
    <div className={styles.container}>
      {/* ── Hero ── */}
      <div className={styles.hero}>
        <h1 className={styles.heroTitle}>💣 Minesweeper PvP</h1>
        <p className={styles.heroTagline}>Тактическая дуэль на минном поле</p>
        <p className={styles.heroDesc}>
          Два игрока. Одна доска. Мины противника скрыты.
          Захвати штаб врага — и победишь.
        </p>
      </div>

      {/* ── Mode cards ── */}
      <div className={styles.cards}>
        {/* PvP Card */}
        <div
          className={`${styles.modeCard} ${activeCard === 'pvp' ? styles.modeCardActive : ''}`}
          onClick={() => toggleCard('pvp')}
          role="button"
          tabIndex={0}
          onKeyDown={(e) => e.key === 'Enter' && toggleCard('pvp')}
          aria-expanded={activeCard === 'pvp'}
        >
          <div className={styles.modeCardIcon}>👥</div>
          <div className={styles.modeCardBody}>
            <div className={styles.modeCardTitle}>Против игрока</div>
            <div className={styles.modeCardDesc}>
              Онлайн-дуэль с живым противником. Создай комнату и поделись кодом или введи код друга.
            </div>
          </div>
          <button
            className={`${styles.modeCardBtn} ${activeCard === 'pvp' ? styles.modeCardBtnActive : ''}`}
            onClick={(e) => { e.stopPropagation(); toggleCard('pvp'); }}
            type="button"
          >
            {activeCard === 'pvp' ? '▲ Скрыть' : 'Играть'}
          </button>
        </div>

        {/* Bot Card */}
        <div
          className={`${styles.modeCard} ${activeCard === 'solo' ? styles.modeCardActive : ''}`}
          onClick={() => toggleCard('solo')}
          role="button"
          tabIndex={0}
          onKeyDown={(e) => e.key === 'Enter' && toggleCard('solo')}
          aria-expanded={activeCard === 'solo'}
        >
          <div className={styles.modeCardIcon}>🤖</div>
          <div className={styles.modeCardBody}>
            <div className={styles.modeCardTitle}>Против компьютера</div>
            <div className={styles.modeCardDesc}>
              Тренируйся оффлайн против ИИ трёх уровней сложности — без регистрации.
            </div>
          </div>
          <button
            className={`${styles.modeCardBtn} ${activeCard === 'solo' ? styles.modeCardBtnActive : ''}`}
            onClick={(e) => { e.stopPropagation(); toggleCard('solo'); }}
            type="button"
          >
            {activeCard === 'solo' ? '▲ Скрыть' : 'Играть'}
          </button>
        </div>

        {/* Classic Card */}
        <Link to="/classic" className={styles.modeCard} onClick={() => onUiClick?.()}>
          <div className={styles.modeCardIcon}>💣</div>
          <div className={styles.modeCardBody}>
            <div className={styles.modeCardTitle}>Классический сапёр</div>
            <div className={styles.modeCardDesc}>
              Стандартный Сапёр на скорость. Пресеты новичок/любитель/эксперт или своё поле.
            </div>
          </div>
          <div className={styles.modeCardBtn}>Открыть</div>
        </Link>
      </div>

      {/* ── Inline expand: PvP ── */}
      {activeCard === 'pvp' && (
        <div className={styles.expandPanel}>
          <div className={styles.expandSection}>
            <div className={styles.expandLabel}>⏱️ Контроль времени</div>
            <div className={styles.presetGrid}>
              {TIME_CONTROL_PRESETS.map((preset, idx) => (
                <button
                  key={preset.label}
                  className={`${styles.presetBtn} ${idx === presetIdx ? styles.presetBtnActive : ''}`}
                  onClick={() => { if (idx !== presetIdx) onUiClick?.(); setPresetIdx(idx); }}
                  type="button"
                >
                  {preset.label}
                </button>
              ))}
            </div>
          </div>

          <div className={styles.expandRow}>
            {/* Создать */}
            <div className={styles.expandCard}>
              <div className={styles.expandCardTitle}>Создать комнату</div>
              <div className={styles.expandCardHint}>Вы играете за 🔴 Красного · ходит первым</div>
              <button className={styles.btnRed} onClick={handleCreate}>
                Создать
              </button>
            </div>

            <div className={styles.expandDivider} />

            {/* Войти */}
            <div className={styles.expandCard}>
              <div className={styles.expandCardTitle}>Войти в комнату</div>
              <input
                className={`${styles.input} ${joinErr ? styles.inputError : ''}`}
                placeholder="ID комнаты (5 букв)"
                value={joinId}
                onChange={(e) => {
                  setJoinId(e.target.value.replace(/[^A-Za-z]/g, '').toUpperCase());
                  setJoinErr('');
                }}
                maxLength={5}
              />
              {joinErr && <div className={styles.fieldError}>{joinErr}</div>}
              <div className={styles.expandCardHint}>Вы играете за 🔵 Синего</div>
              <button
                className={styles.btnBlue}
                onClick={handleJoin}
                disabled={!joinId.trim()}
              >
                Войти
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Inline expand: Solo ── */}
      {activeCard === 'solo' && (
        <div className={styles.expandPanel}>
          <div className={styles.expandSection}>
            <div className={styles.expandLabel}>Сложность</div>
            <div className={styles.presetRow}>
              {(['easy', 'normal', 'hard'] as const).map((d) => (
                <button
                  key={d}
                  type="button"
                  className={`${styles.presetBtn} ${difficulty === d ? styles.presetBtnActive : ''}`}
                  onClick={() => { if (d !== difficulty) onUiClick?.(); setDifficulty(d); }}
                >
                  {DIFFICULTY_LABELS[d]}
                </button>
              ))}
            </div>
          </div>

          <div className={styles.expandSection}>
            <div className={styles.expandLabel}>Ваш цвет · Красный ходит первым</div>
            <div className={styles.presetRow}>
              <button
                type="button"
                className={`${styles.presetBtn} ${humanColor === 'red' ? styles.presetBtnActive : ''}`}
                onClick={() => { if (humanColor !== 'red') onUiClick?.(); setHumanColor('red'); }}
              >
                🔴 Красный
              </button>
              <button
                type="button"
                className={`${styles.presetBtn} ${humanColor === 'blue' ? styles.presetBtnActive : ''}`}
                onClick={() => { if (humanColor !== 'blue') onUiClick?.(); setHumanColor('blue'); }}
              >
                🔵 Синий
              </button>
            </div>
          </div>

          <button
            className={humanColor === 'red' ? styles.btnRed : styles.btnBlue}
            onClick={handleStartBotGame}
          >
            Начать игру
          </button>
        </div>
      )}
    </div>
  );
}
