/**
 * Deduction-driven move policy.
 *
 * This module turns the raw [`DeductionInfo`](packages/frontend/src/ai/patterns/deduce.ts:1)
 * into concrete play decisions used by all bot difficulty levels:
 *
 *   • **Mandatory captures**: any enemy cell in the action zone with
 *     `pMine === 0` (certain safe) must be captured — never leave free
 *     territory on the board.
 *   • **Mandatory defuses**: any enemy cell in the action zone with
 *     `pMine === 1` (certain mine) gets the strongest defuse priority,
 *     provided we still have defuses left this turn.
 *   • **Aggressive defuses**: when no certain move exists but we still have
 *     unspent defuses this turn, defuse the highest-pMine candidate in the
 *     action zone. Defusing reveals information that often unlocks new
 *     deduction patterns on the next step.
 *   • **One-step lookahead threats**: detect cells the enemy can capture
 *     next turn that put them adjacent to our HQ. If we can capture the
 *     threatening enemy cell ourselves, do it; in phase 3, prefer placing
 *     mines on our cells that lie on the threat path.
 *   • **Risk modulation by lives**: captures are forbidden when
 *     `pMine > capThresholdForLives(lives)`. With 1 life left we refuse
 *     any uncertain capture; with 2 lives we use the configured
 *     [`BotConfig.dangerThresholdCapture`](packages/frontend/src/ai/types.ts:1);
 *     with 3+ lives we widen further.
 *   • **Mines maximally**: in phase 3 we never voluntarily end the phase
 *     while mines remain AND a defensible placement exists.
 *
 * Difficulty controls the **strength** of the deduction (trivial / subset /
 * full) and the dispatcher's adventurousness; the *direction* of the rules
 * is the same for every level — the user's spec was explicit that even the
 * easy bot must not step on a guaranteed mine and must use mines/defuses.
 */

import {
  cellKey,
  getHeadquartersCells,
  getReachablePlayerCells,
  isInBounds,
} from '@minesweeper-pvp/shared';
import type { PlayerColor } from '@minesweeper-pvp/shared';
import type { BotConfig, EngineMove, EngineState } from '../types';
import type { DeductionInfo } from './deduce';

export interface MoveDecision {
  /** Chosen move, or `null` if the policy doesn't have a forced answer
   *  (caller falls back to MCTS / greedy prior). */
  move: EngineMove | null;
  /** Human-readable reason — useful for tests/logs. */
  reason: string;
}

/**
 * Pick a forced move based on deduction. Returns `null` when there is no
 * clear best — the caller (MCTS / greedy) should decide.
 *
 * Order of consideration:
 *   1. Certain-safe captures inside the action zone.
 *   2. Certain-mine defuses inside the action zone (if we still have defuses).
 *   3. Defensive captures — if the enemy can capture our HQ next turn and
 *      the threatening enemy cell is in our action zone, take it.
 *   4. Otherwise return `null` and let the caller pick among uncertain
 *      moves under risk constraints.
 */
