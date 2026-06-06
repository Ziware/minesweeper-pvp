/**
 * Legal move enumeration for the simulator. This is the action space the
 * MCTS will branch over. Per the design (see
 * [`plans/ai-bot/01-game-model.md`](plans/ai-bot/01-game-model.md:206)), we
 * prune aggressively at the source: only generate moves that the simulator
 * would actually accept.
 *
 * Marks (`toggle_mark`) are intentionally never enumerated — the bot doesn't
 * play marks.
 */

import {
  ACTION_ZONE_SIZE,
  DISPLAY_ZONE_SIZE,
  cellKey,
  getHeadquartersOwner,
  getReachablePlayerCells,
  isInBounds,
  summarizeChord,
} from '@minesweeper-pvp/shared';
import type { EngineMove, EngineState } from '../types';
import {
  isValidZoneSelection,
  canCaptureCell,
  isPlayerCellReachable,
} from './simulator';

export interface EnumerateOpts {
  /** Whether to include `chord` moves (Normal/Hard only). */
  useChord?: boolean;
  /** Whether to include zone selections that contain no enemy cells in the
   *  5×5 action zone — usually pointless, so default false. */
  includeEmptyActionZones?: boolean;
}

/**
 * Enumerate all moves currently legal for `state.turn.currentPlayer`.
 * For setup phase, returns the moves available to currentPlayer specifically.
 */
export function enumerateMoves(state: EngineState, opts: EnumerateOpts = {}): EngineMove[] {
  const phase = state.turn.phase;
  switch (phase) {
    case 'setup':    return enumerateSetup(state);
    case 'phase1':   return enumeratePhase1(state, opts);
    case 'phase2':   return enumeratePhase2(state, opts);
    case 'phase3':   return enumeratePhase3(state);
    case 'finished': return [];
    default: {
      const _exh: never = phase as never;
      void _exh;
      return [];
    }
  }
}

// ─── setup ───────────────────────────────────────────────────────────────────

function enumerateSetup(state: EngineState): EngineMove[] {
  const color = state.turn.currentPlayer;
  const player = state.players.find((p) => p.color === color)!;
  const moves: EngineMove[] = [];
  const size = state.config.boardSize;
  const limit = color === 'red' ? state.config.initialMinesRed : state.config.initialMinesBlue;

  if (!player.setupConfirmed) {
    // Candidate cells = own, reachable, non-HQ, no existing mine OR existing mine (toggle off).
    const reachable = getReachablePlayerCells(state.board, color, size);
    for (let r = 0; r < size; r++) {
      for (let c = 0; c < size; c++) {
        if (!reachable.has(cellKey(r, c))) continue;
        if (state.board[r][c].owner !== color) continue;
        if (getHeadquartersOwner(r, c, size)) continue;
        const cell = state.board[r][c];
        // Toggling an existing mine OFF is legal but rarely useful for MCTS;
        // only include placements (add mine) — saves branching factor.
        if (cell.hasMine) continue;
        if (player.minesPlaced >= limit) continue;
        moves.push({ type: 'place_mine_setup', row: r, col: c });
      }
    }
    if (player.minesPlaced === limit) {
      moves.push({ type: 'confirm_setup' });
    }
  }
  return moves;
}

// ─── phase 1 — select display zone ───────────────────────────────────────────

function enumeratePhase1(state: EngineState, opts: EnumerateOpts): EngineMove[] {
  const color = state.turn.currentPlayer;
  const size = state.config.boardSize;
  const moves: EngineMove[] = [];

  // Iterate over all valid 3×3 display zone top-lefts (the engine accepts
  // any clicked cell whose display top-left is at (dr0,dc0); we emit the
  // canonical "center" click (dr0+1, dc0+1) and let the engine recompute).
  for (let dr0 = 0; dr0 <= size - DISPLAY_ZONE_SIZE; dr0++) {
    for (let dc0 = 0; dc0 <= size - DISPLAY_ZONE_SIZE; dc0++) {
      if (!isValidZoneSelection(state.board, dr0, dc0, color, size)) continue;
      // Optionally skip zones whose 5×5 action zone contains no enemy cells.
      if (!opts.includeEmptyActionZones) {
        // Action zone top-left = display top-left - 1
        const azRow = dr0 - 1;
        const azCol = dc0 - 1;
        let hasEnemy = false;
        for (let dr = 0; dr < ACTION_ZONE_SIZE && !hasEnemy; dr++) {
          for (let dc = 0; dc < ACTION_ZONE_SIZE && !hasEnemy; dc++) {
            const r = azRow + dr;
            const c = azCol + dc;
            if (!isInBounds(r, c, size)) continue;
            if (state.board[r][c].owner !== color) { hasEnemy = true; break; }
          }
        }
        if (!hasEnemy) continue;
      }
      moves.push({ type: 'select_zone', row: dr0 + 1, col: dc0 + 1 });
    }
  }
  return moves;
}

