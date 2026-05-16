import React, { useState, useCallback } from 'react';
import { S2C_GameState, PlayerColor } from '@minesweeper-pvp/shared';
import { Cell } from '../Cell/Cell';
import styles from './MineSetup.module.css';

interface MineSetupProps {
  gameState: S2C_GameState;
  myColor: PlayerColor;
  onPlaceMine: (row: number, col: number) => void;
  onConfirm: () => void;
  errorMsg: string;
}

function useCellSize(boardSize: number): number {
  const [cellSize, setCellSize] = React.useState(44);
  React.useEffect(() => {
    function calc() {
      const reservedH = 220; // заголовок + кнопка + отступы
      const reservedW = 80;
      const availW = window.innerWidth  - reservedW;
      const availH = window.innerHeight - reservedH;
      const size   = Math.max(32, Math.min(64, Math.floor(availW / boardSize), Math.floor(availH / boardSize)));
      setCellSize(size);
    }
    calc();
    window.addEventListener('resize', calc);
    return () => window.removeEventListener('resize', calc);
  }, [boardSize]);
  return cellSize;
}

export function MineSetup({
  gameState,
  myColor,
  onPlaceMine,
  onConfirm,
  errorMsg,
}: MineSetupProps) {
  const { board, players, config } = gameState;
  const me       = players.find((p) => p.color === myColor)!;
  const opponent = players.find((p) => p.color !== myColor);

  const iConfirmed       = me.setupConfirmed;
  const opponentConfirmed = opponent?.setupConfirmed ?? false;
  const canConfirm        = me.minesPlaced === config.initialMines && !iConfirmed;

  const cellSize = useCellSize(config.boardSize);

  const handleRightClick = (e: React.MouseEvent) => e.preventDefault();

  const colorLabel = myColor === 'red' ? '🔴 Красный' : '🔵 Синий';
  const opponentName = opponent?.name ?? 'Противник';

  return (
    <div className={styles.container}>
      <div className={styles.header}>
        <h2 className={styles.title}>{colorLabel} — Расстановка мин</h2>
        <p className={styles.subtitle}>
          Поставьте ровно <strong>{config.initialMines}</strong> мин на свою половину.&nbsp;
          Поставлено: <strong>{me.minesPlaced}/{config.initialMines}</strong>
        </p>
        <p className={styles.opponentLine}>
          Противник: <strong>{opponentName}</strong>&nbsp;
          {opponentConfirmed
            ? <span className={styles.ready}>✓ готов</span>
            : <span className={styles.waiting}>⏳ расставляет мины...</span>}
        </p>
      </div>

      {/* Та же сетка что и в игре */}
      <div
        className={styles.board}
        style={{ gridTemplateColumns: `repeat(${config.boardSize}, ${cellSize}px)` }}
      >
        {board.map((row, r) =>
          row.map((cell, c) => {
            const isOwn     = cell.owner === myColor;
            const clickable = isOwn && !iConfirmed;

            return (
              <div
                key={`${r}-${c}`}
                style={{ width: cellSize, height: cellSize }}
                onClick={() => clickable && onPlaceMine(r, c)}
                onContextMenu={handleRightClick}
              >
                <Cell
                  cell={cell}
                  row={r}
                  col={c}
                  myColor={myColor}
                  zoneType="none"
                  isHover={false}
                  isInActiveZone={false}
                  gamePhase="setup"
                  isMyTurn={!iConfirmed}
                  onClick={() => clickable && onPlaceMine(r, c)}
                  onRightClick={handleRightClick}
                />
              </div>
            );
          })
        )}
      </div>

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
          <span className={styles.waitingSpinner}>⏳</span>
          <div>
            <div className={styles.waitingText}>Расстановка подтверждена!</div>
            <div className={styles.waitingSubtext}>
              {opponentConfirmed
                ? 'Оба готовы, начинаем...'
                : `Ожидание ${opponentName}...`}
            </div>
          </div>
        </div>
      )}

      {errorMsg && <div className={styles.error}>{errorMsg}</div>}
    </div>
  );
}
