/**
 * Leaf evaluation, action priors, and aggregate marginal probabilities used
 * by MCTS / rollout policies. See
 * [`plans/ai-bot/05-heuristics.md`](plans/ai-bot/05-heuristics.md:1).
 *
 * All evaluators return values in `[-1, +1]` from the perspective of the
 * `perspective` colour, where +1 is "we just won" and -1 is "we just lost".
 */

import {
  cellKey,
  getHeadquartersCells,
  getReachablePlayerCells,
  isInBounds,
} from '@minesweeper-pvp/shared';
import type { PlayerColor } from '@minesweeper-pvp/shared';
import type { EngineMove, EngineState } from '../types';

// ─── Leaf evaluation ─────────────────────────────────────────────────────────

export interface EvalWeights {
  lifeAdv: number;
  hqProximity: number;
  reachableArea: number;
  threatenedTiles: number;
  tempo: number;
}

export const DEFAULT_EVAL_WEIGHTS: EvalWeights = {
  lifeAdv:        0.35,
  hqProximity:    0.30,
  reachableArea:  0.15,
  threatenedTiles:0.10,
  tempo:          0.10,
};

export function evaluate(
  state: EngineState,
  perspective: PlayerColor,
  weights: EvalWeights = DEFAULT_EVAL_WEIGHTS,
): number {
  if (state.phase === 'finished') {
    if (state.winner === perspective) return 1;
    if (state.winner === null) return 0;
    return -1;
  }

  const me = state.players.find((p) => p.color === perspective)!;
  const opp = state.players.find((p) => p.color !== perspective)!;
  const size = state.config.boardSize;

  // 1. Life advantage normalized.
  const lifeAdv = (me.lives - opp.lives) / state.config.maxLives;

  // 2. HQ proximity: distance from nearest own-reachable cell to enemy HQ
  //    vs distance from nearest enemy-reachable cell to our HQ. Smaller = better.
  const myReachable = getReachablePlayerCells(state.board, perspective, size);
  const oppColor: PlayerColor = perspective === 'red' ? 'blue' : 'red';
  const oppReachable = getReachablePlayerCells(state.board, oppColor, size);
  const myDistToEnemyHq = minDistToCells(myReachable, getHeadquartersCells(oppColor, size));
  const oppDistToMyHq = minDistToCells(oppReachable, getHeadquartersCells(perspective, size));
  // Closer to enemy HQ than enemy to ours = good. Normalize by board size.
  const hqProximity = clamp((oppDistToMyHq - myDistToEnemyHq) / size, -1, 1);

  // 3. Reachable area advantage.
  const reachableArea = clamp((myReachable.size - oppReachable.size) / (size * size), -1, 1);

  // 4. Threatened tiles: enemy cells in our action zones — proxy: enemy cells
  //    orthogonally adjacent to our reachable cells.
  let threatened = 0;
  let oppThreatened = 0;
  for (let r = 0; r < size; r++) {
    for (let c = 0; c < size; c++) {
      const cell = state.board[r][c];
      if (cell.owner === oppColor && isAdjacentTo(myReachable, r, c, size)) threatened++;
      if (cell.owner === perspective && isAdjacentTo(oppReachable, r, c, size)) oppThreatened++;
    }
  }
  const threatenedTiles = clamp((threatened - oppThreatened) / (size * size), -1, 1);

  // 5. Tempo: it's our turn = +small, else -small.
  const tempo = state.turn.currentPlayer === perspective ? 0.05 : -0.05;

  const score =
    weights.lifeAdv * lifeAdv +
    weights.hqProximity * hqProximity +
    weights.reachableArea * reachableArea +
    weights.threatenedTiles * threatenedTiles +
    weights.tempo * tempo;
  return clamp(score, -1, 1);
}

function minDistToCells(from: Set<string>, targets: Array<{ row: number; col: number }>): number {
  if (from.size === 0 || targets.length === 0) return 1e6;
  let best = Infinity;
  for (const key of from) {
    const [rs, cs] = key.split(',');
    const r = +rs;
    const c = +cs;
    for (const t of targets) {
      const d = Math.abs(r - t.row) + Math.abs(c - t.col);
      if (d < best) best = d;
    }
  }
  return best;
}