// ─── phase 2 — captures / defuses / chord / end ──────────────────────────────

function enumeratePhase2(state: EngineState, opts: EnumerateOpts): EngineMove[] {
  const color = state.turn.currentPlayer;
  const size = state.config.boardSize;
  const az = state.turn.actionZone;
  const dz = state.turn.selectedZone;
  const moves: EngineMove[] = [];
  if (!az || !dz) return [{ type: 'end_phase2' }];

  const canDefuseNow = state.turn.canDefuse && state.turn.defusesUsedThisTurn < state.turn.defusesPerTurn;

  for (let dr = 0; dr < ACTION_ZONE_SIZE; dr++) {
    for (let dc = 0; dc < ACTION_ZONE_SIZE; dc++) {
      const r = az.row + dr;
      const c = az.col + dc;
      if (!isInBounds(r, c, size)) continue;
      const cell = state.board[r][c];
      if (cell.owner === color) continue;
      if (!canCaptureCell(state.board, r, c, color, az.row, az.col, size)) continue;
      moves.push({ type: 'capture', row: r, col: c });
      if (canDefuseNow) moves.push({ type: 'defuse', row: r, col: c });
    }
  }

  // Chord moves: own revealed numbered cells in 3×3 display zone with
  // flagCount === number.
  if (opts.useChord) {
    const myMarks = state.marks[color];
    const reachable = getReachablePlayerCells(state.board, color, size);
    for (let dr = 0; dr < DISPLAY_ZONE_SIZE; dr++) {
      for (let dc = 0; dc < DISPLAY_ZONE_SIZE; dc++) {
        const r = dz.row + dr;
        const c = dz.col + dc;
        if (!isInBounds(r, c, size)) continue;
        const cell = state.board[r][c];
        if (cell.owner !== color || !cell.isRevealed || cell.number === null) continue;
        const summary = summarizeChord(r, c, {
          boardSize: size,
          isFlag:         (rr, cc) => myMarks[`${rr},${cc}`] === 'flag',
          isOwnedByActor: (rr, cc) => isInBounds(rr, cc, size) && state.board[rr][cc].owner === color,
          isReachableOwn: (rr, cc) => reachable.has(`${rr},${cc}`),
        });
        if (summary.flagCount === cell.number && summary.candidates.length > 0) {
          moves.push({ type: 'chord', row: r, col: c });
        }
      }
    }
  }

  moves.push({ type: 'end_phase2' });
  return moves;
}

// ─── phase 3 — mine placements / end ─────────────────────────────────────────

function enumeratePhase3(state: EngineState): EngineMove[] {
  const color = state.turn.currentPlayer;
  const size = state.config.boardSize;
  const moves: EngineMove[] = [];
  const remaining = state.turn.minesAllowedThisTurn - state.turn.minesPlacedThisTurn;
  if (remaining > 0) {
    const reachable = getReachablePlayerCells(state.board, color, size);
    for (let r = 0; r < size; r++) {
      for (let c = 0; c < size; c++) {
        const cell = state.board[r][c];
        if (cell.owner !== color) continue;
        if (getHeadquartersOwner(r, c, size)) continue;
        if (cell.hasMine) continue;
        if (!isPlayerCellReachable(state.board, r, c, color, size)) continue;
        // Reachable check via cached set:
        if (!reachable.has(cellKey(r, c))) continue;
        moves.push({ type: 'place_mine_phase3', row: r, col: c });
      }
    }
  }
  moves.push({ type: 'end_phase3' });
  return moves;
}
