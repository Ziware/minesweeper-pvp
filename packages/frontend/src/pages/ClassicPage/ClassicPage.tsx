import React, { useState } from 'react';
import { NavBar } from '../../components/NavBar/NavBar';
import { ClassicBoard } from '../../components/ClassicBoard/ClassicBoard';
import { useClassicGame, CLASSIC_PRESETS } from '../../hooks/useClassicGame';
import { useAuth } from '../../hooks/useAuth';
import { useSettings } from '../../hooks/useSettings';
import { useSound } from '../../hooks/useSound';
import styles from './ClassicPage.module.css';

const CUSTOM_KEY = 'minesweeper_classic_custom';

interface CustomConfig { rows: number; cols: number; mines: number; }

function loadCustom(): CustomConfig {
  try {
    const v = localStorage.getItem(CUSTOM_KEY);
    if (v) return JSON.parse(v);
  } catch { /* ignore */ }
  return { rows: 16, cols: 16, mines: 40 };
}

function saveCustom(cfg: CustomConfig) {
  try { localStorage.setItem(CUSTOM_KEY, JSON.stringify(cfg)); } catch { /* ignore */ }
}

function clamp(v: number, min: number, max: number) { return Math.min(max, Math.max(min, v)); }

function formatTime(ms: number): string {
  const s = Math.floor(ms / 1000);
  const min = Math.floor(s / 60);
  const sec = s % 60;
  if (min > 0) return `${min}:${sec.toString().padStart(2, '0')}`;
  return `${sec}s`;
}

// Determine appropriate cell size based on board columns
function cellSize(cols: number): number {
  if (cols <= 9) return 40;
  if (cols <= 16) return 32;
  return 26;
}

