import React from 'react';
import { S2C_GameState, PlayerColor } from '@minesweeper-pvp/shared';
import styles from './MineSetup.module.css';

interface MineSetupProps {
  gameState: S2C_GameState;
  myColor: PlayerColor;
  onPlaceMine: (row: number, col: number) => void;
  onConfirm: () => void;
  errorMsg: string;
}

export function MineSetup({
  gameState,
  myColor,
  onPlaceMine,
  onConfirm,
  errorMsg,
}: MineSetupProps) {
  const { board, players, config } = gameState;
  const me = players.find((p) => p.color === myColor)!;
  const opponent = players.find((p) => p.color !== myColor);

  const iConfirmed = me.setupConfirmed;
  const opponentConfirmed = opponent?.setupConfirmed ?? false;
  const canConfirm = me.minesPlaced === config.initialMines && !iConfirmed;

  const colorLabel = myColor === 'red' ? '🔴 Красный' : '🔵 Синий';

  return (
    <div className={styles.container}>
      <h2 className={styles.title}>{colorLabel} — Расстановка мин</h2>

      <p className={styles.subtitle}>
        Поставьте ровно <strong>{config.initialMines}</strong> мин на свою половину.
        Поставлено: <strong>{me.minesPlaced}/{config.initialMines}</strong>
      </p>

      <div
        className={styles.board}
        style={{ gridTemplateColumns: `repeat(${config.boardSize}, 40px)` }}
      >
        {board.map((row, r) =>
          row.map((cell, c) => {
            const isOwn = cell.owner === myColor;
            const isMine = cell.hasMine;
            const clickable = isOwn && !iConfirmed;
            return (
              <div
                key={`${r}-${c}`}
                className={[
                  styles.cell,
                  isOwn ? styles[myColor] : styles.enemy,
                  isMine && isOwn ? styles.mine : '',
                  clickable ? styles.clickable : '',
                ].join(' ')}
                onClick={() => clickable && onPlaceMine(r, c)}
              >
                {isMine && isOwn ? '💣' : ''}
              </div>
            );
          })
        )}
      </div>

      {/* Кнопка подтверждения */}
      {!iConfirmed ? (
        <button
          className={styles.confirmBtn}
          onClick={onConfirm}
          disabled={!canConfirm}
        >
          {canConfirm
            ? 'Подтвердить расстановку ✓'
            : `Нужно поставить ещё ${config.initialMines - me.minesPlaced} мин`}
        </button>
      ) : (
        <div className={styles.waitingBox}>
          <div className={styles.waitingSpinner}>⏳</div>
          <div className={styles.waitingText}>
            Расстановка подтверждена!
            <br />
            <span className={styles.waitingSubtext}>
              {opponentConfirmed
                ? 'Оба игрока готовы, начинаем...'
                : 'Ожидание расстановки соперника...'}
            </span>
          </div>
        </div>
      )}

      {errorMsg && <div className={styles.error}>{errorMsg}</div>}
    </div>
  );
}
