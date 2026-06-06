/**
 * Project an internal EngineState onto the shape the UI expects
 * (`S2C_GameState`), mirroring backend's `getGameStateForPlayer`.
 *
 * Enemy `hasMine` is hidden (becomes `null`) unless cell is now owned by the
 * viewer (post-capture/post-defuse cleanup makes the field meaningless then).
 */

import type {
  ClientCellState,
  PlayerColor,
  PlayerState,
  S2C_GameState,
} from '@minesweeper-pvp/shared';
import type { EngineState } from '../types';

function isDebugRevealEnabled(): boolean {
  // 1. Build-time Vite env var (VITE_DEBUG_REVEAL_BOARD=1 yarn dev).
  //    Mirrors the backend's DEBUG_REVEAL_BOARD=1 so the same CLI flag works
  //    for both online play (env on backend) and local-vs-bot play (env on
  //    frontend Vite dev server).
  try {
    if (typeof import.meta !== 'undefined'
        && (import.meta as any).env?.VITE_DEBUG_REVEAL_BOARD === '1') {
      return true;
    }
  } catch {
    /* ignore */
  }
  // 2. Runtime override via DevTools: localStorage.setItem('debug_reveal_board','1').
  try {
    return typeof localStorage !== 'undefined'
      && localStorage.getItem('debug_reveal_board') === '1';
  } catch {
    return false;
  }
}

export function toClientGameState(state: EngineState, viewer: PlayerColor): S2C_GameState {
  const size = state.config.boardSize;
  const isFinished = state.phase === 'finished';
  const debugReveal = isDebugRevealEnabled();

  const board: ClientCellState[][] = state.board.map((row) =>
    row.map((cell): ClientCellState => {
      // По окончании партии открываем расположение всех мин обоим игрокам и
      // убираем флажки/вопросы — это превращает финальное поле в «итоговую карту».
      // (Поведение зеркалит серверный getBoardForPlayer.)
      // Debug-режим (localStorage.debug_reveal_board === '1') — открываем поле всегда.
      if (isFinished || debugReveal) {
        return {
          owner: cell.owner,
          hasMine: cell.hasMine,
          isRevealed: cell.isRevealed,
          number: cell.number,
          mark: 'none',
        };
      }
      if (cell.owner === viewer) {
        return {
          owner: cell.owner,
          hasMine: cell.hasMine,
          isRevealed: cell.isRevealed,
          number: cell.number,
          mark: cell.mark,
        };
      }
      // Hide enemy mine presence. After a successful defuse cell.hasMine is
      // already false, so we lose nothing by always returning null here.
      return {
        owner: cell.owner,
        hasMine: null,
        isRevealed: cell.isRevealed,
        number: cell.number,
        mark: cell.mark,
      };
    }),
  );

  // Overlay viewer's marks onto the board so the UI sees them on enemy cells.
  // На финале метки не показываем — поле в режиме «итоговой карты».
  if (!isFinished) {
    const myMarks = state.marks[viewer];
    for (const key in myMarks) {
      const [rs, cs] = key.split(',');
      const r = +rs, c = +cs;
      if (r < 0 || c < 0 || r >= size || c >= size) continue;
      board[r][c].mark = myMarks[key];
    }
  }

  const players: PlayerState[] = state.players.map((p) => ({
    id: `local-${p.color}`,
    color: p.color,
    name: p.name,
    lives: p.lives,
    minesPlaced: p.minesPlaced,
    connected: true,
    setupConfirmed: p.setupConfirmed,
    timeMs: p.timeMs,
  }));

  let redMines = 0, blueMines = 0, redCells = 0, blueCells = 0;
  for (let r = 0; r < size; r++) {
    for (let c = 0; c < size; c++) {
      const cell = state.board[r][c];
      if (cell.owner === 'red') {
        redCells++;
        if (cell.hasMine) redMines++;
      } else if (cell.owner === 'blue') {
        blueCells++;
        if (cell.hasMine) blueMines++;
      }
    }
  }

  return {
    board,
    players,
    turn: {
      ...state.turn,
      capturedThisTurn: Array.from(state.turn.capturedThisTurn),
      // Marks live on board.mark; the S2C shape doesn't carry a separate map.
    },
    config: state.config,
    stats: { redMines, blueMines, redCells, blueCells },
    winnerColor: state.winner ?? undefined,
  };
}
