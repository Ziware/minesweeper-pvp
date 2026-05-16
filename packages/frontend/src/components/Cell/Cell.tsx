import React from 'react';
import { ClientCellState, PlayerColor } from '@minesweeper-pvp/shared';
import styles from './Cell.module.css';

interface CellProps {
  cell: ClientCellState;
  row: number;
  col: number;
  myColor: PlayerColor;
  zoneType: 'display' | 'action' | 'none';
  isHover: boolean;
  gamePhase: string;
  isMyTurn: boolean;
  // Находится ли клетка в активной зоне (не превью)
  isInActiveZone: boolean;
  onClick: (e: React.MouseEvent) => void;
  onRightClick: (e: React.MouseEvent) => void;
}

const NUMBER_COLORS: Record<number, string> = {
  0: '#aaa',
  1: '#4fc3f7',
  2: '#81c784',
  3: '#e57373',
  4: '#ba68c8',
  5: '#ff8a65',
  6: '#4dd0e1',
  7: '#fff176',
  8: '#cfd8dc',
};

function getCellContent(
  cell: ClientCellState,
  myColor: PlayerColor,
  isInActiveZone: boolean,
  zoneType: 'display' | 'action' | 'none',
): React.ReactNode {
  if (cell.mark === 'flag')     return '🚩';
  if (cell.mark === 'question') return '❓';

  // В активной зоне 3x3 — показываем цифры, мины скрыты
  if (cell.isRevealed && cell.number !== null) {
    return (
      <span style={{
        color: NUMBER_COLORS[cell.number] ?? '#eee',
        fontWeight: 'bold',
        fontSize: '1rem',
        lineHeight: 1,
      }}>
        {cell.number}
      </span>
    );
  }

  // Своя мина — показываем только если НЕ в активной зоне (3x3 или 5x5)
  if (cell.hasMine === true && cell.owner === myColor && !isInActiveZone) {
    return '💣';
  }

  return null;
}

export function Cell({
  cell,
  myColor,
  zoneType,
  isHover,
  gamePhase,
  isMyTurn,
  isInActiveZone,
  onClick,
  onRightClick,
}: CellProps) {
  const isOwn = cell.owner === myColor;

  const classNames = [
    styles.cell,
    cell.owner === 'red'  ? styles.ownerRed  : '',
    cell.owner === 'blue' ? styles.ownerBlue : '',
    cell.owner === null   ? styles.ownerNone : '',
    // Мина — контрастный оттенок, только если не в активной зоне
    cell.hasMine === true && cell.owner === 'red'  && !isInActiveZone ? styles.mineRed  : '',
    cell.hasMine === true && cell.owner === 'blue' && !isInActiveZone ? styles.mineBlue : '',
    // Зоны
    zoneType === 'display' ? (isHover ? styles.hoverDisplay : styles.activeDisplay) : '',
    zoneType === 'action'  ? (isHover ? styles.hoverAction  : styles.activeAction)  : '',
    // Открытая клетка
    cell.isRevealed ? styles.revealed : '',
    // Фаза 3
    gamePhase === 'phase3' && isMyTurn && isOwn && !cell.hasMine ? styles.phase3Target : '',
  ].filter(Boolean).join(' ');

  return (
    <div className={classNames} onClick={onClick} onContextMenu={onRightClick}>
      {getCellContent(cell, myColor, isInActiveZone, zoneType)}
    </div>
  );
}
