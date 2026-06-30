import React, { useCallback, useState } from 'react';
import type { ClassicCell, ClassicStatus } from '../../hooks/useClassicGame';
import { Icon } from '../Icon/Icon';
import styles from './ClassicBoard.module.css';

interface ClassicBoardProps {
  cells: ClassicCell[][];
  status: ClassicStatus;
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
    if (status === 'lost' && cell.hasMine) return <Icon name="mine" size="75%" />;
    if (cell.flagged)    return <span className={styles.icon}>🚩</span>;
    if (cell.questioned) return <span className={styles.icon}>❓</span>;
    return null;
  }
  if (cell.hasMine) return <Icon name="mine" size="75%" />;
  if (cell.adjacentMines > 0) {
    return (
      <span style={{ color: NUMBER_COLORS[cell.adjacentMines] ?? '#eee', fontWeight: 'bold', fontSize: '1rem', lineHeight: 1 }}>
        {cell.adjacentMines}
      </span>
    );
  }
  return null;
}

export function ClassicBoard({
  cells,
  status,
  onReveal,
  onFlag,
  onChord,
  firstClickHint = false,
}: ClassicBoardProps) {
  const rows = cells.length;
  const cols = cells[0]?.length ?? 0;

  const [chordHover, setChordHover] = useState<Set<string>>(new Set());

  // Compute chord preview neighbors when hovering a revealed number cell
  const handleMouseEnter = useCallback((r: number, c: number) => {
    const cell = cells[r][c];
    if (!cell.revealed || cell.adjacentMines === 0) { setChordHover(new Set()); return; }
    const flagCount = countAdjFlags(cells, r, c, rows, cols);
    if (flagCount !== cell.adjacentMines) { setChordHover(new Set()); return; }
    const preview = new Set<string>();
    for (let dr = -1; dr <= 1; dr++) {
      for (let dc = -1; dc <= 1; dc++) {
        if (dr === 0 && dc === 0) continue;
        const nr = r + dr; const nc = c + dc;
        if (nr >= 0 && nr < rows && nc >= 0 && nc < cols && !cells[nr][nc].revealed && !cells[nr][nc].flagged) {
          preview.add(`${nr}-${nc}`);
        }
      }
    }
    setChordHover(preview);
  }, [cells, rows, cols]);

  const handleMouseLeave = useCallback(() => setChordHover(new Set()), []);

  const handleClick = useCallback((e: React.MouseEvent, r: number, c: number) => {
    e.preventDefault();
    const cell = cells[r][c];
    if (status === 'won' || status === 'lost') return;
    if (cell.flagged) return;
    if (cell.revealed && cell.adjacentMines > 0) {
      onChord(r, c);
    } else if (!cell.revealed) {
      onReveal(r, c);
    }
  }, [cells, status, onReveal, onChord]);

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
        style={{ gridTemplateColumns: `repeat(${cols}, var(--cell-size, 28px))` }}
      >
        {cells.map((row, r) =>
          row.map((cell, c) => {
            const isCenter = firstClickHint && status === 'idle'
              && Math.abs(r - centerR) <= 1 && Math.abs(c - centerC) <= 1;
            const isExploded = status === 'lost' && cell.hasMine && cell.revealed;
            const isChordPreview = chordHover.has(`${r}-${c}`);

            const cls = [
              styles.cell,
              cell.revealed ? (cell.hasMine ? styles.cellExploded : styles.cellRevealed) : styles.cellHidden,
              cell.flagged ? styles.cellFlagged : '',
              isCenter ? styles.cellHint : '',
              isChordPreview ? styles.cellChordPreview : '',
              isExploded ? styles.cellExploded : '',
            ].filter(Boolean).join(' ');

            return (
              <div
                key={`${r}-${c}`}
                className={cls}
                onClick={(e) => handleClick(e, r, c)}
                onContextMenu={(e) => handleRightClick(e, r, c)}
                onMouseEnter={() => handleMouseEnter(r, c)}
                onMouseLeave={handleMouseLeave}
              >
                {getCellContent(cell, status)}
              </div>
            );
          })
        )}
      </div>
    </div>
  );
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