export function pickForcedPhase2Move(
  state: EngineState,
  color: PlayerColor,
  ded: DeductionInfo,
  legalMoves: EngineMove[],
  threats?: ThreatInfo,
): MoveDecision {
  if (state.turn.phase !== 'phase2') return { move: null, reason: 'not phase2' };

  const enemy: PlayerColor = color === 'red' ? 'blue' : 'red';
  const canDefuse = state.turn.canDefuse
    && state.turn.defusesUsedThisTurn < state.turn.defusesPerTurn;

  // 0. WIN CONDITION — capturing any enemy HQ cell ends the game in our favour.
  //    If a capture of an enemy HQ cell is legal AND not a certain mine, take
  //    it immediately. If it's a certain mine and we have a defuse, defuse it
  //    first (next turn / capture chain handles the rest). This priority
  //    overrides everything else, since nothing matters more than winning.
  const enemyHqs = getHeadquartersCells(enemy, state.config.boardSize);
  const enemyHqKeys = new Set(enemyHqs.map((h) => cellKey(h.row, h.col)));
  // Defuse a certain-mine HQ cell first if we can.
  if (canDefuse) {
    for (const m of legalMoves) {
      if (m.type !== 'defuse') continue;
      const k = cellKey(m.row, m.col);
      if (!enemyHqKeys.has(k)) continue;
      const p = ded.pMine.get(k) ?? 0;
      if (p >= 0.5) {
        return { move: m, reason: `WIN-prep defuse of enemy HQ ${k}` };
      }
    }
  }
  // Capture an enemy HQ cell if not certain-mine.
  for (const m of legalMoves) {
    if (m.type !== 'capture') continue;
    const k = cellKey(m.row, m.col);
    if (!enemyHqKeys.has(k)) continue;
    const p = ded.pMine.get(k) ?? 0;
    if (p < 0.99) {
      return { move: m, reason: `WIN capture of enemy HQ ${k} (pMine=${p.toFixed(2)})` };
    }
  }

  // 1. Certain-safe captures inside legal action zone.
  for (const m of legalMoves) {
    if (m.type !== 'capture') continue;
    const k = cellKey(m.row, m.col);
    if (ded.certainSafe.has(k)) {
      return { move: m, reason: `certain-safe capture at ${k}` };
    }
  }

  // 2. Certain-mine defuses inside legal action zone.
  if (canDefuse) {
    for (const m of legalMoves) {
      if (m.type !== 'defuse') continue;
      const k = cellKey(m.row, m.col);
      if (ded.certainMine.has(k)) {
        return { move: m, reason: `certain-mine defuse at ${k}` };
      }
    }
  }

  // 3. Defensive capture — if enemy will reach our HQ next turn and a
  //    threatening enemy cell is in our action zone, take it (provided it
  //    isn't a known mine).
  if (threats && threats.distance <= 3 && threats.threatEnemyCells.size > 0) {
    for (const m of legalMoves) {
      if (m.type !== 'capture') continue;
      const k = cellKey(m.row, m.col);
      if (!threats.threatEnemyCells.has(k)) continue;
      if (ded.certainMine.has(k)) continue; // would be a free hit; skip
      const p = ded.pMine.get(k) ?? 0.3;
      // Even with 1 life remaining we may need to take the hit to survive.
      // Cap at 0.7 — beyond that, defuse instead (handled below).
      if (p <= 0.7) {
        return { move: m, reason: `defensive capture at ${k} (threat dist=${threats.distance})` };
      }
    }
    // Try defensive defuse on the threatening cell.
    if (canDefuse) {
      for (const m of legalMoves) {
        if (m.type !== 'defuse') continue;
        const k = cellKey(m.row, m.col);
        if (!threats.threatEnemyCells.has(k)) continue;
        return { move: m, reason: `defensive defuse at ${k} (threat dist=${threats.distance})` };
      }
    }
  }

  return { move: null, reason: 'no forced move' };
}

/**
 * Pick the best aggressive-defuse target when no certain move exists. Even
 * a 30-40% mine guess is worth defusing if we'd otherwise waste the slot —
 * the resulting reveal often unlocks new constraints.
 *
 * Returns `null` when defuses are exhausted, when no defuse move is legal,
 * or when no candidate exceeds the minimum useful threshold.
 */
