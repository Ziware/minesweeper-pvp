import React, { useState, useCallback } from 'react';
import { S2C_GameState, PlayerColor, CellMark } from '@minesweeper-pvp/shared';
import { Cell } from '../Cell/Cell';
import styles from './Board.module.css';

interface BoardProps {
  gameState: S2C_GameState;
  myColor: PlayerColor;
  onSelectZone: (row: number, col: number) => void;
  onCaptureCell: (row: number, col: number) => void;
  onDefuseCell: (row: number, col: number) => void;
  onPlaceMinePhase3: (row: number, col: number) => void;
  onToggleMark: (row: number, col: number, mark: CellMark) => void;
}

function inZoneWithCenter(
  r: number, c: number,
  centerRow: number, centerCol: number,
  halfSize: number
): boolean {
  return (
    r >= centerRow - halfSize && r <= centerRow + halfSize &&
    c >= centerCol - halfSize && c <= centerCol + halfSize
  );
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

// Вычисляем размер клетки в зависимости от размера экрана и boardSize
function useCellSize(boardSize: number): number {
  const [cellSize, setCellSize] = React.useState(44);

  React.useEffect(() => {
    function calc() {
      // Оставляем место для GameInfo (260px) + Legend (210px) + gaps + padding
      const reservedW = 260 + 210 + 24 * 4 + 32;
      const reservedH = 60 + 44 + 80; // header + bottomBar + padding
      const availW = window.innerWidth  - reservedW;
      const availH = window.innerHeight - reservedH;
      const maxByW = Math.floor(availW / boardSize);
      const maxByH = Math.floor(availH / boardSize);
      const size   = Math.max(32, Math.min(64, maxByW, maxByH));
      setCellSize(size);
    }
    calc();
    window.addEventListener('resize', calc);
    return () => window.removeEventListener('resize', calc);
  }, [boardSize]);

  return cellSize;
}

export function Board({
  gameState,
  myColor,
  onSelectZone,
  onCaptureCell,
  onDefuseCell,
  onPlaceMinePhase3,
  onToggleMark,
}: BoardProps) {
  const { board, turn, config } = gameState;
  const isMyTurn = turn.currentPlayer === myColor;

  const cellSize = useCellSize(config.boardSize);

  // Центр зон из selectedZone/actionZone
  const displayCenter = turn.selectedZone
    ? { row: turn.selectedZone.row + 1, col: turn.selectedZone.col + 1 }
    : null;
  const actionCenter = turn.actionZone
    ? { row: turn.actionZone.row + 2, col: turn.actionZone.col + 2 }
    : null;

  const [hoverCell, setHoverCell] = useState<{ row: number; col: number } | null>(null);

  const isInDisplayZone = useCallback(
    (r: number, c: number) =>
      displayCenter !== null &&
      inZoneWithCenter(r, c, displayCenter.row, displayCenter.col, 1),
    [displayCenter]
  );

  const isInActionZone = useCallback(
    (r: number, c: number) =>
      actionCenter !== null &&
      inZoneWithCenter(r, c, actionCenter.row, actionCenter.col, 2),
    [actionCenter]
  );

  const isInHoverDisplay = (r: number, c: number) =>
    hoverCell !== null && isMyTurn && turn.phase === 'phase1' &&
    inZoneWithCenter(r, c, hoverCell.row, hoverCell.col, 1);

  const isInHoverAction = (r: number, c: number) =>
    hoverCell !== null && isMyTurn && turn.phase === 'phase1' &&
    inZoneWithCenter(r, c, hoverCell.row, hoverCell.col, 2);

  const handleClick = (r: number, c: number, e: React.MouseEvent) => {
    if (!isMyTurn) return;
    const cell  = board[r][c];
    const phase = turn.phase;

    if (phase === 'phase1') {
      onSelectZone(r, c);
      return;
    }
    if (phase === 'phase2') {
      if (e.ctrlKey || e.metaKey) {
        if (cell.owner !== myColor && isInActionZone(r, c)) onDefuseCell(r, c);
        return;
      }
      if (cell.owner !== myColor && isInActionZone(r, c)) onCaptureCell(r, c);
      return;
    }
    if (phase === 'phase3') {
      const reachableCells = getReachableCells(board, myColor, config.boardSize);
      if (
        cell.owner === myColor &&
        cell.hasMine === false &&
        !isHeadquartersCell(r, c, config.boardSize) &&
        reachableCells.has(`${r},${c}`)
      ) {
        onPlaceMinePhase3(r, c);
      }
    }
  };

  const handleRightClick = (e: React.MouseEvent, r: number, c: number) => {
    e.preventDefault();
    const cell = board[r][c];
    const next: Record<CellMark, CellMark> = {
      none: 'flag', flag: 'question', question: 'none',
    };
    onToggleMark(r, c, next[cell.mark]);
  };

  const getZoneType = (r: number, c: number): 'display' | 'action' | 'none' => {
    if (isInDisplayZone(r, c)) return 'display';
    if (isInActionZone(r, c))  return 'action';
    return 'none';
  };

  const getHoverZoneType = (r: number, c: number): 'display' | 'action' | 'none' => {
    if (isInHoverDisplay(r, c)) return 'display';
    if (isInHoverAction(r, c))  return 'action';
    return 'none';
  };

  const showLegend = !!(displayCenter || (hoverCell && turn.phase === 'phase1' && isMyTurn));

  return (
    <div className={styles.wrapper}>
      <div
        className={styles.board}
        style={{
          gridTemplateColumns: `repeat(${config.boardSize}, ${cellSize}px)`,
        }}
      >
        {board.map((row, r) =>
          row.map((cell, c) => {
            const activeZone = getZoneType(r, c);
            const hoverZone  = getHoverZoneType(r, c);
            const finalZone  = activeZone !== 'none' ? activeZone : hoverZone;
            const isHover    = activeZone === 'none' && hoverZone !== 'none';
            // Клетка в активной зоне (не превью) — скрываем мину
            const isInActive = activeZone !== 'none';

            return (
              <div
                key={`${r}-${c}`}
                style={{ width: cellSize, height: cellSize }}
                onMouseEnter={() => setHoverCell({ row: r, col: c })}
                onMouseLeave={() => setHoverCell(null)}
              >
                <Cell
                  cell={cell}
                  row={r}
                  col={c}
                  myColor={myColor}
                  zoneType={finalZone}
                  isHover={isHover}
                  isInActiveZone={isInActive}
                  isHeadquarters={isHeadquartersCell(r, c, config.boardSize)}
                  gamePhase={turn.phase}
                  isMyTurn={isMyTurn}
                  onClick={(e) => handleClick(r, c, e)}
                  onRightClick={(e) => handleRightClick(e, r, c)}
                />
              </div>
            );
          })
        )}
      </div>

      <div className={styles.bottomBar}>
        {showLegend && (
          <div className={styles.zoneLegend}>
            <span className={styles.legendDisplay}>■ Зона 3×3 — отображение</span>
            <span className={styles.legendAction}>■ Зона 5×5 — ходы</span>
            <span className={styles.legendHeadquarters}>🏰 Штаб</span>
          </div>
        )}
        {isMyTurn && turn.phase === 'phase2' && turn.canDefuse && (
          <div className={styles.hint}>
            🔧 <strong>Ctrl+Click</strong> на вражескую клетку в зоне 5×5 — разминировать. Захват — только по общей стороне.
          </div>
        )}
        {!showLegend && !(isMyTurn && turn.phase === 'phase2' && turn.canDefuse) && (
          <div className={styles.placeholder} />
        )}
      </div>
    </div>
  );
}
