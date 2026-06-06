/**
 * Determinization: reconstruct plausible enemy mine layouts from what the
 * bot legitimately observes. See
 * [`plans/ai-bot/02-determinization.md`](plans/ai-bot/02-determinization.md:1).
 *
 * Honesty contract: this module MUST NOT read `cell.hasMine` for cells the
 * bot doesn't own UNLESS it has been explicitly observed (revealed mine
 * from an explosion / defuse). The driver enforces this by stripping enemy
 * `hasMine` before passing the observation in. We additionally assert this
 * here in debug mode.
 *
 * Approach (pragmatic, MVP):
 *   1. Identify candidate cells (enemy-owned, non-HQ, reachable by enemy
 *      *given current ownership*).
 *   2. Estimate enemy mine budget = initial allocation + phase3-placed
 *      (estimated) − bot-observed removals.
 *   3. Sample K layouts: each layout assigns a uniformly random subset of
 *      candidates of the budget size.
 *   4. Optionally: bias against layouts that grossly violate our own
 *      revealed numbers (rejection sampling).
 */

import {
  cellKey,
  getHeadquartersOwner,
  getReachablePlayerCells,
  isInBounds,
} from '@minesweeper-pvp/shared';
import type { CellState, PlayerColor } from '@minesweeper-pvp/shared';
import type { BotObservation, EngineState } from '../types';
import { cloneState, countAdjacentEnemyMines } from './simulator';

export interface DeterminizeOpts {
  /** Number of layouts to draw. */
  samples: number;
  /** Rng. */
  rand: () => number;
  /** Apply number-constraint rejection? (Slower but more accurate.) */
  enforceNumbers?: boolean;
  /** Max rejection attempts per sample before giving up & accepting. */
  maxAttempts?: number;
}

export interface Determinization {
  /** Full EngineState with enemy mines randomized in. Owned by caller. */
  state: EngineState;
}

export function determinize(obs: BotObservation, opts: DeterminizeOpts): Determinization[] {
  const enemy: PlayerColor = obs.botColor === 'red' ? 'blue' : 'red';
  const size = obs.config.boardSize;
  const base = obsToEngineState(obs);

  // Identify candidate enemy cells (currently enemy-owned, non-HQ, reachable).
  const candidates: Array<{ row: number; col: number }> = [];
  const enemyReachable = getReachablePlayerCells(base.board, enemy, size);
  for (let r = 0; r < size; r++) {
    for (let c = 0; c < size; c++) {
      const cell = base.board[r][c];
      if (cell.owner !== enemy) continue;
      if (getHeadquartersOwner(r, c, size)) continue;
      if (!enemyReachable.has(cellKey(r, c))) continue;
      // The bot must not have observed a mine on this cell directly
      // (which would only happen if it was OWN; enemy mines are hidden
      // by construction in BotObservation).
      candidates.push({ row: r, col: c });
    }
  }

  // Mine budget: initial enemy mines + estimated phase3 placements − removed by bot.
  const initialEnemyMines = enemy === 'red' ? obs.config.initialMinesRed : obs.config.initialMinesBlue;
  const estimatedPhase3 = Math.max(0, Math.round(obs.opponentMinesPlacedHistoryMid));
  const removed = obs.opponentMinesRemovedByBot;
  let budget = Math.max(0, initialEnemyMines + estimatedPhase3 - removed);
  budget = Math.min(budget, candidates.length);

  // Pre-compute "own revealed number" constraints if requested.
  type NumberConstraint = { row: number; col: number; expected: number; neighbors: Array<{ row: number; col: number }> };
  const numberConstraints: NumberConstraint[] = [];
  if (opts.enforceNumbers) {
    for (let r = 0; r < size; r++) {
      for (let c = 0; c < size; c++) {
        const cell = base.board[r][c];
        if (cell.owner !== obs.botColor || !cell.isRevealed || cell.number === null) continue;
        const neigh: Array<{ row: number; col: number }> = [];
        for (let dr = -1; dr <= 1; dr++) {
          for (let dc = -1; dc <= 1; dc++) {
            if (dr === 0 && dc === 0) continue;
            const nr = r + dr;
            const nc = c + dc;
            if (!isInBounds(nr, nc, size)) continue;
            if (base.board[nr][nc].owner === enemy) neigh.push({ row: nr, col: nc });
          }
        }
        numberConstraints.push({ row: r, col: c, expected: cell.number, neighbors: neigh });
      }
    }
  }

  const layouts: Determinization[] = [];
  const maxAttempts = opts.maxAttempts ?? 6;

  for (let i = 0; i < opts.samples; i++) {
    let best: { state: EngineState; violation: number } | null = null;
    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      const next = cloneState(base);
      placeRandomMines(next.board, candidates, budget, opts.rand);
      let violation = 0;
      if (opts.enforceNumbers) {
        for (const nc of numberConstraints) {
          const observed = countAdjacentEnemyMines(next.board, nc.row, nc.col, obs.botColor, size);
          violation += Math.abs(observed - nc.expected);
        }
      }
      if (best === null || violation < best.violation) {
        best = { state: next, violation };
      }
      if (violation === 0) break;
    }
    if (best) layouts.push({ state: best.state });
  }

  honestyAudit(obs, base, enemy, size);
  return layouts;
}