export function pickAggressiveDefuse(
  state: EngineState,
  color: PlayerColor,
  ded: DeductionInfo,
  cfg: BotConfig,
  legalMoves: EngineMove[],
): MoveDecision {
  if (state.turn.phase !== 'phase2') return { move: null, reason: 'not phase2' };
  if (!state.turn.canDefuse) return { move: null, reason: 'no canDefuse' };
  if (state.turn.defusesUsedThisTurn >= state.turn.defusesPerTurn) {
    return { move: null, reason: 'defuses exhausted' };
  }

  const defuseMoves = legalMoves.filter((m) => m.type === 'defuse');
  if (defuseMoves.length === 0) return { move: null, reason: 'no legal defuse' };

  // Are there any certain-safe captures still available? If yes, capture
  // first — this fn is only called when forced moves are exhausted, so the
  // caller has already checked. But guard anyway.
  for (const m of legalMoves) {
    if (m.type !== 'capture') continue;
    if (ded.certainSafe.has(cellKey(m.row, m.col))) {
      return { move: null, reason: 'has certain-safe capture' };
    }
  }

  const me = state.players.find((p) => p.color === color);
  const lives = me?.lives ?? 3;
  // Base threshold: minimum mine probability we'd ever defuse.
  // With 1 life left we're more eager — even a 0.15 chance to dodge a hit
  // is worthwhile. With 3 lives, only defuse if we're fairly confident.
  const baseThreshold = lives <= 1 ? 0.15 : (lives === 2 ? 0.20 : 0.25);

  // Defuse-budget rule (the key fix for "bot wastes defuses on 50/50"):
  // If we still have MORE THAN ONE defuse left this turn, save the early
  // ones for high-confidence mines (≥0.6). Only on the LAST defuse of the
  // turn do we permit aggressive low-probability gambles. This way, given
  // 3 defuses, the bot spends 2 on certainties and at most 1 on a 50/50.
  const defusesLeft = state.turn.defusesPerTurn - state.turn.defusesUsedThisTurn;
  const confidentOnly = defusesLeft > 1;
  const effectiveThreshold = confidentOnly ? Math.max(baseThreshold, 0.6) : baseThreshold;
  const size = state.config.boardSize;

  // Selection is PRIMARILY by mine probability — info-gain is a tiny
  // tie-breaker, not a co-ranker. This prevents a 0.5 cell with 4
  // numbered neighbours from outranking a 0.7 cell with none.
  let bestMove: EngineMove | null = null;
  let bestP = -Infinity;
  let bestInfo = -1;
  for (const m of defuseMoves) {
    if (m.type !== 'defuse') continue;
    const k = cellKey(m.row, m.col);
    const p = ded.pMine.get(k) ?? 0.3;
    if (p < effectiveThreshold) continue;
    if (p >= 0.999) continue; // certain-mine — handled by forced move
    // Information gain: count our revealed numbered cells in 8-neighbourhood.
    let info = 0;
    for (let dr = -1; dr <= 1; dr++) {
      for (let dc = -1; dc <= 1; dc++) {
        if (dr === 0 && dc === 0) continue;
        const nr = m.row + dr;
        const nc = m.col + dc;
        if (!isInBounds(nr, nc, size)) continue;
        const cell = state.board[nr][nc];
        if (cell.owner === color && cell.isRevealed && cell.number !== null) info++;
      }
    }
    // Bucket p to 0.05 to avoid float-jitter favouring slightly-higher cells
    // for trivial reasons; within a bucket, prefer higher info.
    const pBucket = Math.round(p * 20) / 20;
    if (pBucket > bestP || (pBucket === bestP && info > bestInfo)) {
      bestP = pBucket;
      bestInfo = info;
      bestMove = m;
    }
  }

  if (bestMove) {
    return {
      move: bestMove,
      reason: `aggressive defuse p≈${bestP.toFixed(2)} info=${bestInfo} (defusesLeft=${defusesLeft}, threshold=${effectiveThreshold.toFixed(2)})`,
    };
  }
  return {
    move: null,
    reason: confidentOnly
      ? `no defuse above confident threshold ${effectiveThreshold.toFixed(2)} (saving ${defusesLeft - 1} for 50/50 later)`
      : 'no defuse above threshold',
  };
}