function isAdjacentTo(set: Set<string>, r: number, c: number, size: number): boolean {
  for (const [dr, dc] of [[1,0],[-1,0],[0,1],[0,-1]] as const) {
    const nr = r + dr;
    const nc = c + dc;
    if (!isInBounds(nr, nc, size)) continue;
    if (set.has(cellKey(nr, nc))) return true;
  }
  return false;
}

function clamp(x: number, lo: number, hi: number): number {
  return x < lo ? lo : x > hi ? hi : x;
}

// ─── Action priors ───────────────────────────────────────────────────────────

/**
 * Score a move heuristically. Higher = more attractive. Used to:
 *   - weight rollout sampling,
 *   - seed PUCT priors,
 *   - sort children for progressive widening.
 *
 * `mineProb` is a per-cell map [r,c] → P(mine) over enemy cells, computed
 * across the K determinized layouts. May be undefined (treated as 0.5).
 */
export function scoreMove(
  state: EngineState,
  move: EngineMove,
  color: PlayerColor,
  mineProb?: Map<string, number>,
): number {
  switch (move.type) {
    case 'capture':           return scoreCapture(state, move.row, move.col, color, mineProb);
    case 'defuse':            return scoreDefuse(state, move.row, move.col, color, mineProb);
    case 'chord':             return 0.7;
    case 'end_phase2':        return 0.05;
    case 'place_mine_phase3': return scorePlaceMinePhase3(state, move.row, move.col, color);
    case 'end_phase3':        return 0.05;
    case 'select_zone':       return scoreSelectZone(state, move.row, move.col, color, mineProb);
    case 'place_mine_setup':  return scorePlaceMineSetup(state, move.row, move.col, color);
    case 'confirm_setup':     return 0.1;
    case 'toggle_mark':       return 0;
    case 'forfeit':           return 0;
  }
}

function scoreCapture(
  state: EngineState,
  row: number, col: number,
  color: PlayerColor,
  mineProb?: Map<string, number>,
): number {
  const size = state.config.boardSize;
  const p = mineProb?.get(cellKey(row, col)) ?? 0.3;
  // Reward = closer to enemy HQ + lower mine prob.
  const enemyColor: PlayerColor = color === 'red' ? 'blue' : 'red';
  const hqDist = minDistFromCellToHq(row, col, enemyColor, size);
  const proximityBonus = Math.max(0, 1 - hqDist / size);
  const safety = 1 - p;
  return 0.4 * safety + 0.4 * proximityBonus + 0.2;
}

function scoreDefuse(
  state: EngineState,
  row: number, col: number,
  color: PlayerColor,
  mineProb?: Map<string, number>,
): number {
  const p = mineProb?.get(cellKey(row, col)) ?? 0.3;
  // Defuse is worth it when mine prob is high AND it's near HQ path.
  const size = state.config.boardSize;
  const enemyColor: PlayerColor = color === 'red' ? 'blue' : 'red';
  const hqDist = minDistFromCellToHq(row, col, enemyColor, size);
  const proximityBonus = Math.max(0, 1 - hqDist / size);
  return 0.7 * p + 0.3 * proximityBonus;
}

