/**
 * Difficulty presets for the AI bot.
 *
 * The exact numbers come from plans/ai-bot/04-difficulty-levels.md. Tuning
 * dial is `simulationBudget` (linear in cost). All three levels share the
 * same engine; only these knobs change.
 *
 * NOTE on the MVP cut: we run MCTS on the main thread (via a worker — see
 * `bot-worker.ts`). To keep response times reasonable on mid-range laptops,
 * the initial budgets are intentionally moderate. They can be raised later
 * without changing any public API.
 */

import type { BotConfig, Difficulty } from './types';

// Budgets are wall-clock first. `simulationBudget` is a generous upper bound;
// the search will stop early at `maxThinkMs` so the UI never freezes. Numbers
// reflect measured cost on a 12×12 board where every micro-step does a full
// `cloneState` + `enumerateMoves` + leaf eval (~0.2-0.5 ms each).
export const DIFFICULTY_PRESETS: Record<Difficulty, BotConfig> = {
  // ┌──────────────────────────────────────────────────────────────────────┐
  // │ Difficulty rebalance:                                                │
  // │   easy   ≈ previous "normal" — light MCTS, subset deduction.         │
  // │   normal ≈ previous "hard"   — full deduction, ~1s think, strong.    │
  // │   hard   = new maximum       — full search up to 5s per move.        │
  // └──────────────────────────────────────────────────────────────────────┘
  easy: {
    simulationBudget: 400,
    maxThinkMs: 300,
    deductionLevel: 'subset',
    layoutSamples: 4,
    rolloutDepth: 3,
    uctC: 1.2,
    phase1TopK: 6,
    phase3TopK: 5,
    rolloutPolicy: 'weightedRandom',
    rolloutTemperature: 0.4,
    opponentModel: 'mirror',
    rootActionTemperature: 0.2,
    dangerThresholdCapture: 0.30,
    dangerThresholdDefuse: 0.50,
    useChord: true,
    assumeOpponentMaxesMines: true,
    setupHeuristicNoise: 0.3,
  },
  normal: {
    // Думает «верхнеуровнево» — минимальный бюджет, почти без раздумий.
    // Это самый быстрый из трёх уровней по времени хода.
    simulationBudget: 750,
    maxThinkMs: 500,
    deductionLevel: 'full',
    layoutSamples: 8,
    rolloutDepth: 4,
    uctC: 0.9,
    phase1TopK: 10,
    phase3TopK: 8,
    rolloutPolicy: 'greedyWithJitter',
    rolloutTemperature: 0.15,
    opponentModel: 'strong',
    rootActionTemperature: 0.0,
    dangerThresholdCapture: 0.20,
    dangerThresholdDefuse: 0.40,
    useChord: true,
    assumeOpponentMaxesMines: true,
    setupHeuristicNoise: 0.1,
  },
  hard: {
    // Maximum-strength preset: same well-tested parameters as the previous
    // "hard" config (which worked correctly), but with budgets raised so
    // the bot can think up to 5 seconds per move. We deliberately did NOT
    // crank topK/rolloutDepth/dangerThreshold further — those tighter
    // numbers caused regressions (bot ignored HQ threats and wandered to
    // the opposite side of the board because no capture was legal under
    // the strict threshold and rollouts became too noisy).
    // Время раздумий как у прежнего «среднего» — секунда максимум.
    simulationBudget: 1500,
    maxThinkMs: 1000,
    deductionLevel: 'full',
    layoutSamples: 8,
    rolloutDepth: 4,
    uctC: 0.9,
    phase1TopK: 10,
    phase3TopK: 8,
    rolloutPolicy: 'greedyWithJitter',
    rolloutTemperature: 0.15,
    opponentModel: 'strong',
    rootActionTemperature: 0.0,
    dangerThresholdCapture: 0.20,
    dangerThresholdDefuse: 0.40,
    useChord: true,
    assumeOpponentMaxesMines: true,
    setupHeuristicNoise: 0.05,
  },
};

export const DIFFICULTY_LABELS: Record<Difficulty, string> = {
  easy: '🟢 Лёгкий',
  normal: '🟡 Средний',
  hard: '🔴 Сложный',
};

/** Per-action display pacing (ms) added on top of worker compute time, so the
 *  human can follow the bot's moves visually. From plans/ai-bot/06-integration.md. */
export const BOT_PACING_MS = {
  select_zone:       700,
  capture_safe:      350,
  capture_mine:      600,
  defuse:            800,
  chord:             500,
  place_mine_phase3: 250,
  end_phase2:        400,
  end_phase3:        400,
  place_mine_setup:  150,
  confirm_setup:     400,
  toggle_mark:       0,
} as const;