/** Maximum acceptable `pMine` for a capture given current lives. */
export function capThresholdForLives(lives: number, base: number): number {
  if (lives <= 1) return 0.05;     // 1 life: refuse any uncertain capture
  if (lives === 2) return base;    // configured base (e.g. 0.30)
  if (lives === 3) return Math.min(0.6, base + 0.15);
  return Math.min(0.75, base + 0.25);
}

/** Maximum acceptable `pMine` for a defuse target — defusing wastes the
 *  defuse if the cell turned out to be safe, so we want a LOWER bound,
 *  i.e. only defuse cells we believe are mines with reasonable confidence. */
export function defuseThresholdForLives(lives: number, base: number): number {
  if (lives <= 1) return Math.max(0.4, base - 0.1); // be eager to defuse anything risky
  return base;                                       // configured base
}

/**
 * Filter capture moves whose mine probability exceeds the threshold for the
 * current life count. Used to keep MCTS / greedy from ever choosing a "we
 * lose a life almost for sure" capture.
 */
export function filterUnsafeCaptures(
  state: EngineState,
  color: PlayerColor,
  cfg: BotConfig,
  ded: DeductionInfo,
  moves: EngineMove[],
): EngineMove[] {
  const me = state.players.find((p) => p.color === color);
  if (!me) return moves;
  const threshold = capThresholdForLives(me.lives, cfg.dangerThresholdCapture);
  return moves.filter((m) => {
    if (m.type !== 'capture') return true;
    const k = cellKey(m.row, m.col);
    if (ded.certainSafe.has(k)) return true;
    if (ded.certainMine.has(k)) return false;
    const p = ded.pMine.get(k) ?? 0.3;
    return p <= threshold;
  });
}

/**
 * Decide whether the bot should voluntarily call `end_phase3`. The rule per
 * spec: don't end while mines remain AND a defensible placement exists.
 */
export function shouldEndPhase3(state: EngineState, legalMoves: EngineMove[]): boolean {
  if (state.turn.phase !== 'phase3') return true;
  const remaining = state.turn.minesAllowedThisTurn - state.turn.minesPlacedThisTurn;
  if (remaining <= 0) return true;
  const hasPlacement = legalMoves.some((m) => m.type === 'place_mine_phase3');
  return !hasPlacement;
}

// ─── One-step lookahead threat assessment ───────────────────────────────────

export interface ThreatInfo {
  /** Min Manhattan distance (over reachable chain) from any enemy-reachable
   *  cell to any of our HQ cells. 1 = enemy captures HQ next turn unless
   *  intercepted. 2 = enemy captures one own cell first, then HQ. ∞ = safe. */
  distance: number;
  /** Our own cells that lie on the imminent threat path — phase-3 mines
   *  here disrupt the enemy's capture plan. */
  threatOwnCells: Set<string>;
  /** Enemy cells immediately threatening us — capturing or defusing one of
   *  these in phase 2 breaks the chain. */
  threatEnemyCells: Set<string>;
}

/**
 * Compute one-step (and two-step) lookahead threats to our HQ.
 *
 * We don't simulate the full enemy turn. Instead we use the local
 * "reachable chain" model: enemy can capture an own cell `X` if `X` is
 * orthogonally adjacent to any cell already enemy-reachable. Repeating
 * this rule once gives us a 1-step extension of the enemy's territory.
 *
 *   distance = 1: an enemy-reachable cell is adjacent to an HQ cell → loss
 *                  next turn unless we capture/mine away the threat.
 *   distance = 2: an enemy-reachable cell is adjacent to an own non-HQ
 *                  cell that itself touches the HQ → place mines on the
 *                  interior own cell.
 */
