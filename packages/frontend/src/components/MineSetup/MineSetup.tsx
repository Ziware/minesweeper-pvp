import React, { useCallback } from 'react';
import { S2C_GameState, PlayerColor } from '@minesweeper-pvp/shared';
import { Cell } from '../Cell/Cell';
import styles from './MineSetup.module.css';

interface MineSetupProps {
  gameState: S2C_GameState;
  myColor: PlayerColor;
  onPlaceMine: (row: number, col: number) => void;
  onConfirm: () => void;
}

function useCellSize(boardSize: number): number {
  const [cellSize, setCellSize] = React.useState(44);
  React.useEffect(() => {
    function calc() {
      const reservedH = 220;
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

function isHeadquartersCell(row: number, col: number, boardSize: number): boolean {
  const firstCol = Math.floor((boardSize - 2) / 2);
  return (row === 0 || row === boardSize - 1) && (col === firstCol || col === firstCol + 1);
}

function getReachableCells(
  board: S2C_GameState['board'],
  playerColor: PlayerColor,
  boardSize: number,
): Set<string> {
  const firstCol = Math.floor((boardSize - 2) / 2);
  const startRow = playerColor === 'red' ? 0 : boardSize - 1;
  const starts = [
    { row: startRow, col: firstCol },
    { row: startRow, col: firstCol + 1 },
  ];
  const reachable = new Set<string>();
  const queue: Array<{ row: number; col: number }> = [];

  for (const start of starts) {
    if (board[start.row]?.[start.col]?.owner !== playerColor) continue;
    const key = `${start.row},${start.col}`;
    reachable.add(key);
    queue.push(start);
  }

  const directions = [[-1, 0], [1, 0], [0, -1], [0, 1]] as const;
  for (let i = 0; i < queue.length; i++) {
    const current = queue[i];
    for (const [dr, dc] of directions) {
      const nr = current.row + dr;
      const nc = current.col + dc;
      if (nr < 0 || nr >= boardSize || nc < 0 || nc >= boardSize) continue;
      if (board[nr][nc].owner !== playerColor) continue;

      const key = `${nr},${nc}`;
      if (reachable.has(key)) continue;
      reachable.add(key);
      queue.push({ row: nr, col: nc });
    }
  }

  return reachable;
}

export function MineSetup({
  gameState,
  myColor,
  onPlaceMine,
  onConfirm,
}: MineSetupProps) {
  const { board, players, config } = gameState;
  const me       = players.find((p) => p.color === myColor)!;
  const opponent = players.find((p) => p.color !== myColor);

  const iConfirmed        = me.setupConfirmed;
  const opponentConfirmed = opponent?.setupConfirmed ?? false;
  const canConfirm        = me.minesPlaced === config.initialMines && !iConfirmed;

  const cellSize = useCellSize(config.boardSize);

  const handleCellClick = useCallback((r: number, c: number) => {
    const cell = board[r][c];
    const isOwn = cell.owner === myColor;
    const reachableCells = getReachableCells(board, myColor, config.boardSize);
    if (
      isOwn &&
      !iConfirmed &&
      !isHeadquartersCell(r, c, config.boardSize) &&
      reachableCells.has(`${r},${c}`)
    ) {
      onPlaceMine(r, c);
    }
  }, [board, config.boardSize, myColor, iConfirmed, onPlaceMine]);

  const handleRightClick = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
  }, []);

  const colorLabel   = myColor === 'red' ? '🔴 Красный' : '🔵 Синий';
  const opponentName = opponent?.name ?? 'Противник';

  return (
    <div className={styles.container}>
      <div className={styles.header}>
        <h2 className={styles.title}>{colorLabel} — Расстановка мин</h2>
        <p className={styles.subtitle}>
          Поставьте ровно <strong>{config.initialMines}</strong> мин на доступные клетки своей половины. 🏰 отмечает штабы.&nbsp;
          Поставлено: <strong>{me.minesPlaced}/{config.initialMines}</strong>
        </p>
        <p className={styles.opponentLine}>
          Противник: <strong>{opponentName}</strong>&nbsp;
          {opponentConfirmed
            ? <span className={styles.ready}>✓ готов</span>
            : <span className={styles.waiting}>⏳ расставляет мины...</span>}
        </p>
      </div>

      <div
        className={styles.board}
        style={{ gridTemplateColumns: `repeat(${config.boardSize}, ${cellSize}px)` }}
      >
        {board.map((row, r) =>
          row.map((cell, c) => (
            <div
              key={`${r}-${c}`}
              style={{ width: cellSize, height: cellSize }}
              // Обработчик ТОЛЬКО здесь, не в Cell
              onClick={() => handleCellClick(r, c)}
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
                isHeadquarters={isHeadquartersCell(r, c, config.boardSize)}
                gamePhase="setup"
                isMyTurn={!iConfirmed}
                // Cell получает заглушки — клик обрабатывается на div выше
                onClick={() => {}}
                onRightClick={handleRightClick}
              />
            </div>
          ))
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

    </div>
  );
}