function scoreSelectZone(
  state: EngineState,
  clickedRow: number, clickedCol: number,
  color: PlayerColor,
  _mineProb?: Map<string, number>,
): number {
  // CORE GOAL (per user spec): the 3×3 DISPLAY zone must be *literally crossed*
  // by the red/blue border. That is, the 3×3 around the click must contain BOTH
  //   • our cells (so reveals show numbers we can read), AND
  //   • enemy cells (so we have capture targets next to our reachable set).
  //
  // Without this property a zone is useless:
  //   • all-own display → reveals show our own numbers (no enemy mine info),
  //     no capture targets in reach.
  //   • all-enemy display → we can only see numbers on cells we manage to
  //     capture, which is at most one or two on the perimeter.
  // The score below makes "border-straddling display" the dominant factor.
  //
  // Scoring layers (added together, weights chosen so layer 1 strictly beats
  // any zone that fails the straddling test):
  //   1. crossBonus    — large step bonus once 3×3 contains both colors,
  //                      plus a smooth term for balance (min(own,enemy)/4 in 3×3).
  //   2. capturable    — enemy cells in 3×3 adjacent to our reachable set
  //                      (these are the cells we can actually take this turn).
  //   3. ownReachableInDisplay
  //                    — count of our reachable cells inside the 3×3, which
  //                      determines how many numbers we'll actually see.
  //   4. azCapturable  — same idea on the 5×5 action zone (secondary signal).
  //   5. hqProx        — tiny tie-breaker so otherwise-equal frontier zones
  //                      lean toward attacking the enemy HQ side of the board.

  const size = state.config.boardSize;
  const enemyColor: PlayerColor = color === 'red' ? 'blue' : 'red';
  const myReachable = getReachablePlayerCells(state.board, color, size);

  // --- Pass over 3×3 display zone (clickedRow±1, clickedCol±1). ---
  let displayOwn = 0;
  let displayEnemy = 0;
  let displayOwnReachable = 0;
  let displayCapturable = 0;
  for (let dr = -1; dr <= 1; dr++) {
    for (let dc = -1; dc <= 1; dc++) {
      const r = clickedRow + dr;
      const c = clickedCol + dc;
      if (!isInBounds(r, c, size)) continue;
      const cell = state.board[r][c];
      if (cell.owner === color) {
        displayOwn++;
        if (myReachable.has(cellKey(r, c))) displayOwnReachable++;
      } else if (cell.owner === enemyColor) {
        displayEnemy++;
        if (isAdjacentTo(myReachable, r, c, size)) displayCapturable++;
      }
    }
  }

  // --- Pass over full 5×5 action zone for secondary capturable count. ---
  let azCapturable = 0;
  let azEnemyCount = 0;
  for (let dr = -2; dr <= 2; dr++) {
    for (let dc = -2; dc <= 2; dc++) {
      const r = clickedRow + dr;
      const c = clickedCol + dc;
      if (!isInBounds(r, c, size)) continue;
      const cell = state.board[r][c];
      if (cell.owner === enemyColor) {
        azEnemyCount++;
        if (isAdjacentTo(myReachable, r, c, size)) azCapturable++;
      }
    }
  }

  // -------- Layer 1: border-straddling bonus (DOMINANT term). --------
  // Step bonus: once display 3×3 contains AT LEAST one own AND one enemy cell,
  // we add a big constant. This is intentionally larger than any other layer
  // so that a straddling zone always beats a non-straddling one.
  const straddles = displayOwn > 0 && displayEnemy > 0 ? 1 : 0;
  // Smooth balance term — peaks when own ≈ enemy in the 3×3 (4/4 split with
  // the centre cell being one or the other). Encourages zones where the
  // border passes through the middle, not zones with 8 own + 1 enemy.
  const balance = displayOwn > 0 && displayEnemy > 0
    ? Math.min(displayOwn, displayEnemy) / 4
    : 0;
  const crossBonus = 1.0 * straddles + 0.5 * balance;

  // -------- Layer 2: capturable enemy cells inside the 3×3. --------
  // These are the cells we'll actually be able to take this turn — the
  // direct ROI of the zone selection.
  const displayCapturableNorm = Math.min(1, displayCapturable / 3);

  // -------- Layer 3: own-reachable cells inside the display zone. --------
  // Each own-reachable cell will receive a number after select, telling us
  // how many enemy mines are adjacent — pure information gain.
  const ownReachableInDisplay = Math.min(1, displayOwnReachable / 4);

  // -------- Layer 4: 5×5 capturable backup signal. --------
  const azCapturableNorm = Math.min(1, azCapturable / 6);

  // -------- Layer 5: weak HQ-proximity tie-breaker. --------
  const hqProx = 1 - minDistFromCellToHq(clickedRow, clickedCol, enemyColor, size) / size;

  // Weights chosen so that ANY straddling zone (Layer 1 contribution ≥ 1.0)
  // beats ANY non-straddling zone (Layer 1 = 0, all other layers sum < 1.0
  // because their normalized maxes are 1 each and weights are 0.40/0.25/0.20/0.05
  // summing to ≤ 0.9).
  void azEnemyCount; // currently unused, kept for future tuning
  return (
    1.10 * crossBonus
    + 0.40 * displayCapturableNorm
    + 0.25 * ownReachableInDisplay
    + 0.20 * azCapturableNorm
    + 0.05 * hqProx
  );
}

