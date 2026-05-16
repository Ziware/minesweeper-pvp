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
  canDefuse: boolean;
  isMyTurn: boolean;
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
  myColor: PlayerColor
): React.ReactNode {
  if (cell.mark === 'flag')     return '🚩';
  if (cell.mark === 'question') return '❓';

  // Цифры — только на своих открытых клетках
  // При этом своя мина в зоне 3x3 СКРЫТА (isRevealed=true, но hasMine не показываем)
  if (cell.isRevealed && cell.number !== null) {
    return (
      <span
        style={{
          color: NUMBER_COLORS[cell.number] ?? '#eee',
          fontWeight: 'bold',
          fontSize: '1rem',
          lineHeight: 1,
        }}
      >
        {cell.number}
      </span>
    );
  }

  // Своя мина (НЕ в зоне 3x3, т.е. isRevealed=false) — показываем иконку
  if (cell.hasMine === true && cell.owner === myColor) {
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
  onClick,
  onRightClick,
}: CellProps) {
  const isOwn = cell.owner === myColor;

  // Если клетка открыта (в зоне 3x3) — показываем обычный цвет владельца,
  // но убираем иконку мины (она скрыта)
  // revealed применяем только как доп-стиль для подсветки рамкой,
  // НЕ меняем фон на серый
  const classNames = [
    styles.cell,
    // Цвет фона строго по owner
    cell.owner === 'red'  ? styles.ownerRed  : '',
    cell.owner === 'blue' ? styles.ownerBlue : '',
    cell.owner === null   ? styles.ownerNone : '',
    // Мина на своей клетке — более контрастный оттенок того же цвета
    cell.hasMine === true && cell.owner === 'red'  ? styles.mineRed  : '',
    cell.hasMine === true && cell.owner === 'blue' ? styles.mineBlue : '',
    // Зоны
    zoneType === 'display' ? (isHover ? styles.hoverDisplay : styles.activeDisplay) : '',
    zoneType === 'action'  ? (isHover ? styles.hoverAction  : styles.activeAction)  : '',
    // Открытая клетка — только рамка, фон не меняем
    cell.isRevealed ? styles.revealed : '',
    // Фаза 3
    gamePhase === 'phase3' && isMyTurn && isOwn && !cell.hasMine ? styles.phase3Target : '',
  ].filter(Boolean).join(' ');

  return (
    <div className={classNames} onClick={onClick} onContextMenu={onRightClick}>
      {getCellContent(cell, myColor)}
    </div>
  );
}
