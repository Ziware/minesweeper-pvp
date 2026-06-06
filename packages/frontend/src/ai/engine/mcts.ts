/**
 * Information-Set MCTS with determinization. See
 * [`plans/ai-bot/03-mcts-core.md`](plans/ai-bot/03-mcts-core.md:1).
 *
 * High-level: for each simulation, sample a determinization (a complete
 * EngineState consistent with the bot's observation), then run a standard
 * UCT walk + rollout on that state. Stats are accumulated across all
 * determinizations under shared root children keyed by `moveKey`.
 */

import { cellKey } from '@minesweeper-pvp/shared';
import type { PlayerColor } from '@minesweeper-pvp/shared';
import type { BotConfig, BotObservation, EngineMove, EngineState } from '../types';
import { moveKey } from '../types';
import { applyMove, cloneState, isTerminal } from './simulator';
import { enumerateMoves } from './actions';
import { scoreMove, computeMineMarginals } from './eval';
import { rollout } from './rollout';
import { determinize, makeRng } from './determinize';
import { deduce } from '../patterns/deduce';
import {
  pickForcedPhase2Move,
  pickAggressiveDefuse,
  pickGambleCapture,
  filterUnsafeCaptures,
  shouldEndPhase3,
  assessHqThreats,
  assessRushModel,
  pickDefensivePhase3,
  pickTrivialChord,
} from '../patterns/policy';

interface Node {
  /** Move that led to this node from its parent (null at root). */
  move: EngineMove | null;
  parent: Node | null;
  /** color whose turn it WAS at parent state (the one who chose `move`). */
  actor: PlayerColor | null;
  children: Map<string, Node>;
  /** Untried moves for the current player at this node, in priority order. */
  untried: EngineMove[];
  visits: number;
  totalValue: number; // From perspective of root bot.
}

function makeNode(parent: Node | null, move: EngineMove | null, actor: PlayerColor | null, untried: EngineMove[]): Node {
  return {
    move, parent, actor,
    children: new Map(),
    untried,
    visits: 0,
    totalValue: 0,
  };
}

export interface MctsResult {
  bestMove: EngineMove;
  simsRun: number;
  rootStats: Array<{ move: EngineMove; visits: number; meanValue: number }>;
}

