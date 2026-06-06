/**
 * Scripted setup-phase placement.
 *
 * Goal (per user spec): "create as many guessing situations as possible".
 * The previous version was a single-pass greedy that scored each candidate
 * cell by HQ distance only, which produced an obvious line of mines in the
 * "sweet" Manhattan band around the headquarters. That's both predictable
 * AND useless — a human can simply avoid that one band.
 *
 * The new placer is **iterative greedy with anti-clustering**:
 *   1. Build candidate cells (own + reachable + non-HQ).
 *   2. Each round, score every remaining candidate as:
 *        base    — HQ-distance bell (sweet spot 2..4 cells, broader peak),
 *        spread  — distance to the nearest already-placed mine (negative
 *                  clustering penalty: nearby placements drop score),
 *        forward — small bonus for cells in the forward half of our
 *                  territory (closer to enemy HQ → creates choke points),
 *        edge    — modest bonus for column diversity so we don't pile up
 *                  in the centre column.
 *   3. Pick the top-scoring cell, add it to the set, repeat.
 *
 * The result is a non-obvious scatter: still defensively biased (the bell
 * peaks 2-4 cells from HQ) but with enough cross-territory spread that the
 * opponent cannot rely on a single band assumption.
 *
 * See [`plans/ai-bot/05-heuristics.md`](plans/ai-bot/05-heuristics.md:100).
 */

import {
  cellKey,
  getHeadquartersCells,
  getHeadquartersOwner,
  getReachablePlayerCells,
} from '@minesweeper-pvp/shared';
import type { PlayerColor } from '@minesweeper-pvp/shared';
import type { EngineState } from '../types';
import { makeRng } from './determinize';

export interface SetupPlanOpts {
  color: PlayerColor;
  seed: number;
  /** Symmetric noise added to per-cell score in [-noise, +noise]. */
  noise: number;
}

interface Candidate {
  row: number;
  col: number;
  /** Distance to nearest HQ cell (Manhattan). */
  hqDist: number;
  /** Distance from this cell to ENEMY HQ (Manhattan). */
  enemyDist: number;
}

/**
 * Return the ordered list of cells the bot should place mines on
 * (length = required mine count). Caller should apply them one-by-one
 * via `applyPlaceMineSetupAs` and then `applyConfirmSetupAs`.
 */
export function planSetupMines(state: EngineState, opts: SetupPlanOpts): Array<{ row: number; col: number }> {
  const size = state.config.boardSize;
  const required = opts.color === 'red' ? state.config.initialMinesRed : state.config.initialMinesBlue;
  const rand = makeRng(opts.seed);
  const reachable = getReachablePlayerCells(state.board, opts.color, size);
  const ownHqs = getHeadquartersCells(opts.color, size);
  const enemyColor: PlayerColor = opts.color === 'red' ? 'blue' : 'red';
  const enemyHqs = getHeadquartersCells(enemyColor, size);

  // Build candidates once.
  const candidates: Candidate[] = [];
  for (let r = 0; r < size; r++) {
    for (let c = 0; c < size; c++) {
      if (!reachable.has(cellKey(r, c))) continue;
      if (state.board[r][c].owner !== opts.color) continue;
      if (getHeadquartersOwner(r, c, size)) continue;
      const hqDist = minManhattan(r, c, ownHqs);
      const enemyDist = minManhattan(r, c, enemyHqs);
      candidates.push({ row: r, col: c, hqDist, enemyDist });
    }
  }

  if (candidates.length === 0) return [];

  const placed: Array<{ row: number; col: number }> = [];
  const remaining = candidates.slice();
  // Track which column-bands have been used to encourage column spread.
  const colUseCount = new Map<number, number>();
  const noise = opts.noise;

  while (placed.length < required && remaining.length > 0) {
    let bestIdx = -1;
    let bestScore = -Infinity;
    for (let i = 0; i < remaining.length; i++) {
      const cand = remaining[i];
      const score = scoreCandidate(cand, placed, colUseCount, size, rand, noise);
      if (score > bestScore) {
        bestScore = score;
        bestIdx = i;
      }
    }
    if (bestIdx < 0) break;
    const chosen = remaining[bestIdx];
    placed.push({ row: chosen.row, col: chosen.col });
    colUseCount.set(chosen.col, (colUseCount.get(chosen.col) ?? 0) + 1);
    // Remove with O(1) swap-pop.
    remaining[bestIdx] = remaining[remaining.length - 1];
    remaining.pop();
  }

  return placed;
}

