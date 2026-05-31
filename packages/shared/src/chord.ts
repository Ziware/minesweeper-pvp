/**
 * Единая логика «суммаризации аккорда» — определения, какие клетки
 * вокруг источника попытается открыть аккорд и сколько флажков рядом.
 *
 * Используется и сервером (валидация + захват), и клиентом (превью,
 * подсчёт флагов для решения, отправлять ли событие). ВАЖНО: алгоритм
 * должен оставаться идентичным на обеих сторонах, иначе клиент может
 * показывать одно, а сервер делать другое — поэтому держим функцию
 * в одном месте и параметризуем доступом к данным через колбэки.
 *
 * Правила (актуальная версия):
 *   - смотрим строго 8 прямых соседей источника (зона 3×3);
 *   - считаем флажки игрока среди них;
 *   - «открываемой» считаем закрытую клетку-соседа источника:
 *       не-свою, без флага, не штаб.
 *   - такие клетки делятся на два пула:
 *       (a) initial — те, что ортогонально соседствуют с какой-либо клеткой
 *           своей территории (reachable own — то, что возвращает
 *           getReachablePlayerCells). До них можно «дотянуться» по правилам
 *           захвата уже сейчас.
 *       (b) остальные закрытые соседи источника. Они попадают в кандидаты,
 *           только если ортогонально соседствуют с какой-либо клеткой из
 *           initial (т. е. сразу после первой волны захвата до них тоже
 *           можно дотянуться). Делается ровно один такой проход — это
 *           покрывает все диагональные клетки внутри 3×3.
 */

import type { BoardPos } from './board';
import { isInBounds, isHeadquartersCell, ORTHOGONAL_DIRECTIONS, cellKey } from './board';

export interface ChordSummary {
  /** Сколько флажков игрока стоит среди 8 прямых соседей источника. */
  flagCount: number;
  /** Клетки, которые попытается открыть аккорд (порядок — детерминированный
   *  обход dr,dc от -1 до 1; сервер использует тот же порядок при выборе
   *  «первой» мины, которая взорвётся). */
  candidates: BoardPos[];
  /** Закрытые соседи источника без флага (не-свои, не штаб). Используются
   *  для авто-расстановки флажков: если суммарное число закрытых соседей
   *  (флажки + эти) равно цифре, клиент пометит все эти клетки флагом. */
  unflaggedClosedNeighbors: BoardPos[];
}

export interface ChordContext {
  boardSize: number;
  /** Стоит ли в клетке флажок ИГРОКА-инициатора аккорда. */
  isFlag: (row: number, col: number) => boolean;
  /** Принадлежит ли клетка ИГРОКУ-инициатору (свои клетки не разблокируются). */
  isOwnedByActor: (row: number, col: number) => boolean;
  /** Является ли клетка «достижимой своей» (см. getReachablePlayerCells).
   *  Координаты вне поля должны давать false. */
  isReachableOwn: (row: number, col: number) => boolean;
}

/**
 * Возвращает количество флагов вокруг источника и список клеток-кандидатов
 * на разблокирование аккордом. Не делает никаких изменений состояния.
 */
export function summarizeChord(
  sourceRow: number,
  sourceCol: number,
  ctx: ChordContext,
): ChordSummary {
  let flagCount = 0;

  const reachableKeys = new Set<string>();
  const candidates: BoardPos[] = [];
  const unflaggedClosedNeighbors: BoardPos[] = [];
  let pending: BoardPos[] = [];

  const isOrthogonallyAdjacentToReachable = (r: number, c: number): boolean => {
    for (const [dr, dc] of ORTHOGONAL_DIRECTIONS) {
      if (ctx.isReachableOwn(r + dr, c + dc)) return true;
    }
    return false;
  };

  for (let dr = -1; dr <= 1; dr++) {
    for (let dc = -1; dc <= 1; dc++) {
      const nr = sourceRow + dr;
      const nc = sourceCol + dc;
      if (!isInBounds(nr, nc, ctx.boardSize)) continue;
      if (ctx.isFlag(nr, nc)) {
        flagCount++;
        continue;
      }
      if (isHeadquartersCell(nr, nc, ctx.boardSize)) continue;
      unflaggedClosedNeighbors.push({ row: nr, col: nc });
      if (isOrthogonallyAdjacentToReachable(nr, nc)) {
        reachableKeys.add((cellKey(nr, nc)))
        if (!ctx.isOwnedByActor(nr, nc)) {
          candidates.push({ row: nr, col: nc });
        }
      } else {
        pending.push({ row: nr, col: nc });
      }
    }
  }

  let oldCount = 0;
  while (reachableKeys.size != oldCount) {
    oldCount = reachableKeys.size;
    let newPending: BoardPos[] = [];
    for (const cand of pending) {
      let added = false;
      for (const [dr, dc] of ORTHOGONAL_DIRECTIONS) {
        if (reachableKeys.has(cellKey(cand.row + dr, cand.col + dc))) {
          reachableKeys.add(cellKey(cand.row, cand.col));
          added = true;
          if (!ctx.isOwnedByActor(cand.row, cand.col)) {
            candidates.push(cand);
          }
          break;
        }
      }
      if (!added) {
        newPending.push(cand)
      }
    }
    pending = newPending;
  }

  return { flagCount, candidates, unflaggedClosedNeighbors };
}
