/**
 * Чистые геометрические / структурные хелперы доски, общие для backend и frontend.
 *
 * Намеренно НЕ зависят от конкретного типа клетки — работают через generic
 * `HasOwner`, чтобы их можно было применять и к серверному `CellState`,
 * и к клиентскому `ClientCellState`.
 *
 * Константы (DEFAULT_CONFIG, размеры зон, лимиты разминирования и т. п.)
 * остаются в `packages/backend/src/gameLogic.ts`, чтобы не размывать ответственность.
 */

import type { PlayerColor } from './types';

// ─── Базовая геометрия ────────────────────────────────────────────────────────

export interface BoardPos {
  row: number;
  col: number;
}

/** Минимальный интерфейс клетки, нужный хелперам ниже. */
export interface HasOwner {
  owner: PlayerColor | null;
}

/** Четыре ортогональных смещения — общий набор направлений для BFS/смежности. */
export const ORTHOGONAL_DIRECTIONS: ReadonlyArray<readonly [number, number]> = [
  [-1, 0],
  [1, 0],
  [0, -1],
  [0, 1],
] as const;

/** Размер «зоны отображения» (показ цифр) — квадрат 3×3. */
export const DISPLAY_ZONE_SIZE = 3;
/** Размер «зоны действий» (захват/мины) — квадрат 5×5. */
export const ACTION_ZONE_SIZE = 5;

/** Координаты в пределах квадратного поля размера `size`. */
export function isInBounds(row: number, col: number, size: number): boolean {
  return row >= 0 && row < size && col >= 0 && col < size;
}

/**
 * Проверка попадания клетки в квадратную зону, заданную её левым-верхним углом
 * и размером стороны. Координаты вне поля считаются «не в зоне».
 */
export function inZoneTopLeft(
  row: number,
  col: number,
  topLeftRow: number,
  topLeftCol: number,
  sideSize: number,
  boardSize: number,
): boolean {
  if (!isInBounds(row, col, boardSize)) return false;
  return (
    row >= topLeftRow && row < topLeftRow + sideSize &&
    col >= topLeftCol && col < topLeftCol + sideSize
  );
}

/**
 * Проверка попадания клетки в квадратную зону, заданную её центром и
 * «радиусом» в клетках (для зоны 3×3 это 1, для 5×5 — 2).
 */
export function inZoneWithCenter(
  row: number,
  col: number,
  centerRow: number,
  centerCol: number,
  halfSize: number,
): boolean {
  return (
    row >= centerRow - halfSize && row <= centerRow + halfSize &&
    col >= centerCol - halfSize && col <= centerCol + halfSize
  );
}

/** Левый-верхний угол зоны отображения по координате клика (центр зоны). */
export function getDisplayZoneTopLeft(clickedRow: number, clickedCol: number): BoardPos {
  return { row: clickedRow - 1, col: clickedCol - 1 };
}

/** Левый-верхний угол зоны действий по координате клика (центр зоны). */
export function getActionZoneTopLeft(clickedRow: number, clickedCol: number): BoardPos {
  return { row: clickedRow - 2, col: clickedCol - 2 };
}

// ─── Штабы ────────────────────────────────────────────────────────────────────

/**
 * Возвращает координаты двух клеток штаба указанного цвета.
 * Штаб всегда стоит в центре крайнего ряда соответствующего игрока.
 */
export function getHeadquartersCells(
  playerColor: PlayerColor,
  boardSize: number,
): [BoardPos, BoardPos] {
  const firstCol = Math.floor((boardSize - 2) / 2);
  const row = playerColor === 'red' ? 0 : boardSize - 1;
  return [
    { row, col: firstCol },
    { row, col: firstCol + 1 },
  ];
}

/** Является ли клетка частью штаба КОНКРЕТНОГО цвета. */
export function isHeadquartersCellOf(
  row: number,
  col: number,
  playerColor: PlayerColor,
  boardSize: number,
): boolean {
  return getHeadquartersCells(playerColor, boardSize).some(
    (cell) => cell.row === row && cell.col === col,
  );
}

/** Является ли клетка частью ЛЮБОГО штаба (красного или синего). */
export function isHeadquartersCell(
  row: number,
  col: number,
  boardSize: number,
): boolean {
  const firstCol = Math.floor((boardSize - 2) / 2);
  return (
    (row === 0 || row === boardSize - 1) &&
    (col === firstCol || col === firstCol + 1)
  );
}

/** Кому принадлежит штаб в этой клетке (если она — клетка штаба). */
export function getHeadquartersOwner(
  row: number,
  col: number,
  boardSize: number,
): PlayerColor | null {
  if (isHeadquartersCellOf(row, col, 'red', boardSize)) return 'red';
  if (isHeadquartersCellOf(row, col, 'blue', boardSize)) return 'blue';
  return null;
}

// ─── Достижимость / связность территории ──────────────────────────────────────

/** Ключ клетки `"row,col"` для использования в Set. */
export function cellKey(row: number, col: number): string {
  return `${row},${col}`;
}

/**
 * BFS от клеток штаба игрока по его же клеткам в 4 ортогональных направлениях.
 *
 * Возвращает Set ключей `"row,col"` всех клеток, до которых игрок может
 * «дотянуться» по своей территории. Если клетки штаба не принадлежат игроку
 * (т. е. штаб уже захвачен) — возвращает пустой Set.
 */
export function getReachablePlayerCells<T extends HasOwner>(
  board: T[][],
  playerColor: PlayerColor,
  boardSize: number,
): Set<string> {
  const reachable = new Set<string>();
  const queue: BoardPos[] = [];

  for (const start of getHeadquartersCells(playerColor, boardSize)) {
    if (!isInBounds(start.row, start.col, boardSize)) continue;
    if (board[start.row]?.[start.col]?.owner !== playerColor) continue;
    reachable.add(cellKey(start.row, start.col));
    queue.push(start);
  }

  for (let i = 0; i < queue.length; i++) {
    const current = queue[i];
    for (const [dr, dc] of ORTHOGONAL_DIRECTIONS) {
      const nr = current.row + dr;
      const nc = current.col + dc;
      if (!isInBounds(nr, nc, boardSize)) continue;
      if (board[nr][nc].owner !== playerColor) continue;
      const key = cellKey(nr, nc);
      if (reachable.has(key)) continue;
      reachable.add(key);
      queue.push({ row: nr, col: nc });
    }
  }

  return reachable;
}

/** Удобный шорткат над getReachablePlayerCells для проверки одной клетки. */
export function isPlayerCellReachable<T extends HasOwner>(
  board: T[][],
  row: number,
  col: number,
  playerColor: PlayerColor,
  boardSize: number,
): boolean {
  return getReachablePlayerCells(board, playerColor, boardSize).has(cellKey(row, col));
}
