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
  isHeadquarters: boolean;
  gamePhase: string;
  isMyTurn: boolean;
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
  isHeadquarters: boolean,
): React.ReactNode {
  if (isHeadquarters) return <span className={styles.icon}>🏰</span>;

  if (cell.mark === 'flag')     return <span className={styles.icon}>🚩</span>;
  if (cell.mark === 'question') return <span className={styles.icon}>❓</span>;

  // Цифры на открытых своих клетках в зоне 3x3
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

  // Своя мина: показываем иконку только если НЕ в активной зоне
  // Цвет фона (mineRed/mineBlue) остаётся всегда через CSS-класс
  if (cell.hasMine === true && cell.owner === myColor && !isInActiveZone) {
    return <span className={styles.icon}>💣</span>;
  }

  return null;
}

export function Cell({
  cell,
  myColor,
  zoneType,
  isHover,
  isHeadquarters,
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
    // Цвет мины — показываем ВСЕГДА когда есть мина на своей клетке
    // (иконка скрыта в зоне, но цвет фона остаётся)
    cell.hasMine === true && cell.owner === 'red'  ? styles.mineRed  : '',
    cell.hasMine === true && cell.owner === 'blue' ? styles.mineBlue : '',
    // Зоны
    zoneType === 'display' ? (isHover ? styles.hoverDisplay : styles.activeDisplay) : '',
    zoneType === 'action'  ? (isHover ? styles.hoverAction  : styles.activeAction)  : '',
    // Штаб
    isHeadquarters ? styles.headquarters : '',
    // Открытая клетка
    cell.isRevealed ? styles.revealed : '',
    // Фаза 3
    gamePhase === 'phase3' && isMyTurn && isOwn && !cell.hasMine && !isHeadquarters ? styles.phase3Target : '',
  ].filter(Boolean).join(' ');

  return (
    <div className={classNames} onClick={onClick} onContextMenu={onRightClick}>
      {getCellContent(cell, myColor, isInActiveZone, isHeadquarters)}
    </div>
  );
}