export function assessHqThreats(state: EngineState, color: PlayerColor): ThreatInfo {
  // Use the new rush model to fill ThreatInfo. The legacy fields
  // `threatOwnCells` / `threatEnemyCells` are populated from the rush path
  // so existing callers (defensive capture / defensive mine placement)
  // keep working without changes.
  const rush = assessRushModel(state, color, color === 'red' ? 'blue' : 'red');
  const threatOwnCells = new Set<string>();
  const threatEnemyCells = new Set<string>();
  if (rush.distance <= 3 && rush.origin) {
    threatEnemyCells.add(cellKey(rush.origin.row, rush.origin.col));
    for (const k of rush.pathCells) {
      const [rs, cs] = k.split(',');
      const r = +rs, c = +cs;
      const cell = state.board[r]?.[c];
      if (!cell) continue;
      if (cell.owner === color) threatOwnCells.add(k);
    }
  }
  return {
    distance: rush.distance,
    threatOwnCells,
    threatEnemyCells,
  };
}

// ─── Rush model ──────────────────────────────────────────────────────────────

export interface RushModel {
  /** BFS distance (in capture steps) from the closest attacker-reachable cell
   *  to any defender HQ cell, walking through defender-owned cells. ∞ if
   *  no path exists. A turn can chain at most 3 captures within one 5×5
   *  action zone, so a value ≤ 3 means an attack reaches HQ this turn given
   *  enough defuses and a single zone selection. */
  distance: number;
  /** Cells visited along the shortest path, from the attacker's starting
   *  cell (an attacker-owned cell adjacent to a defender cell) through
   *  defender cells, ending at the HQ. Each cell encoded as "r,c". */
  pathCells: Set<string>;
  /** Path entries with extra info, in order from attacker start to HQ. */
  path: Array<{ row: number; col: number; isHq: boolean; pMine: number }>;
  /** Attacker-owned cell that initiates the rush (path[0]). */
  origin: { row: number; col: number } | null;
  /** Sum of pMine over the defender cells on the path (= expected number of
   *  defuses the attacker needs to traverse safely). */
  expectedMinesOnPath: number;
  /** Count of certain mines (pMine ≥ 0.99) on the path. */
  certainMinesOnPath: number;
}

/**
 * Compute the shortest rush from `attacker`'s reachable territory to any
 * cell of `defender`'s HQ. Uses BFS through defender-owned cells, with
 * the attacker's reachable cells as starting nodes.
 *
 * The defender (`color` in assessHqThreats) sees:
 *   distance ≤ 3 → enemy can REACH HQ this turn in the worst case.
 *   distance > 3 → enemy can't reach HQ this turn no matter what.
 *
 * The same model used with roles swapped (attacker=us, defender=them)
 * tells us when WE have a rush opportunity to win the game this turn.
 */