export function runMcts(obs: BotObservation, config: BotConfig, seed: number): MctsResult {
  const rand = makeRng(seed);
  const botColor = obs.botColor;

  // 1. Determinize K layouts.
  const layouts = determinize(obs, {
    samples: Math.max(1, config.layoutSamples),
    rand,
    enforceNumbers: true,
    maxAttempts: 4,
  });
  if (layouts.length === 0) {
    // Fallback: synthesize one zero-mine layout from obs.
    return fallbackHeuristic(obs, config);
  }

  // 2. Pre-compute mine marginals from determinizations.
  const mineProb = computeMineMarginals(layouts.map((l) => l.state), botColor);

  // 3. Build root from one layout (we'll re-roll determinization between sims).
  const rootState = layouts[0].state;

  // 4. Run exact deduction on the OBSERVATION (not on a determinization —
  //    we want the actual visible numbers / our own flags). Override the
  //    sampled marginals with exact 0/1 for certain cells, and otherwise
  //    blend the exact `pMine` with the determinized estimate.
  const ded = deduce(rootState, {
    perspective: botColor,
    level: config.deductionLevel,
  });
  for (const k of ded.certainMine) mineProb.set(k, 1);
  for (const k of ded.certainSafe) mineProb.set(k, 0);
  for (const [k, p] of ded.pMine) {
    if (p === 0 || p === 1) continue;
    const sampled = mineProb.get(k);
    // Blend exact (from CSP) with sampled (from K layouts). The exact value
    // is more trustworthy when known; sampled covers cells outside the
    // constraint frontier.
    mineProb.set(k, sampled === undefined ? p : 0.7 * p + 0.3 * sampled);
  }

  // 5. One-step lookahead threat assessment — drives defensive forced
  //    moves (capture/defuse the cell about to capture our HQ) and
  //    defensive phase-3 mine placement.
  const threats = assessHqThreats(rootState, botColor);

  // 6. Try forced-move shortcuts (work for every difficulty level):
  //    - WIN RUSH: execute next step of a 2-3 move chain to enemy HQ.
  //    - certain-safe capture in action zone → take it.
  //    - certain-mine defuse in action zone → take it.
  //    - defensive capture/defuse if enemy threatens our HQ.
  const rootMoves = enumerateMoves(rootState, { useChord: config.useChord });

  // ─── Deliberate-mistake helpers ────────────────────────────────────────
  // `blunder()` rolls against config.blunderRate; when it succeeds the
  // current forced-move policy slot is SKIPPED, mimicking a human
  // overlooking the obvious play. WIN-RUSH and defensive HQ moves are NOT
  // wrapped — losing the game outright on a blunder would be too cruel.
  const blunderRate = config.blunderRate ?? 0;
  const earlyEndRate = config.earlyEndPhaseRate ?? 0;
  const blunder = (): boolean => blunderRate > 0 && rand() < blunderRate;
  // Early-end fires only when we've already made at least one move this
  // turn — we don't want the bot to walk into a zone and immediately quit.
  const earlyEnd = (): boolean => {
    if (earlyEndRate <= 0) return false;
    if (rootState.turn.capturedThisTurn.size === 0
      && rootState.turn.minesPlacedThisTurn === 0) return false;
    return rand() < earlyEndRate;
  };

  // 6a. WIN-RUSH execution: if there is a viable rush path to enemy HQ that
  //     is short enough to finish this turn, take the next-required action
  //     on it (defuse certain mine on path / capture safe step on path).
  //     This is what turns a "we could win in 2 captures" position into an
  //     actual win — without it MCTS doesn't reliably commit to the
  //     sequence because each individual capture looks roughly neutral.
  if (rootState.turn.phase === 'phase2') {
    const enemy: PlayerColor = botColor === 'red' ? 'blue' : 'red';
    const myRush = assessRushModel(rootState, botColor, enemy, mineProb);
    const me = rootState.players.find((p) => p.color === botColor);
    const myLives = me?.lives ?? 3;
    const defusesLeft = rootState.turn.defusesPerTurn - rootState.turn.defusesUsedThisTurn;
    const capturesUsed = rootState.turn.capturedThisTurn.size;
    // We can take at most 3 more captures this phase (5×5 zone enables 3
    // captures chained from existing reachable territory; in practice the
    // engine allows more, but the rush path itself is ≤ 3 cells).
    const capturesLeft = Math.max(0, 3 - capturesUsed);

    const rushFeasible =
      Number.isFinite(myRush.distance)
      && myRush.distance <= capturesLeft
      && myRush.certainMinesOnPath <= defusesLeft
      // Conservative life-budget: each uncertain mine has expected pMine
      // already counted; we can afford to step on at most (lives-1) of them.
      && (myRush.expectedMinesOnPath - myRush.certainMinesOnPath) <= (myLives - 1);

    if (rushFeasible) {
      // Walk the rush path from origin toward HQ; find the first cell on
      // the path that is currently legally capturable/defusable for us.
      // (Cells we already captured earlier this turn are no longer in
      // `path` as defender cells — assessRushModel walks current state.)
      const moveByKey = new Map<string, EngineMove[]>();
      for (const m of rootMoves) {
        if (m.type !== 'capture' && m.type !== 'defuse') continue;
        const k = cellKey(m.row, m.col);
        const arr = moveByKey.get(k) ?? [];
        arr.push(m);
        moveByKey.set(k, arr);
      }
      // The first defender cell in path[] is the closest step to take.
      // Iterate path in order; first cell that has a legal move wins.
      for (const step of myRush.path) {
        const k = cellKey(step.row, step.col);
        const moves = moveByKey.get(k);
        if (!moves || moves.length === 0) continue;
        const p = ded.pMine.get(k) ?? step.pMine;
        // Decide capture vs defuse:
        //   - HQ cell: ALWAYS capture (game ends, mine doesn't matter beyond
        //              the life cost — and if it's certain mine, defuse first).
        //   - Non-HQ certain mine: defuse if we have one, else step on it
        //                          only if we have lives to spare.
        //   - Non-HQ uncertain: capture if p ≤ 0.5, else defuse.
        if (step.isHq) {
          // HQ capture: if pMine ≥ 0.99 AND we have defuse → defuse first.
          if (p >= 0.99 && defusesLeft > 0) {
            const def = moves.find((m) => m.type === 'defuse');
            if (def) return { bestMove: def, simsRun: 0, rootStats: [{ move: def, visits: 1, meanValue: 0 }] };
          }
          const cap = moves.find((m) => m.type === 'capture');
          if (cap) return { bestMove: cap, simsRun: 0, rootStats: [{ move: cap, visits: 1, meanValue: 0 }] };
        } else {
          // Intermediate step. Certain mine → defuse (we already verified
          // certainMinesOnPath ≤ defusesLeft). Else capture if safe-ish.
          if (p >= 0.99) {
            const def = moves.find((m) => m.type === 'defuse');
            if (def) return { bestMove: def, simsRun: 0, rootStats: [{ move: def, visits: 1, meanValue: 0 }] };
            // No defuse available? skip this step and let the next iteration
            // try (shouldn't happen given feasibility check, but defensive).
            continue;
          }
          if (p > 0.5 && defusesLeft > 0) {
            const def = moves.find((m) => m.type === 'defuse');
            if (def) return { bestMove: def, simsRun: 0, rootStats: [{ move: def, visits: 1, meanValue: 0 }] };
          }
          const cap = moves.find((m) => m.type === 'capture');
          if (cap) return { bestMove: cap, simsRun: 0, rootStats: [{ move: cap, visits: 1, meanValue: 0 }] };
        }
      }
    }
  }

  // Forced safe/mine slot. Easy/medium may "miss" the obvious play here.
  // Defensive plays (when threats.distance ≤ 3) are still respected —
  // we don't want the bot to throw the game by skipping HQ defence.
  const forced = pickForcedPhase2Move(rootState, botColor, ded, rootMoves, threats);
  if (forced.move) {
    const isDefensive = forced.reason.startsWith('defensive')
      || forced.reason.startsWith('WIN');
    if (isDefensive || !blunder()) {
      return { bestMove: forced.move, simsRun: 0, rootStats: [{ move: forced.move, visits: 1, meanValue: 0 }] };
    }
  }
  // Pre-MCTS early-end: if a phase already has captures/placements done
  // this turn, give an easy/medium bot a chance to stop voluntarily.
  if (earlyEnd()) {
    if (rootState.turn.phase === 'phase2' && rootMoves.some((m) => m.type === 'end_phase2')) {
      return { bestMove: { type: 'end_phase2' }, simsRun: 0, rootStats: [{ move: { type: 'end_phase2' }, visits: 1, meanValue: 0 }] };
    }
    if (rootState.turn.phase === 'phase3' && rootMoves.some((m) => m.type === 'end_phase3')) {
      return { bestMove: { type: 'end_phase3' }, simsRun: 0, rootStats: [{ move: { type: 'end_phase3' }, visits: 1, meanValue: 0 }] };
    }
  }
  // 6b. Trivial chord-like pattern: catch "number fully accounted for by
  //     flagged + certain mines → any remaining unflagged neighbour is safe"
  //     and the symmetric all-mine variant. This handles the case where the
  //     safe cell is in the display zone but only reachable via chord.
  const trivial = pickTrivialChord(rootState, botColor, ded, rootMoves);
  if (trivial.move && !blunder()) {
    return { bestMove: trivial.move, simsRun: 0, rootStats: [{ move: trivial.move, visits: 1, meanValue: 0 }] };
  }
  if (rootMoves.length === 0) {
    return fallbackHeuristic(obs, config);
  }
  if (rootMoves.length === 1) {
    return { bestMove: rootMoves[0], simsRun: 0, rootStats: [{ move: rootMoves[0], visits: 1, meanValue: 0 }] };
  }

  // 7. Aggressive defuse fallback — when no certain move exists but we
  //    still have defuses left, defuse the highest-pMine candidate in
  //    the action zone. This converts an otherwise-wasted defuse slot
  //    into information gain (and removes a real mine ~30-60% of the time).
  const aggDefuse = pickAggressiveDefuse(rootState, botColor, ded, config, rootMoves);
  if (aggDefuse.move && !blunder()) {
    return { bestMove: aggDefuse.move, simsRun: 0, rootStats: [{ move: aggDefuse.move, visits: 1, meanValue: 0 }] };
  }

  // 7b. GAMBLE-CAPTURE — at this point no certain-safe capture, no certain-
  //     mine defuse, no defensive forced move, and no aggressive defuse
  //     was worth doing. The gamble policy only spends a life on cells
  //     with genuine positional payoff (enemy HQ / on a rush path to it /
  //     adjacent to enemy HQ) AND requires lives ≥ 2. Otherwise it
  //     returns null and we fall through to `end_phase2`.
  if (rootState.turn.phase === 'phase2') {
    const enemy: PlayerColor = botColor === 'red' ? 'blue' : 'red';
    const rushForGamble = assessRushModel(rootState, botColor, enemy, mineProb);
    const gamble = pickGambleCapture(rootState, botColor, ded, rootMoves, rushForGamble.pathCells);
    if (gamble.move) {
      return { bestMove: gamble.move, simsRun: 0, rootStats: [{ move: gamble.move, visits: 1, meanValue: 0 }] };
    }
  }

  // 8. Defensive phase-3 mine placement — if enemy threatens our HQ and
  //    we have a legal placement on the threat path, take it immediately.
  if (rootState.turn.phase === 'phase3') {
    const defMine = pickDefensivePhase3(rootState, threats, rootMoves);
    if (defMine.move) {
      return { bestMove: defMine.move, simsRun: 0, rootStats: [{ move: defMine.move, visits: 1, meanValue: 0 }] };
    }
  }

  // 9. Filter out captures that are too dangerous given current lives. This
  //    is what prevents the bot from stepping on a known mine. We keep the
  //    original list as a fallback if filtering empties phase-2 (the bot
  //    must still be able to end_phase2).
  let candidateMoves = filterUnsafeCaptures(rootState, botColor, config, ded, rootMoves);
  if (candidateMoves.length === 0) candidateMoves = rootMoves;

  // 10. In phase 3, prefer placing all available mines before ending. Drop
  //    `end_phase3` from the candidate set when placements remain.
  if (rootState.turn.phase === 'phase3') {
    if (!shouldEndPhase3(rootState, candidateMoves)) {
      candidateMoves = candidateMoves.filter((m) => m.type !== 'end_phase3');
    }
  }

  const sortedRoot = sortByPrior(rootState, candidateMoves, botColor, mineProb);

  // Phase-1 short-circuit with rush-aware overrides:
  //   1. WIN RUSH — if we have a path of length ≤ 3 to enemy HQ that we can
  //      afford to clear (certain mines + worst-case mines ≤ defuses we
  //      have left), pick a zone whose 5×5 action zone covers the start of
  //      that path. Capturing enemy HQ ends the game in our favour.
  //   2. DEFEND — if the enemy has a path of length ≤ 3 to OUR HQ and they
  //      likely have enough defuses to clear it, pick a zone whose 5×5
  //      action zone covers cells on the threat path (so phase-2 captures
  //      remove the enemy's stepping stones).
  //   3. Otherwise fall back to the border-straddling prior.
  if (rootState.turn.phase === 'phase1') {
    const myRush = assessRushModel(rootState, botColor, botColor === 'red' ? 'blue' : 'red', mineProb);
    const theirRush = assessRushModel(rootState, botColor === 'red' ? 'blue' : 'red', botColor, mineProb);
    const myDefusesLeft = rootState.turn.defusesPerTurn; // turn just started
    const myLives = (rootState.players.find((p) => p.color === botColor)?.lives) ?? 3;

    const canWinRush =
      Number.isFinite(myRush.distance)
      && myRush.distance <= 3
      // We need to clear all certain mines (those cost a defuse each, no
      // negotiation). The "expectedMinesOnPath" already incorporates uncertain
      // ones; we require defuses ≥ certain mines AND total expected mines
      // ≤ defuses + lives_left - 1 (the -1 keeps one life buffer).
      && myRush.certainMinesOnPath <= myDefusesLeft
      && myRush.expectedMinesOnPath <= myDefusesLeft + (myLives - 1);

    // For the enemy's threat we have to ESTIMATE their defuses. We don't
    // know exactly; we assume 1 (the default per-turn allotment from
    // balance.config.json). Mines we placed in setup/phase3 act as a
    // defence. The enemy needs to clear at least the certain ones to
    // survive — if they have 1 defuse and our certain mines on the path
    // are ≥ 2, they almost certainly fail. We trigger DEFEND only when
    // their path is clearable by them: certainMinesOnPath ≤ 1.
    const enemyHasDangerousRush =
      Number.isFinite(theirRush.distance)
      && theirRush.distance <= 3
      && theirRush.certainMinesOnPath <= 1
      && theirRush.expectedMinesOnPath <= 2;

    const pickZoneCoveringPath = (path: Set<string>): EngineMove | null => {
      // For each candidate zone, count how many path cells fall inside its
      // 5×5 action zone (Chebyshev ≤ 2 from the click). Tie-break by
      // proximity to the path's first own-attackable cell.
      let bestMove: EngineMove | null = null;
      let bestScore = -1;
      for (const m of sortedRoot) {
        if (m.type !== 'select_zone') continue;
        let covered = 0;
        for (const k of path) {
          const [rs, cs] = k.split(',');
          const r = +rs, c = +cs;
          if (Math.abs(r - m.row) <= 2 && Math.abs(c - m.col) <= 2) covered++;
        }
        if (covered > bestScore) {
          bestScore = covered;
          bestMove = m;
        }
      }
      return bestScore > 0 ? bestMove : null;
    };

    if (canWinRush) {
      const m = pickZoneCoveringPath(myRush.pathCells);
      if (m) {
        return {
          bestMove: m,
          simsRun: 0,
          rootStats: [{ move: m, visits: 1, meanValue: 0 }],
        };
      }
    }
    if (enemyHasDangerousRush) {
      const m = pickZoneCoveringPath(theirRush.pathCells);
      if (m) {
        return {
          bestMove: m,
          simsRun: 0,
          rootStats: [{ move: m, visits: 1, meanValue: 0 }],
        };
      }
    }

    return {
      bestMove: sortedRoot[0],
      simsRun: 0,
      rootStats: sortedRoot.map((m, i) => ({ move: m, visits: sortedRoot.length - i, meanValue: 0 })),
    };
  }

  // Fast path: easy difficulty / `greedyOnly` skips MCTS entirely. The greedy
  // prior already plays a reasonable game and answers in <60 ms.
  // With non-zero `rootActionTemperature` we sample among the top candidates
  // instead of strictly taking sortedRoot[0] — that's what makes the easy
  // bot pick the 2nd/3rd-best move sometimes (the "honest mistakes" easy
  // is supposed to make).
  if (config.greedyOnly || config.simulationBudget <= 0 || config.maxThinkMs <= 0) {
    const picked = pickWithTemperature(
      sortedRoot.map((m, i) => ({ move: m, score: sortedRoot.length - i })),
      config.rootActionTemperature,
      rand,
    );
    return {
      bestMove: picked,
      simsRun: 0,
      rootStats: sortedRoot.map((m, i) => ({ move: m, visits: sortedRoot.length - i, meanValue: 0 })),
    };
  }

  const root = makeNode(null, null, null, sortedRoot.slice());

  const budget = Math.max(1, config.simulationBudget);
  const phase1Limit = config.phase1TopK;
  const phase3Limit = config.phase3TopK;
  // Phase-3 (mine placement) doesn't benefit from deep MCTS — the priors
  // already capture the relevant signals (just-captured cells, anti-clustering,
  // proximity to HQs). Cap think time aggressively so the bot doesn't stall
  // ~5 seconds per mine placement without quality improvement.
  const phaseThinkMs = rootState.turn.phase === 'phase3'
    ? Math.min(config.maxThinkMs, Math.max(300, Math.floor(config.maxThinkMs * 0.25)))
    : config.maxThinkMs;
  const deadline = (typeof performance !== 'undefined' ? performance.now() : Date.now())
    + Math.max(1, phaseThinkMs);
  let simsRun = 0;

  for (let sim = 0; sim < budget; sim++) {
    // Wall-clock cap: bail out as soon as we hit the deadline so the bot
    // stays responsive even if a single sim is unexpectedly expensive.
    if (((typeof performance !== 'undefined' ? performance.now() : Date.now())) >= deadline) break;
    // Pick a layout (round-robin to keep coverage uniform).
    const layout = layouts[sim % layouts.length].state;
    let state = cloneState(layout);

    // Selection + expansion (single layer for simplicity at root; progressive
    // widening done by capping `untried` length below).
    let node: Node = root;
    let depth = 0;
    const maxTreeDepth = 6;

    while (depth < maxTreeDepth) {
      if (isTerminal(state).finished) break;
      if (node.untried.length > 0) {
        // Expansion: pop next move from priority-ordered untried list.
        const move = node.untried.shift()!;
        const res = applyMove(state, move);
        if (!res.ok) continue;
        state = res.next as EngineState;
        const childMoves = enumerateMoves(state, { useChord: config.useChord });
        let childUntried = sortByPrior(state, childMoves, state.turn.currentPlayer, mineProb);
        childUntried = applyProgressiveWidening(state, childUntried, phase1Limit, phase3Limit);
        const child = makeNode(node, move, node === root ? botColor : state.turn.currentPlayer, childUntried);
        node.children.set(moveKey(move), child);
        node = child;
        break;
      }
      // All expanded — UCT down.
      const next = uctSelect(node, config.uctC, botColor);
      if (!next) break;
      const res = applyMove(state, next.move!);
      if (!res.ok) break;
      state = res.next as EngineState;
      node = next;
      depth++;
    }

    // Rollout from `state`.
    const value = rollout(state, {
      perspective: botColor,
      depth: Math.max(1, config.rolloutDepth),
      rand,
      policy: config.rolloutPolicy,
      temperature: config.rolloutTemperature,
      mineProb,
      useChord: config.useChord,
    });

    // Backprop.
    let cur: Node | null = node;
    while (cur) {
      cur.visits++;
      cur.totalValue += value;
      cur = cur.parent;
    }
    simsRun++;
  }

  // 4. Robust child: most visited at the root.
  const stats: Array<{ move: EngineMove; visits: number; meanValue: number }> = [];
  let best: { move: EngineMove; visits: number; meanValue: number } | null = null;
  for (const child of root.children.values()) {
    const meanValue = child.visits > 0 ? child.totalValue / child.visits : 0;
    const item = { move: child.move!, visits: child.visits, meanValue };
    stats.push(item);
    if (!best || child.visits > best.visits ||
        (child.visits === best.visits && meanValue > best.meanValue)) {
      best = item;
    }
  }

  if (!best) {
    // No expansion happened — pick prior-best.
    return { bestMove: sortedRoot[0], simsRun, rootStats: [] };
  }

  // Root-action temperature: when > 0 we softmax-sample the root child by
  // visit count instead of argmax. Used to inject controlled imperfection
  // into easier difficulty tiers ("honest mistakes" — bot still chooses a
  // sensible move, just not always THE optimal one).
  if (config.rootActionTemperature > 0 && stats.length > 1) {
    const sampled = pickWithTemperature(
      stats.map((s) => ({ move: s.move, score: s.visits })),
      config.rootActionTemperature,
      rand,
    );
    return { bestMove: sampled, simsRun, rootStats: stats };
  }
  return { bestMove: best.move, simsRun, rootStats: stats };
}