export function ClassicPage() {
  const auth = useAuth();
  const settings = useSettings();
  const { play } = useSound({ mutedRef: settings.mutedRef, volumeRef: settings.volumeRef });

  const [presetKey, setPresetKey] = useState<string>(CLASSIC_PRESETS[0].key);
  const [customMode, setCustomMode] = useState(false);
  const [custom, setCustom] = useState<CustomConfig>(loadCustom);
  const [customDraft, setCustomDraft] = useState<CustomConfig>(loadCustom);

  const activePreset = CLASSIC_PRESETS.find((p) => p.key === presetKey);
  const activeRows  = customMode ? custom.rows  : (activePreset?.rows  ?? 9);
  const activeCols  = customMode ? custom.cols  : (activePreset?.cols  ?? 9);
  const activeMines = customMode ? custom.mines : (activePreset?.mines ?? 10);
  const activePKey  = customMode ? `custom_${activeRows}x${activeCols}_${activeMines}` : presetKey;

  const game = useClassicGame(activeRows, activeCols, activeMines, activePKey);

  const minesRemaining = game.minesTotal - game.flagsPlaced;

  const handlePreset = (key: string) => {
    play('button');
    setPresetKey(key);
    setCustomMode(false);
  };

  const handleCustomApply = () => {
    const cfg: CustomConfig = {
      rows:  clamp(customDraft.rows,  8, 30),
      cols:  clamp(customDraft.cols,  8, 30),
      mines: clamp(customDraft.mines, 1, Math.floor(customDraft.rows * customDraft.cols / 3)),
    };
    setCustom(cfg);
    setCustomDraft(cfg);
    saveCustom(cfg);
    setCustomMode(true);
    play('button');
  };

  const handleRestart = () => {
    play('button');
    game.restart();
  };

  const handleReveal = (r: number, c: number) => {
    play('scan');
    game.reveal(r, c);
  };

  const handleChord = (r: number, c: number) => {
    play('scan');
    game.chord(r, c);
  };

  const cs = cellSize(activeCols);

  return (
    <div className={styles.layout}>
      <NavBar auth={auth} settings={settings} />

      <div className={styles.body}>
        <h1 className={styles.title}>Классический Сапёр</h1>

        {/* ── Preset selector ── */}
        <div className={styles.presets}>
          {CLASSIC_PRESETS.map((p) => (
            <button
              key={p.key}
              className={`${styles.presetBtn} ${!customMode && presetKey === p.key ? styles.presetBtnActive : ''}`}
              onClick={() => handlePreset(p.key)}
              type="button"
            >
              {p.label}
            </button>
          ))}
          <button
            className={`${styles.presetBtn} ${customMode ? styles.presetBtnActive : ''}`}
            onClick={() => { play('button'); setCustomMode((v) => !v); }}
            type="button"
          >
            ⚙ Своё
          </button>
        </div>

        {/* ── Custom config panel ── */}
        {customMode && (
          <div className={styles.customPanel}>
            <label className={styles.customLabel}>
              Строки (8–30)
              <input
                type="number"
                min={8} max={30}
                value={customDraft.rows}
                onChange={(e) => setCustomDraft((d) => ({ ...d, rows: parseInt(e.target.value) || d.rows }))}
                className={styles.customInput}
              />
            </label>
            <label className={styles.customLabel}>
              Столбцы (8–30)
              <input
                type="number"
                min={8} max={30}
                value={customDraft.cols}
                onChange={(e) => setCustomDraft((d) => ({ ...d, cols: parseInt(e.target.value) || d.cols }))}
                className={styles.customInput}
              />
            </label>
            <label className={styles.customLabel}>
              Мины
              <input
                type="number"
                min={1} max={Math.floor(customDraft.rows * customDraft.cols / 3)}
                value={customDraft.mines}
                onChange={(e) => setCustomDraft((d) => ({ ...d, mines: parseInt(e.target.value) || d.mines }))}
                className={styles.customInput}
              />
            </label>
            <button className={styles.applyBtn} onClick={handleCustomApply} type="button">
              Применить
            </button>
          </div>
        )}

        {/* ── Status bar ── */}
        <div className={styles.statusBar}>
          <div className={styles.statusItem}>
            💣 <span className={styles.statusValue}>{minesRemaining}</span>
            <span className={styles.statusLabel}> осталось</span>
          </div>
          <div className={styles.statusItem}>
            ⏱ <span className={styles.statusValue}>
              {game.status === 'idle' ? '0s' : formatTime(game.elapsedMs)}
            </span>
          </div>
          <button className={styles.restartBtn} onClick={handleRestart} type="button" title="Рестарт">
            🔄 Рестарт
          </button>
        </div>

        {/* ── Game result banner ── */}
        {game.status === 'won' && (
          <div className={`${styles.resultBanner} ${styles.resultWon}`}>
            🏆 Победа! {formatTime(game.elapsedMs)}
            {game.bestTimeMs !== null && game.elapsedMs <= game.bestTimeMs && (
              <span className={styles.bestBadge}> 🥇 Лучшее время!</span>
            )}
          </div>
        )}
        {game.status === 'lost' && (
          <div className={`${styles.resultBanner} ${styles.resultLost}`}>
            💥 Вы подорвались!{' '}
            <button className={styles.tryAgainBtn} onClick={handleRestart}>Ещё раз</button>
          </div>
        )}

        {/* ── Board ── */}
        <div className={styles.boardWrap}>
          <ClassicBoard
            cells={game.board}
            status={game.status}
            cellSize={cs}
            onReveal={handleReveal}
            onFlag={game.cycleFlag}
            onChord={handleChord}
            firstClickHint={game.status === 'idle'}
          />
        </div>

        {/* ── Best times ── */}
        <div className={styles.bestTimes}>
          <div className={styles.bestTimesTitle}>🏆 Лучшее время</div>
          <div className={styles.bestTimesRow}>
            {CLASSIC_PRESETS.map((p) => {
              const best = localStorage.getItem(`minesweeper_classic_best_${p.key}`);
              return (
                <div key={p.key} className={styles.bestTimeItem}>
                  <span className={styles.bestTimeLabel}>{p.label}</span>
                  <span className={styles.bestTimeValue}>{best ? formatTime(parseInt(best)) : '—'}</span>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}