export function assessRushModel(
  state: EngineState,
  attacker: PlayerColor,
  defender: PlayerColor,
  mineProb?: Map<string, number>,
): RushModel {
  const size = state.config.boardSize;
  const attackerReachable = getReachablePlayerCells(state.board, attacker, size);
  const defenderHqs = getHeadquartersCells(defender, size);
  const defenderHqKeys = new Set(defenderHqs.map((h) => cellKey(h.row, h.col)));

  // Helper: is (r,c) a viable next step for the attacker?
  // — must be in bounds and currently defender-owned (we walk through defender
  //   territory toward the HQ; the attacker captures each step).
  const isWalkable = (r: number, c: number): boolean => {
    if (!isInBounds(r, c, size)) return false;
    const cell = state.board[r][c];
    return cell.owner === defender;
  };

  // BFS frontier: every defender-owned cell adjacent to attackerReachable
  // is reachable in 1 step. We pick the closest HQ cell.
  type QEntry = { row: number; col: number; dist: number; parentKey: string | null };
  const visited = new Map<string, { dist: number; parentKey: string | null }>();
  const queue: QEntry[] = [];

  // Seed: every defender cell orthogonally adjacent to an attackerReachable cell.
  for (const aKey of attackerReachable) {
    const [rs, cs] = aKey.split(',');
    const ar = +rs, ac = +cs;
    for (const [dr, dc] of [[-1, 0], [1, 0], [0, -1], [0, 1]] as const) {
      const nr = ar + dr;
      const nc = ac + dc;
      if (!isWalkable(nr, nc)) continue;
      const nk = cellKey(nr, nc);
      if (visited.has(nk)) continue;
      visited.set(nk, { dist: 1, parentKey: aKey });
      queue.push({ row: nr, col: nc, dist: 1, parentKey: aKey });
    }
  }

  let bestHqEntry: QEntry | null = null;
  // BFS proper — never beyond a reasonable horizon (size*size is a hard cap).
  while (queue.length > 0) {
    const cur = queue.shift()!;
    if (defenderHqKeys.has(cellKey(cur.row, cur.col))) {
      bestHqEntry = cur;
      break;
    }
    for (const [dr, dc] of [[-1, 0], [1, 0], [0, -1], [0, 1]] as const) {
      const nr = cur.row + dr;
      const nc = cur.col + dc;
      if (!isWalkable(nr, nc)) continue;
      const nk = cellKey(nr, nc);
      if (visited.has(nk)) continue;
      visited.set(nk, { dist: cur.dist + 1, parentKey: cellKey(cur.row, cur.col) });
      queue.push({ row: nr, col: nc, dist: cur.dist + 1, parentKey: cellKey(cur.row, cur.col) });
    }
  }

  if (!bestHqEntry) {
    return {
      distance: Infinity,
      pathCells: new Set(),
      path: [],
      origin: null,
      expectedMinesOnPath: 0,
      certainMinesOnPath: 0,
    };
  }

  // Reconstruct path from bestHqEntry back to the attacker origin.
  const pathReversed: string[] = [];
  let curKey: string | null = cellKey(bestHqEntry.row, bestHqEntry.col);
  while (curKey) {
    pathReversed.push(curKey);
    const v = visited.get(curKey);
    if (!v) break;
    if (v.parentKey && attackerReachable.has(v.parentKey)) {
      // Parent is the attacker origin — include it as path[0].
      pathReversed.push(v.parentKey);
      break;
    }
    curKey = v.parentKey;
  }
  const pathForward = pathReversed.reverse();

  const pathCells = new Set(pathForward);
  const path: RushModel['path'] = [];
  let expectedMinesOnPath = 0;
  let certainMinesOnPath = 0;
  for (const k of pathForward) {
    const [rs, cs] = k.split(',');
    const r = +rs, c = +cs;
    const cell = state.board[r][c];
    const isHq = defenderHqKeys.has(k);
    // pMine: attacker's perspective. For attacker-owned origin we use 0.
    let p = 0;
    if (cell.owner === defender) {
      p = mineProb?.get(k) ?? (cell.hasMine ? 1 : 0);
    }
    path.push({ row: r, col: c, isHq, pMine: p });
    if (cell.owner === defender) {
      expectedMinesOnPath += p;
      if (p >= 0.99) certainMinesOnPath += 1;
    }
  }

  const originEntry = path[0] ?? null;
  const origin = originEntry ? { row: originEntry.row, col: originEntry.col } : null;

  return {
    distance: bestHqEntry.dist,
    pathCells,
    path,
    origin,
    expectedMinesOnPath,
    certainMinesOnPath,
  };
}

/**
 * Pick a defensive phase-3 mine placement. Prefers cells on the threat
 * path. Returns `null` if no threat or no suitable legal placement.
 */
export function pickDefensivePhase3(
  state: EngineState,
  threats: ThreatInfo,
  legalMoves: EngineMove[],
): MoveDecision {
  if (state.turn.phase !== 'phase3') return { move: null, reason: 'not phase3' };
  if (threats.distance > 3) return { move: null, reason: 'no imminent threat' };
  if (threats.threatOwnCells.size === 0) return { move: null, reason: 'no threat cells' };

  for (const m of legalMoves) {
    if (m.type !== 'place_mine_phase3') continue;
    const k = cellKey(m.row, m.col);
    if (threats.threatOwnCells.has(k)) {
      return { move: m, reason: `defensive mine at ${k}` };
    }
  }
  return { move: null, reason: 'threat cells not in legal placements' };
}