/**
 * Softmax-sample a move from candidates by score.
 *   - temperature ≤ 0 → strict argmax (highest score wins).
 *   - temperature > 0 → probabilities ∝ exp(score / (max * temperature)).
 *     Higher temperature flattens the distribution and lets the bot pick
 *     non-optimal moves more often (controlled error rate). At temp=1 the
 *     top move stays clearly preferred but the runner-up has a real chance.
 */
function pickWithTemperature(
  candidates: Array<{ move: EngineMove; score: number }>,
  temperature: number,
  rand: () => number,
): EngineMove {
  if (candidates.length === 0) throw new Error('pickWithTemperature: no candidates');
  if (candidates.length === 1 || temperature <= 0) {
    let best = candidates[0];
    for (const c of candidates) if (c.score > best.score) best = c;
    return best.move;
  }
  let maxScore = -Infinity;
  for (const c of candidates) if (c.score > maxScore) maxScore = c.score;
  const denom = Math.max(1e-6, Math.abs(maxScore) * temperature);
  let total = 0;
  const weights: number[] = [];
  for (const c of candidates) {
    const w = Math.exp((c.score - maxScore) / denom);
    weights.push(w);
    total += w;
  }
  let r = rand() * total;
  for (let i = 0; i < candidates.length; i++) {
    r -= weights[i];
    if (r <= 0) return candidates[i].move;
  }
  return candidates[candidates.length - 1].move;
}

