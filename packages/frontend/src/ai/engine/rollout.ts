/**
 * Rollout policy: from a leaf state, simulate forward up to N turns and
 * return a leaf evaluation. See
 * [`plans/ai-bot/03-mcts-core.md`](plans/ai-bot/03-mcts-core.md:82) and
 * [`plans/ai-bot/05-heuristics.md`](plans/ai-bot/05-heuristics.md:115).
 *
 * Two policies:
 *   - `weightedRandom`: sample moves with probability ∝ exp(score / T).
 *   - `greedyWithJitter`: argmax + small ε-greedy randomization.
 */

import type { PlayerColor } from '@minesweeper-pvp/shared';
import type { BotConfig, EngineMove, EngineState } from '../types';
import { applyMove, isTerminal } from './simulator';
import { enumerateMoves } from './actions';
import { evaluate, scoreMove } from './eval';

export interface RolloutOpts {
  perspective: PlayerColor;
  /** Max full turns (both players act once) to simulate. */
  depth: number;
  rand: () => number;
  policy: 'weightedRandom' | 'greedyWithJitter';
  temperature: number;
  mineProb?: Map<string, number>;
  useChord: boolean;
}

/** Run a rollout from `state` and return value in [-1, +1] for perspective. */
export function rollout(state: EngineState, opts: RolloutOpts): number {
  let cur = state;
  let lastPlayer: PlayerColor | null = null;
  let fullTurnsSoFar = 0;
  // Hard cap on micro-steps. Each micro-step does a full cloneState +
  // enumerateMoves, so capping this is the single biggest perf knob.
  // `depth` counts *full turns* (red+blue); a typical phase2→phase3→end
  // sequence is ~6 micro-steps per turn, so 8·depth + 6 covers normal play
  // with headroom while still capping pathological cases at ~40 steps.
  const maxMicroSteps = Math.min(40, opts.depth * 8 + 6);

  for (let step = 0; step < maxMicroSteps; step++) {
    const terminal = isTerminal(cur);
    if (terminal.finished) break;
    const moves = enumerateMoves(cur, { useChord: opts.useChord });
    if (moves.length === 0) break;

    const move = pickMove(cur, moves, opts);
    const res = applyMove(cur, move);
    if (!res.ok) {
      // Should not happen — actions are enumerated to be legal. Bail out.
      break;
    }
    cur = res.next as EngineState;

    // Count full turns: a "full turn" is currentPlayer change red→blue→red.
    const player = cur.turn.currentPlayer;
    if (lastPlayer && lastPlayer !== player) {
      fullTurnsSoFar++;
      if (fullTurnsSoFar >= opts.depth) break;
    }
    lastPlayer = player;
  }

  return evaluate(cur, opts.perspective);
}

function pickMove(state: EngineState, moves: EngineMove[], opts: RolloutOpts): EngineMove {
  const color = state.turn.currentPlayer;
  if (opts.policy === 'greedyWithJitter') {
    let bestScore = -Infinity;
    let best: EngineMove = moves[0];
    for (const m of moves) {
      const s = scoreMove(state, m, color, opts.mineProb);
      if (s > bestScore) { bestScore = s; best = m; }
    }
    // ε-greedy jitter
    if (opts.rand() < 0.15) {
      return moves[Math.floor(opts.rand() * moves.length)];
    }
    return best;
  }
  // weightedRandom: softmax
  const T = Math.max(0.01, opts.temperature);
  const scores = moves.map((m) => scoreMove(state, m, color, opts.mineProb) / T);
  let maxS = -Infinity;
  for (const s of scores) if (s > maxS) maxS = s;
  let total = 0;
  const weights = scores.map((s) => {
    const w = Math.exp(s - maxS);
    total += w;
    return w;
  });
  let pick = opts.rand() * total;
  for (let i = 0; i < moves.length; i++) {
    pick -= weights[i];
    if (pick <= 0) return moves[i];
  }
  return moves[moves.length - 1];
}