// ─── Trivial chord-like pattern scanner ──────────────────────────────────────

/**
 * Catches the "super-dumb" minesweeper pattern the user described:
 *
 *   • own revealed number N
 *   • flagged + certain-mine neighbours == N
 *     → every OTHER unflagged enemy-closed neighbour is provably SAFE.
 *       We try in order: legal capture, legal chord, else flag a certain
 *       mine to make the chord legal on the next step.
 *   • unflagged enemy-closed neighbours == N - flagged
 *     → every unflagged enemy-closed neighbour is provably a MINE.
 *       We defuse the first one that's legal.
 *
 * This runs over the entire board (not just the action zone), but emits only
 * moves that are either legal *now* or that enable a chord legal *next step*.
 * It complements `pickForcedPhase2Move`: `pickForcedPhase2Move` requires the
 * safe target to be a legal capture (orthogonally reachable own neighbour);
 * this scanner additionally handles the case where the safe target is in
 * the display zone but only reachable via chord.
 *
 * Returns `null` when no trivial pattern applies.
 */
export function pickTrivialChord(
  state: EngineState,
  color: PlayerColor,
  ded: DeductionInfo,
  legalMoves: EngineMove[],
): MoveDecision {
  if (state.turn.phase !== 'phase2') return { move: null, reason: 'not phase2' };

  const size = state.config.boardSize;
  const enemy: PlayerColor = color === 'red' ? 'blue' : 'red';
  const myMarks = state.marks[color];
  const canDefuse = state.turn.canDefuse
    && state.turn.defusesUsedThisTurn < state.turn.defusesPerTurn;

  // Index legal moves for O(1) lookup.
  const legalCaps = new Set<string>();
  const legalDefs = new Set<string>();
  const legalChords = new Set<string>();
  for (const m of legalMoves) {
    if (m.type === 'capture') legalCaps.add(cellKey(m.row, m.col));
    else if (m.type === 'defuse') legalDefs.add(cellKey(m.row, m.col));
    else if (m.type === 'chord') legalChords.add(cellKey(m.row, m.col));
  }

  // First pass — collect candidate "safe-reveal" patterns. We try direct
  // captures first across ALL numbers before considering flag/chord, so a
  // single legal capture wins over a slower flag-then-chord sequence.
  type SafePat = {
    numR: number;
    numC: number;
    safeTargets: Array<{ r: number; c: number; k: string }>;
    unflaggedCertainMines: Array<{ r: number; c: number; k: string }>;
  };
  const safePats: SafePat[] = [];
  const allMineDefuseTargets: Array<{ r: number; c: number; k: string; numR: number; numC: number }> = [];

  for (let r = 0; r < size; r++) {
    for (let c = 0; c < size; c++) {
      const cell = state.board[r][c];
      if (cell.owner !== color || !cell.isRevealed || cell.number === null) continue;

      let flagged = 0;
      let certainMineCount = 0;
      const unflaggedClosed: Array<{ r: number; c: number; k: string; certain: boolean }> = [];
      const unflaggedCertainMines: Array<{ r: number; c: number; k: string }> = [];
      for (let dr = -1; dr <= 1; dr++) {
        for (let dc = -1; dc <= 1; dc++) {
          if (dr === 0 && dc === 0) continue;
          const nr = r + dr, nc = c + dc;
          if (!isInBounds(nr, nc, size)) continue;
          const ncell = state.board[nr][nc];
          if (ncell.owner !== enemy) continue;
          // Skip already-revealed enemy cells (rare but possible after a
          // partial reveal — not actionable for chord/capture anyway).
          if (ncell.isRevealed) continue;
          const nk = cellKey(nr, nc);
          if (myMarks[nk] === 'flag') { flagged++; continue; }
          const isCertain = ded.certainMine.has(nk);
          unflaggedClosed.push({ r: nr, c: nc, k: nk, certain: isCertain });
          if (isCertain) {
            certainMineCount++;
            unflaggedCertainMines.push({ r: nr, c: nc, k: nk });
          }
        }
      }

      const N = cell.number;

      // Case A — safe-reveal: number fully accounted for by flagged +
      // certain-mine neighbours. All other unflagged closed neighbours are
      // provably safe.
      if (flagged + certainMineCount === N) {
        const safeTargets = unflaggedClosed
          .filter((u) => !u.certain)
          .map((u) => ({ r: u.r, c: u.c, k: u.k }));
        if (safeTargets.length > 0) {
          safePats.push({
            numR: r,
            numC: c,
            safeTargets,
            unflaggedCertainMines,
          });
        }
      }

      // Case B — all-mine: unflagged closed enemy neighbours exactly fill
      // the remaining mine count.
      if (
        unflaggedClosed.length > 0
        && unflaggedClosed.length === N - flagged
        && canDefuse
      ) {
        for (const u of unflaggedClosed) {
          allMineDefuseTargets.push({ r: u.r, c: u.c, k: u.k, numR: r, numC: c });
        }
      }
    }
  }

  // 1. Any legal direct capture from a Case-A pattern → take it now.
  for (const pat of safePats) {
    for (const t of pat.safeTargets) {
      if (legalCaps.has(t.k)) {
        return {
          move: { type: 'capture', row: t.r, col: t.c },
          reason: `trivial safe capture at ${t.k} via num@${pat.numR},${pat.numC}`,
        };
      }
    }
  }

  // 2. Any legal certain-mine defuse from a Case-B pattern → take it now.
  if (canDefuse) {
    for (const t of allMineDefuseTargets) {
      if (legalDefs.has(t.k)) {
        return {
          move: { type: 'defuse', row: t.r, col: t.c },
          reason: `trivial all-mine defuse at ${t.k} via num@${t.numR},${t.numC}`,
        };
      }
    }
  }

  // 3. Any already-legal chord from a Case-A pattern → take it.
  for (const pat of safePats) {
    const numK = cellKey(pat.numR, pat.numC);
    if (legalChords.has(numK)) {
      return {
        move: { type: 'chord', row: pat.numR, col: pat.numC },
        reason: `trivial chord@${numK}`,
      };
    }
  }

  // 4. Flag-then-chord: find a Case-A pattern whose certain mines aren't
  //    flagged yet. Flagging one moves us toward making the chord legal
  //    next step. We pick the pattern with the *fewest* remaining flags
  //    needed so the chord unlocks soonest.
  let bestFlag: { r: number; c: number; remaining: number } | null = null;
  for (const pat of safePats) {
    const needFlag = pat.unflaggedCertainMines;
    if (needFlag.length === 0) continue;
    // Quick sanity: chord on this number won't be legal even after flagging
    // unless the number cell is in our display zone. Check by looking at
    // state.turn.selectedZone; if absent, skip.
    const dz = state.turn.selectedZone;
    if (!dz) continue;
    if (pat.numR < dz.row || pat.numR >= dz.row + 3) continue;
    if (pat.numC < dz.col || pat.numC >= dz.col + 3) continue;
    // Prefer pattern needing fewest flags.
    if (!bestFlag || needFlag.length < bestFlag.remaining) {
      bestFlag = { r: needFlag[0].r, c: needFlag[0].c, remaining: needFlag.length };
    }
  }
  if (bestFlag) {
    return {
      move: { type: 'toggle_mark', row: bestFlag.r, col: bestFlag.c, mark: 'flag' },
      reason: `flag certain mine at ${bestFlag.r},${bestFlag.c} to enable chord (${bestFlag.remaining} flag(s) needed)`,
    };
  }

  return { move: null, reason: 'no trivial chord pattern' };
}