function scorePlaceMinePhase3(
  state: EngineState,
  row: number, col: number,
  color: PlayerColor,
): number {
  // Phase-3 mine placement priorities (per user spec):
  //   • HIGH: just-captured cells — these are our forward outposts and
  //     enemy retake targets; mining them costs them a defuse/life.
  //   • HIGH: cells close to OWN HQ — last-line defence around the
  //     headquarters that decides the game.
  //   • MED:  cells adjacent to enemy-reachable territory (chokepoints).
  //   • LOW:  forward bonus toward enemy HQ (offense is less important
  //     than protecting our own HQ in late phase).
  //   • CORNER/EDGE PENALTY: corners and the outer ring are rarely on
  //     the enemy's actual capture path — heavy penalty.
  //   • CLUSTER PENALTY: keep mines spread out so the enemy can't clear
  //     two with one chord/defuse.
  //   • JITTER: small per-turn variability so placement isn't identical
  //     turn after turn.
  const size = state.config.boardSize;
  const enemyColor: PlayerColor = color === 'red' ? 'blue' : 'red';
  const enemyReachable = getReachablePlayerCells(state.board, enemyColor, size);

  const adjEnemy = isAdjacentTo(enemyReachable, row, col, size) ? 1 : 0;

  // OWN-HQ proximity: bell with peak at HQ-distance 1..3. Right next to HQ
  // (dist 1) is the gold standard; dist 0 is HQ itself (already filtered).
  const hqDist = minDistFromCellToHq(row, col, color, size);
  let defenseBonus = 0;
  if (hqDist === 1) defenseBonus = 1.0;
  else if (hqDist === 2) defenseBonus = 0.85;
  else if (hqDist === 3) defenseBonus = 0.55;
  else if (hqDist === 4) defenseBonus = 0.25;
  // farther → 0

  const enemyHqDist = minDistFromCellToHq(row, col, enemyColor, size);
  const offenseBonus = Math.max(0, 1 - enemyHqDist / size);

  const justCaptured = state.turn.capturedThisTurn.has(cellKey(row, col)) ? 1 : 0;

  // CORNER / EDGE penalty.
  // Closer to a board corner → bigger penalty, linearly. At Manhattan
  // distance 0 from a corner (the corner cell itself) the penalty is at
  // its maximum (10, an order of magnitude larger than any positive term
  // in this function). At distance ≥ 3 the penalty fully vanishes.
  // This produces a smooth gradient: cells at the very corner are almost
  // never picked, cells one step away are strongly discouraged, cells two
  // steps away are mildly discouraged, and cells three+ steps away are
  // unaffected.
  const cornerDist = cornerManhattanDist(row, col, size);
  const cornerPenalty = Math.max(0, (2 - cornerDist) / 2) * 7;
  const edgeDist = Math.min(row, col, size - 1 - row, size - 1 - col);
  const isCorner = (row === 0 || row === size - 1) && (col === 0 || col === size - 1);
  let edgePenalty = 0;
  if (isCorner) edgePenalty = 1.0;
  else if (edgeDist === 0) edgePenalty = 0.45;
  else if (edgeDist === 1) edgePenalty = 0.12;

  // Cluster penalty unchanged in structure.
  let clusterMines = 0;
  for (let dr = -1; dr <= 1; dr++) {
    for (let dc = -1; dc <= 1; dc++) {
      if (dr === 0 && dc === 0) continue;
      const nr = row + dr;
      const nc = col + dc;
      if (!isInBounds(nr, nc, size)) continue;
      const ncell = state.board[nr][nc];
      if (ncell.owner === color && ncell.hasMine) clusterMines++;
    }
  }
  const clusterPenalty = clusterMines >= 2 ? 1.0 : clusterMines === 1 ? 0.5 : 0;

  // Per-turn jitter: deterministic but varies between turns. Hash
  // (row, col, turnsPlayed) so the same position picked on turn 4 vs
  // turn 5 produces different scores → bot diversifies placements
  // between turns without becoming non-deterministic within a single
  // turn (important for MCTS prior stability).
  const turnSalt = state.turn.turnsPlayed ?? 0;
  // Simple integer hash → [0,1)
  let h = (row * 73856093) ^ (col * 19349663) ^ ((turnSalt + 1) * 83492791);
  h = (h ^ (h >>> 13)) * 1274126177;
  h = h ^ (h >>> 16);
  const jitter = ((h >>> 0) / 0xffffffff - 0.5) * 0.20;

  return (
    0.55 * justCaptured
    + 0.45 * defenseBonus
    + 0.20 * adjEnemy
    + 0.10 * offenseBonus
    - 0.60 * edgePenalty
    - 0.45 * clusterPenalty
    - cornerPenalty
    + jitter
  );
}

