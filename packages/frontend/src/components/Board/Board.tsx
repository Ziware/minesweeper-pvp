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

// Проверяем принадлежность клетки к зоне NxN с центром в (centerRow, centerCol)
// Зона может частично выходить за поле — это нормально
function inZoneWithCenter(
  r: number,
  c: number,
  centerRow: number,
  centerCol: number,
  halfSize: number  // 1 для 3x3, 2 для 5x5
): boolean {
  return (
    r >= centerRow - halfSize && r <= centerRow + halfSize &&
    c >= centerCol - halfSize && c <= centerCol + halfSize
  );
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

  // Восстанавливаем центр из selectedZone (topLeft + 1) и actionZone (topLeft + 2)
  // selectedZone.row = centerRow - 1  =>  centerRow = selectedZone.row + 1
  const displayCenter = turn.selectedZone
    ? { row: turn.selectedZone.row + 1, col: turn.selectedZone.col + 1 }
    : null;
  const actionCenter = turn.actionZone
    ? { row: turn.actionZone.row + 2, col: turn.actionZone.col + 2 }
    : null;

  // Клетка под курсором (для превью в phase1)
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
    const cell = board[r][c];
    const phase = turn.phase;

    if (phase === 'phase1') {
      // Передаём координаты кликнутой клетки — она и будет центром зон
      onSelectZone(r, c);
      return;
    }

    if (phase === 'phase2') {
      if (e.ctrlKey || e.metaKey) {
        if (cell.owner !== myColor && isInActionZone(r, c)) {
          onDefuseCell(r, c);
        }
        return;
      }
      if (cell.owner !== myColor && isInActionZone(r, c)) {
        onCaptureCell(r, c);
      }
      return;
    }

    if (phase === 'phase3') {
      if (cell.owner === myColor && cell.hasMine === false) {
        onPlaceMinePhase3(r, c);
      }
    }
  };

  const handleRightClick = (e: React.MouseEvent, r: number, c: number) => {
    e.preventDefault();
    const cell = board[r][c];
    const next: Record<CellMark, CellMark> = {
      none: 'flag',
      flag: 'question',
      question: 'none',
    };
    onToggleMark(r, c, next[cell.mark]);
  };

  const getZoneType = (r: number, c: number): 'display' | 'action' | 'none' => {
    if (isInDisplayZone(r, c)) return 'display';
    if (isInActionZone(r, c)) return 'action';
    return 'none';
  };

  const getHoverZoneType = (r: number, c: number): 'display' | 'action' | 'none' => {
    if (isInHoverDisplay(r, c)) return 'display';
    if (isInHoverAction(r, c)) return 'action';
    return 'none';
  };

  const showLegend = !!(displayCenter || (hoverCell && turn.phase === 'phase1' && isMyTurn));

  return (
    <div className={styles.wrapper}>
      <div
        className={styles.board}
        style={{ gridTemplateColumns: `repeat(${config.boardSize}, 44px)` }}
      >
        {board.map((row, r) =>
          row.map((cell, c) => {
            const activeZone = getZoneType(r, c);
            const hoverZone = getHoverZoneType(r, c);
            const finalZone = activeZone !== 'none' ? activeZone : hoverZone;
            const isHover = activeZone === 'none' && hoverZone !== 'none';

            return (
              <div
                key={`${r}-${c}`}
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
                  gamePhase={turn.phase}
                  canDefuse={turn.canDefuse}
                  isMyTurn={isMyTurn}
                  onClick={(e) => handleClick(r, c, e)}
                  onRightClick={(e) => handleRightClick(e, r, c)}
                />
              </div>
            );
          })
        )}
      </div>

      {/* Нижняя панель — фиксированная высота, доска не двигается */}
      <div className={styles.bottomBar}>
        {showLegend && (
          <div className={styles.zoneLegend}>
            <span className={styles.legendDisplay}>■ Зона 3×3 — отображение</span>
            <span className={styles.legendAction}>■ Зона 5×5 — ходы</span>
          </div>
        )}
        {isMyTurn && turn.phase === 'phase2' && turn.canDefuse && (
          <div className={styles.hint}>
            🔧 <strong>Ctrl+Click</strong> на вражескую клетку в зоне 5×5 — разминировать
          </div>
        )}
        {!showLegend && !(isMyTurn && turn.phase === 'phase2' && turn.canDefuse) && (
          <div className={styles.placeholder} />
        )}
      </div>
    </div>
  );
}