function uctSelect(node: Node, c: number, botColor: PlayerColor): Node | null {
  let best: Node | null = null;
  let bestScore = -Infinity;
  const lnN = Math.log(Math.max(1, node.visits));
  for (const child of node.children.values()) {
    if (child.visits === 0) return child;
    const mean = child.totalValue / child.visits;
    // Flip sign for opponent layers (we want opponent to minimize root value).
    const orientedMean = child.actor === botColor ? mean : -mean;
    const exploration = c * Math.sqrt(lnN / child.visits);
    const score = orientedMean + exploration;
    if (score > bestScore) { bestScore = score; best = child; }
  }
  return best;
}

function sortByPrior(
  state: EngineState,
  moves: EngineMove[],
  actor: PlayerColor,
  mineProb: Map<string, number>,
): EngineMove[] {
  return moves
    .map((m) => ({ m, s: scoreMove(state, m, actor, mineProb) }))
    .sort((a, b) => b.s - a.s)
    .map((x) => x.m);
}

function applyProgressiveWidening(
  state: EngineState,
  moves: EngineMove[],
  phase1Limit: number,
  phase3Limit: number,
): EngineMove[] {
  if (state.turn.phase === 'phase1') return moves.slice(0, Math.max(1, phase1Limit));
  if (state.turn.phase === 'phase3') {
    const placements = moves.filter((m) => m.type === 'place_mine_phase3').slice(0, Math.max(1, phase3Limit));
    const end = moves.filter((m) => m.type === 'end_phase3');
    return [...placements, ...end];
  }
  return moves;
}

/** When MCTS can't run (no layouts / no moves), pick the greedy prior move. */
function fallbackHeuristic(obs: BotObservation, config: BotConfig): MctsResult {
  // Build a synthetic state from observation (no enemy mines).
  const board = obs.board.map((row) => row.map((cell) => ({ ...cell })));
  const synth: EngineState = {
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
  const moves = enumerateMoves(synth, { useChord: config.useChord });
  if (moves.length === 0) {
    // Truly stuck — emit end_phase2/3 as best-effort.
    if (synth.turn.phase === 'phase2') return { bestMove: { type: 'end_phase2' }, simsRun: 0, rootStats: [] };
    if (synth.turn.phase === 'phase3') return { bestMove: { type: 'end_phase3' }, simsRun: 0, rootStats: [] };
    if (synth.turn.phase === 'setup')  return { bestMove: { type: 'confirm_setup' }, simsRun: 0, rootStats: [] };
    return { bestMove: { type: 'end_phase2' }, simsRun: 0, rootStats: [] };
  }
  const sorted = sortByPrior(synth, moves, obs.botColor, new Map());
  return { bestMove: sorted[0], simsRun: 0, rootStats: [] };
}