/**
 * Manhattan distance from (row, col) to the nearest of the four board
 * corners. Used to build the smooth corner-avoidance gradient.
 */
function cornerManhattanDist(row: number, col: number, size: number): number {
  const r0 = Math.min(row, size - 1 - row);
  const c0 = Math.min(col, size - 1 - col);
  return r0 + c0;
}

function scorePlaceMineSetup(
  state: EngineState,
  row: number, col: number,
  color: PlayerColor,
): number {
  // Same as phase3, but penalize cells too close to own HQ (mine your own
  // forefront, not your back row).
  const size = state.config.boardSize;
  const hqDist = minDistFromCellToHq(row, col, color, size);
  // Sweet spot: 2..4 cells from HQ.
  const sweet = 1 - Math.abs(hqDist - 3) / size;
  // Dynamic corner penalty: linear ramp, max at the corner, 0 at dist ≥ 3.
  // See scorePlaceMinePhase3 for full rationale.
  const cornerDist = cornerManhattanDist(row, col, size);
  const cornerPenalty = Math.max(0, (2 - cornerDist) / 2) * 10;
  return sweet - cornerPenalty;
}

function minDistFromCellToHq(row: number, col: number, hqColor: PlayerColor, size: number): number {
  const hqs = getHeadquartersCells(hqColor, size);
  let best = Infinity;
  for (const h of hqs) {
    const d = Math.abs(row - h.row) + Math.abs(col - h.col);
    if (d < best) best = d;
  }
  return best;
}

// ─── Aggregate marginal mine probabilities over K layouts ────────────────────

/** Given K determinized full states, compute per-cell P(mine) for the
 *  perspective player's enemy cells. */
export function computeMineMarginals(
  layouts: EngineState[],
  perspective: PlayerColor,
): Map<string, number> {
  const out = new Map<string, number>();
  if (layouts.length === 0) return out;
  const size = layouts[0].config.boardSize;
  const counts = new Map<string, number>();
  const enemyColor: PlayerColor = perspective === 'red' ? 'blue' : 'red';
  for (const s of layouts) {
    for (let r = 0; r < size; r++) {
      for (let c = 0; c < size; c++) {
        if (s.board[r][c].owner !== enemyColor) continue;
        const k = cellKey(r, c);
        if (s.board[r][c].hasMine) counts.set(k, (counts.get(k) ?? 0) + 1);
      }
    }
  }
  for (const [k, v] of counts) {
    out.set(k, v / layouts.length);
  }
  return out;
}