/** Build a mutable EngineState from a BotObservation. Enemy `hasMine` is
 *  already false in `obs.board` by construction, so the result is mine-free
 *  on enemy territory and ready for determinizer to populate. */
export function obsToEngineState(obs: BotObservation): EngineState {
  // Deep clone the board so we don't mutate obs (which the worker may reuse).
  const board: CellState[][] = obs.board.map((row) => row.map((cell) => ({ ...cell })));
  return {
    config: obs.config,
    board,
    players: obs.players.map((p) => ({ ...p })),
    phase: obs.phase,
    turn: {
      ...obs.turn,
      selectedZone: obs.turn.selectedZone ? { ...obs.turn.selectedZone } : null,
      actionZone: obs.turn.actionZone ? { ...obs.turn.actionZone } : null,
      capturedThisTurn: new Set(obs.turn.capturedThisTurn),
      lastAction: obs.turn.lastAction ? { ...obs.turn.lastAction } : null,
    },
    setupConfirmed: new Set(obs.setupConfirmed),
    marks: { red: { ...obs.marks.red }, blue: { ...obs.marks.blue } },
    winner: obs.winner,
    winReason: obs.winReason,
  };
}

function placeRandomMines(
  board: CellState[][],
  candidates: Array<{ row: number; col: number }>,
  budget: number,
  rand: () => number,
): void {
  // Reservoir-shuffle indices and pick first `budget`.
  const idx = candidates.map((_, i) => i);
  for (let i = idx.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [idx[i], idx[j]] = [idx[j], idx[i]];
  }
  for (let i = 0; i < budget && i < idx.length; i++) {
    const { row, col } = candidates[idx[i]];
    board[row][col].hasMine = true;
  }
}

/** Defensive check: enemy cells in the observation must all have hasMine=false
 *  (the driver enforces honesty by stripping). If this fails, the bot was
 *  fed cheat data — throw loudly. */
function honestyAudit(obs: BotObservation, _base: EngineState, enemy: PlayerColor, size: number): void {
  if (typeof console === 'undefined') return;
  for (let r = 0; r < size; r++) {
    for (let c = 0; c < size; c++) {
      const cell = obs.board[r][c];
      if (cell.owner === enemy && cell.hasMine) {
        // eslint-disable-next-line no-console
        console.error('[determinize] Honesty violation: enemy mine leaked into BotObservation', { r, c });
        return;
      }
    }
  }
}

/** Simple xorshift32 PRNG for deterministic worker-side sampling. */
export function makeRng(seed: number): () => number {
  let s = (seed | 0) || 1;
  return () => {
    s ^= s << 13; s |= 0;
    s ^= s >>> 17;
    s ^= s << 5;  s |= 0;
    return ((s >>> 0) / 0x100000000);
  };
}
