import React, { useState, useCallback } from 'react';
import {
  S2C_GameState,
  PlayerColor,
  CellMark,
  inZoneWithCenter,
  isHeadquartersCell as sharedIsHeadquartersCell,
} from '@minesweeper-pvp/shared';
import { Cell } from '../Cell/Cell';
import styles from './Board.module.css';

interface BoardProps {
  gameState: S2C_GameState;
  myColor: PlayerColor;
  onSelectZone: (row: number, col: number) => void;
  onCaptureCell: (row: number, col: number) => void;
  onDefuseCell: (row: number, col: number) => void;
  onPlaceMinePhase3: (row: number, col: number) => void;
  onPlaceMineSetup?: (row: number, col: number) => void;
  onToggleMark: (row: number, col: number, mark: CellMark) => void;
  onWrapperRef?: (el: HTMLDivElement | null) => void;
}

// Вычисляем размер клетки в зависимости от размера экрана и boardSize
function useCellSize(boardSize: number): number {
  const [cellSize, setCellSize] = React.useState(44);

  React.useEffect(() => {
    function calc() {
      // Оставляем место для двух боковых колонок по 260px + gaps + padding
      const reservedW = 260 * 2 + 24 * 3 + 32;
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
  onPlaceMineSetup,
  onToggleMark,
  onWrapperRef,
}: BoardProps) {
  const { board, turn, config, players } = gameState;
  const isMyTurn = turn.currentPlayer === myColor;

  const cellSize = useCellSize(config.boardSize);

  const isFinished = turn.phase === 'finished';
  const me = players.find((p) => p.color === myColor);
  const iConfirmed = me?.setupConfirmed ?? false;

  // Центр зон из selectedZone/actionZone (скрываем после окончания игры)
  const displayCenter = !isFinished && turn.selectedZone
    ? { row: turn.selectedZone.row + 1, col: turn.selectedZone.col + 1 }
    : null;
  const actionCenter = !isFinished && turn.actionZone
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
    if (turn.phase === 'finished') return;
    const cell  = board[r][c];
    const phase = turn.phase;

    if (phase === 'setup') {
      if (iConfirmed) return;
      if (!onPlaceMineSetup) return;
      // Шлём любой клик на сервер: тот вернёт причину, если ход неверный
      // ("Это не ваша клетка", "Штаб нельзя заминировать",
      // "Мины можно ставить только в доступные клетки",
      // "Достигнут лимит мин для расстановки" и т. п.).
      onPlaceMineSetup(r, c);
      return;
    }

    if (!isMyTurn) return;

    if (phase === 'phase1') {
      onSelectZone(r, c);
      return;
    }
    if (phase === 'phase2') {
      // Клик по своей клетке без флага игнорируем тихо — это просто промах
      // (например, пользователь сматривается по полю). Любой другой клик
      // отправляем на сервер, чтобы тот прислал понятное сообщение об ошибке
      // (вне зоны 5×5 / нельзя разминировать свою / и т. п.).
      if (cell.owner === myColor) return;
      if (e.ctrlKey || e.metaKey) {
        onDefuseCell(r, c);
        return;
      }
      onCaptureCell(r, c);
      return;
    }
    if (phase === 'phase3') {
      // В фазе 3 шлём любой клик: сервер вернёт причину, если ход неверный
      // (не своя клетка, HQ, недостижима, уже заминирована и т. п.).
      onPlaceMinePhase3(r, c);
    }
  };

  const handleRightClick = (e: React.MouseEvent, r: number, c: number) => {
    e.preventDefault();
    if (turn.phase === 'finished') return;
    if (turn.phase === 'setup') return;
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
    <div className={styles.wrapper} ref={onWrapperRef}>
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
                  isHeadquarters={sharedIsHeadquartersCell(r, c, config.boardSize)}
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
            <span className={styles.legendHeadquarters}>🏛️ Штаб</span>
          </div>
        )}
        {isMyTurn && turn.phase === 'phase2' && turn.canDefuse && (
          <div className={styles.hint}>
            🔧 <strong>Ctrl+Click</strong> — разминировать. Осталось: {turn.defusesPerTurn - turn.defusesUsedThisTurn} / {turn.defusesPerTurn}. Захват — только по общей стороне.
          </div>
        )}
        {!showLegend && !(isMyTurn && turn.phase === 'phase2' && turn.canDefuse) && (
          <div className={styles.placeholder} />
        )}
      </div>
    </div>
  );
}