function scoreCandidate(
  cand: Candidate,
  placed: Array<{ row: number; col: number }>,
  colUseCount: Map<number, number>,
  size: number,
  rand: () => number,
  noise: number,
): number {
  // ─── 1. Border defence: mines belong on/near the contact line between
  //   the two territories. We approximate the border as the row where
  //   our half meets the enemy half. For a (size×size) board with red
  //   on top half and blue on bottom, the border row sits at size/2 - 1
  //   (red side) or size/2 (blue side). We use the cell's distance to
  //   ENEMY HQ minus distance to OWN HQ as a signed depth: 0 = border,
  //   positive = our side, negative = enemy side. We want depth small
  //   (close to border) but slightly positive (just inside our side).
  //   This produces a strong "frontier wall" instead of a near-HQ ring.
  const depth = cand.enemyDist - cand.hqDist; // ≥0 (we only own our half)
  // depth ≈ 1..3 is the prime border zone. Bell centred at 2, half-credit at 0 or 4.
  const borderTarget = 2;
  const borderSpread = 3;
  const borderScore = Math.max(0, 1 - Math.abs(depth - borderTarget) / borderSpread);

  // ─── 2. HQ proximity — weaker than before. Mines hugging HQ are useful
  //   only as a last-line; the user wants the BORDER to be the main wall.
  const hqDx = Math.abs(cand.hqDist - 3);
  const hqProximity = Math.max(0, 1 - hqDx / 3) * 0.25;

  // ─── 3. Corner penalty: corners and edges are rarely on the enemy's
  //   capture path. Punish cells within 1 of any board edge UNLESS the
  //   board is so small that's most of the board. We use Chebyshev
  //   distance to nearest edge.
  const edgeDist = Math.min(cand.row, cand.col, size - 1 - cand.row, size - 1 - cand.col);
  const isCorner = (cand.row === 0 || cand.row === size - 1)
    && (cand.col === 0 || cand.col === size - 1);
  let edgePenalty = 0;
  if (isCorner) edgePenalty = 0.85;
  else if (edgeDist === 0) edgePenalty = 0.35;
  else if (edgeDist === 1) edgePenalty = 0.10;

  // ─── 4. Anti-clustering — keep the wall spread out across the border.
  let cluster = 0;
  for (const p of placed) {
    const cheb = Math.max(Math.abs(p.row - cand.row), Math.abs(p.col - cand.col));
    if (cheb === 0) return -Infinity;
    if (cheb === 1) cluster += 0.55;
    else if (cheb === 2) cluster += 0.22;
    else if (cheb === 3) cluster += 0.07;
  }

  // ─── 5. Column diversity: discourage stacking on a single column so
  //   the border wall covers as many columns as possible.
  const used = colUseCount.get(cand.col) ?? 0;
  const colPenalty = used * 0.18;

  // ─── 6. Jitter so equally-scored cells are picked at random per game.
  const jitter = (rand() * 2 - 1) * noise;

  return 0.85 * borderScore + hqProximity - edgePenalty - cluster - colPenalty + jitter;
}

function minManhattan(
  row: number, col: number,
  targets: ReadonlyArray<{ row: number; col: number }>,
): number {
  let best = Infinity;
  for (const t of targets) {
    const d = Math.abs(row - t.row) + Math.abs(col - t.col);
    if (d < best) best = d;
  }
  return best;
}
