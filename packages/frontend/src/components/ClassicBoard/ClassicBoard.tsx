import React, { useCallback } from 'react';
import type { ClassicCell, ClassicStatus } from '../../hooks/useClassicGame';
import { Icon } from '../Icon/Icon';
import styles from './ClassicBoard.module.css';

interface ClassicBoardProps {
  cells: ClassicCell[][];
  status: ClassicStatus;
  /** Cell size in px, injected from ClassicPage */
  cellSize: number;
  onReveal: (r: number, c: number) => void;
  onFlag: (r: number, c: number) => void;
  onChord: (r: number, c: number) => void;
  /** Show subtle glow on center cells before first click */
  firstClickHint?: boolean;
}

const NUMBER_COLORS: Record<number, string> = {
  1: '#4fc3f7',
  2: '#81c784',
  3: '#e57373',
  4: '#ba68c8',
  5: '#ff8a65',
  6: '#4dd0e1',
  7: '#fff176',
  8: '#cfd8dc',
};

function getCellContent(cell: ClassicCell, status: ClassicStatus): React.ReactNode {
  if (!cell.revealed) {
    if (status === 'lost' && cell.hasMine && !cell.flagged) return <Icon name="mine" size="75%" />;
    if (cell.flagged)    return <span className={styles.icon}>🚩</span>;
    if (cell.questioned) return <span className={styles.icon}>❓</span>;
    return null;
  }
  if (cell.hasMine) return <Icon name="mine" size="75%" />;
  if (cell.adjacentMines > 0) {
    return (
      <span style={{
        color: NUMBER_COLORS[cell.adjacentMines] ?? '#eee',
        fontWeight: 'bold',
        fontSize: '1rem',
        lineHeight: 1,
      }}>
        {cell.adjacentMines}
      </span>
    );
  }
  return null;
}

function countAdjFlags(cells: ClassicCell[][], r: number, c: number, rows: number, cols: number): number {
  let count = 0;
  for (let dr = -1; dr <= 1; dr++) {
    for (let dc = -1; dc <= 1; dc++) {
      if (dr === 0 && dc === 0) continue;
      const nr = r + dr; const nc = c + dc;
      if (nr >= 0 && nr < rows && nc >= 0 && nc < cols && cells[nr][nc].flagged) count++;
    }
  }
  return count;
}

function countUnflaggedUnrevealed(cells: ClassicCell[][], r: number, c: number, rows: number, cols: number): number {
  let count = 0;
  for (let dr = -1; dr <= 1; dr++) {
    for (let dc = -1; dc <= 1; dc++) {
      if (dr === 0 && dc === 0) continue;
      const nr = r + dr; const nc = c + dc;
      if (nr >= 0 && nr < rows && nc >= 0 && nc < cols) {
        const n = cells[nr][nc];
        if (!n.revealed && !n.flagged) count++;
      }
    }
  }
  return count;
}

export function ClassicBoard({
  cells,
  status,
  cellSize,
  onReveal,
  onFlag,
  onChord,
  firstClickHint = false,
}: ClassicBoardProps) {
  const rows = cells.length;
  const cols = cells[0]?.length ?? 0;

  const handleClick = useCallback((e: React.MouseEvent, r: number, c: number) => {
    e.preventDefault();
    const cell = cells[r][c];
    if (status === 'won' || status === 'lost') return;
    if (cell.flagged) return;

    if (cell.revealed && cell.adjacentMines > 0) {
      const flagCount          = countAdjFlags(cells, r, c, rows, cols);
      const unflaggedUnrevealed = countUnflaggedUnrevealed(cells, r, c, rows, cols);

      if (flagCount === cell.adjacentMines) {
        // Standard chord: reveal all unflagged unrevealed neighbors
        onChord(r, c);
      } else if (unflaggedUnrevealed > 0 && flagCount + unflaggedUnrevealed === cell.adjacentMines) {
        // Auto-flag chord: remaining unflagged neighbors must all be mines
        for (let dr = -1; dr <= 1; dr++) {
          for (let dc = -1; dc <= 1; dc++) {
            if (dr === 0 && dc === 0) continue;
            const nr = r + dr; const nc = c + dc;
            if (nr >= 0 && nr < rows && nc >= 0 && nc < cols) {
              const n = cells[nr][nc];
              if (!n.revealed && !n.flagged) onFlag(nr, nc);
            }
          }
        }
      }
    } else if (!cell.revealed) {
      onReveal(r, c);
    }
  }, [cells, status, rows, cols, onReveal, onChord, onFlag]);

  const handleRightClick = useCallback((e: React.MouseEvent, r: number, c: number) => {
    e.preventDefault();
    if (status === 'won' || status === 'lost') return;
    if (!cells[r][c].revealed) onFlag(r, c);
  }, [cells, status, onFlag]);

  const centerR = Math.floor(rows / 2);
  const centerC = Math.floor(cols / 2);

  return (
    <div className={styles.wrapper}>
      <div
        className={styles.board}
        style={{
          gridTemplateColumns: `repeat(${cols}, ${cellSize}px)`,
          gridTemplateRows:    `repeat(${rows}, ${cellSize}px)`,
        }}
      >
        {cells.map((row, r) =>
          row.map((cell, c) => {
            const isCenter = firstClickHint && status === 'idle'
              && Math.abs(r - centerR) <= 1 && Math.abs(c - centerC) <= 1;
            const isExplodedMine = status === 'lost' && cell.hasMine && cell.revealed;

            const cls = [
              styles.cell,
              cell.revealed
                ? (cell.hasMine ? styles.mineHit : styles.cellRevealed)
                : styles.cellHidden,
              isCenter && !cell.revealed ? styles.cellHint : '',
              isExplodedMine ? styles.exploding : '',
            ].filter(Boolean).join(' ');

            return (
              <div
                key={`${r}-${c}`}
                className={cls}
                onClick={(e) => handleClick(e, r, c)}
                onContextMenu={(e) => handleRightClick(e, r, c)}
              >
                {isExplodedMine && (
                  <span className={styles.explosionFlash} aria-hidden />
                )}
                {getCellContent(cell, status)}
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
