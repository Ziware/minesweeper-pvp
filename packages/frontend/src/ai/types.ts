/**
 * Public types used across the AI bot module.
 *
 * The simulator (engine/simulator.ts) is the single source of truth for game
 * rules. Move shapes here match the action space described in
 * plans/ai-bot/01-game-model.md. The simulator's [`EngineState`](packages/frontend/src/ai/engine/simulator.ts:1)
 * is the canonical state object; types here are the *interface* of the engine
 * (moves, observations, results).
 */

import type {
  CellState,
  GameConfig,
  GamePhase,
  LastAction,
  PlayerColor,
  CellMark,
} from '@minesweeper-pvp/shared';

// ─── Moves ───────────────────────────────────────────────────────────────────

export type EngineMove =
  | { type: 'place_mine_setup'; row: number; col: number }
  | { type: 'confirm_setup' }
  | { type: 'select_zone'; row: number; col: number }
  | { type: 'capture'; row: number; col: number }
  | { type: 'defuse'; row: number; col: number }
  | { type: 'chord'; row: number; col: number }
  | { type: 'toggle_mark'; row: number; col: number; mark: CellMark }
  | { type: 'end_phase2' }
  | { type: 'place_mine_phase3'; row: number; col: number }
  | { type: 'end_phase3' };

/** Stable string key for a move — used as map key in MCTS children. */
export function moveKey(move: EngineMove): string {
  switch (move.type) {
    case 'place_mine_setup':  return `pms:${move.row},${move.col}`;
    case 'confirm_setup':     return 'confirmSetup';
    case 'select_zone':       return `sz:${move.row},${move.col}`;
    case 'capture':           return `cap:${move.row},${move.col}`;
    case 'defuse':            return `def:${move.row},${move.col}`;
    case 'chord':             return `chord:${move.row},${move.col}`;
    case 'toggle_mark':       return `tm:${move.row},${move.col}:${move.mark}`;
    case 'end_phase2':        return 'endP2';
    case 'place_mine_phase3': return `pmp3:${move.row},${move.col}`;
    case 'end_phase3':        return 'endP3';
  }
}

// ─── Apply result ────────────────────────────────────────────────────────────

export type WinReason = 'lives' | 'headquarters' | 'time';

export type ApplyResult =
  | { ok: true; next: EngineStateLike; event?: ApplyEvent }
  | { ok: false; error: string };

/** Side-effect event emitted by applyMove — used by the driver to trigger
 *  sounds / animations on the visible state. */
export type ApplyEvent =
  | { kind: 'capture'; row: number; col: number; actor: PlayerColor }
  | { kind: 'mine_exploded'; row: number; col: number; actor: PlayerColor }
  | { kind: 'defuse_success'; row: number; col: number; actor: PlayerColor }
  | { kind: 'defuse_no_mine'; row: number; col: number; actor: PlayerColor }
  | { kind: 'zone_selected'; row: number; col: number; actor: PlayerColor }
  | { kind: 'mine_placed_phase3'; row: number; col: number; actor: PlayerColor }
  | { kind: 'end_phase2'; actor: PlayerColor }
  | { kind: 'end_phase3'; actor: PlayerColor }
  | { kind: 'mark_toggled'; row: number; col: number; actor: PlayerColor }
  | { kind: 'setup_mine_toggled'; row: number; col: number; actor: PlayerColor }
  | { kind: 'setup_confirmed'; actor: PlayerColor }
  | { kind: 'game_started' }
  | { kind: 'turn_swapped'; nextPlayer: PlayerColor }
  | { kind: 'game_over'; winner: PlayerColor; reason: WinReason };

// We keep this loose to avoid a cyclic import with simulator.ts.
// engine/simulator.ts exports the concrete `EngineState` and re-exports
// the alias so consumers can `import { EngineState } from './types'` if needed.
export type EngineStateLike = unknown;

// ─── Engine state (the canonical authoritative game state) ───────────────────
//
// The concrete shape lives next to the simulator in engine/simulator.ts so the
// per-cell layout (mutable arrays) is co-located with the code that operates
// on them. We re-export the type from there. Importers prefer the concrete
// alias when they need property access.

export interface EnginePlayer {
  color: PlayerColor;
  name: string;
  lives: number;
  minesPlaced: number;
  setupConfirmed: boolean;
  /** Always Number.POSITIVE_INFINITY in solo mode. */
  timeMs: number;
}

export interface EngineTurn {
  phase: GamePhase;
  currentPlayer: PlayerColor;
  selectedZone: { row: number; col: number } | null;
  actionZone: { row: number; col: number } | null;
  canDefuse: boolean;
  minesPlacedThisTurn: number;
  minesAllowedThisTurn: number;
  /** Plain array of "r,c" strings. We keep it as a Set internally and project
   *  to array when emitting client state. */
  capturedThisTurn: Set<string>;
  lastAction: LastAction | null;
  turnsPlayed: number;
  defusesPerTurn: number;
  defusesUsedThisTurn: number;
  currentTurnStartedAtMs: number | null;
  serverNowMs: number;
}

/** Player → ("r,c" → mark) map mirroring backend's room.marks. */
export type EngineMarks = Record<PlayerColor, Record<string, CellMark>>;

export interface EngineState {
  config: GameConfig;
  board: CellState[][];
  players: EnginePlayer[];
  /** Mirrors `room.phase` — synced with turn.phase for non-setup phases. */
  phase: GamePhase;
  turn: EngineTurn;
  /** Set of colours that have confirmed setup. */
  setupConfirmed: Set<PlayerColor>;
  marks: EngineMarks;
  winner: PlayerColor | null;
  winReason: WinReason | null;
}

// ─── Bot configuration & observation ─────────────────────────────────────────

export type Difficulty = 'easy' | 'normal' | 'hard';

export interface BotConfig {
  /** Hard cap on simulations (per move). */
  simulationBudget: number;
  /** Wall-clock cap (ms) on MCTS search. Whichever of `simulationBudget` /
   *  `maxThinkMs` is reached first stops the loop. Keeps the UI responsive
   *  even if a single sim is unexpectedly expensive. */
  maxThinkMs: number;
  /** When true, skip MCTS entirely and pick the greedy prior move. Used by
   *  the `easy` preset for instant response. */
  greedyOnly?: boolean;
  /** Strength of constraint-propagation deduction. `trivial` = only the
   *  "all unknowns are mines" / "no unknowns are mines" rule; `subset` adds
   *  pairwise subset inference (covers 1-2-1 etc.); `full` adds brute-force
   *  enumeration of small frontier components (exact per-cell probabilities). */
  deductionLevel: 'trivial' | 'subset' | 'full';
  /** Distinct determinizations drawn at the start of a search. */
  layoutSamples: number;
  /** Truncation depth in *turns* (full turn = both players acted once). */
  rolloutDepth: number;
  /** UCT exploration constant. */
  uctC: number;
  /** Candidate cap for phase-1 zone centers. */
  phase1TopK: number;
  /** Candidate cap for phase-3 mine placements. */
  phase3TopK: number;
  rolloutPolicy: 'weightedRandom' | 'greedyWithJitter';
  rolloutTemperature: number;
  opponentModel: 'weak' | 'mirror' | 'strong';
  rootActionTemperature: number;
  dangerThresholdCapture: number;
  dangerThresholdDefuse: number;
  useChord: boolean;
  assumeOpponentMaxesMines: boolean;
  setupHeuristicNoise: number;
  /**
   * Probability ∈ [0, 1] that the bot WILL SKIP each "forced move" policy
   * slot (forced safe capture / forced mine defuse / trivial-chord pattern
   * / aggressive defuse / gamble). Used to inject deliberate human-like
   * mistakes into easier difficulties: a roll succeeds → policy slot is
   * NOT consulted on this step → fall-through to weaker MCTS / prior.
   * Hard sets this to 0 (never blunders). Default 0 when omitted.
   */
  blunderRate?: number;
  /**
   * Probability ∈ [0, 1] of voluntarily ending phase 2 / phase 3 BEFORE
   * the bot has exhausted its safe / useful moves. Simulates "human
   * decided not to push further this turn". Hard sets this to 0
   * (never gives up early). Default 0 when omitted.
   */
  earlyEndPhaseRate?: number;
}

/** Observation = what the bot legitimately knows. The driver builds this by
 *  stripping the opponent's `hasMine` from the full EngineState. */
export interface BotObservation {
  config: GameConfig;
  /** Same shape as EngineState.board but enemy `hasMine` is replaced with
   *  `false` placeholder; presence/absence is reconstructed by determinize().
   *  The bot MUST not consult this field for enemy cells — it would be cheating. */
  board: CellState[][];
  players: EnginePlayer[];
  phase: GamePhase;
  turn: EngineTurn;
  setupConfirmed: PlayerColor[];
  marks: EngineMarks;
  /** Which colour the bot plays. */
  botColor: PlayerColor;
  /** Mine count the bot has personally observed *removed* from the opponent's
   *  pool (exploded-on / defused-with-mine). Used to estimate remaining
   *  opponent mines. */
  opponentMinesRemovedByBot: number;
  /** Cumulative count of opponent mines the bot saw the opponent place during
   *  phase 3 of opponent turns — actually this is hidden, so the determinizer
   *  draws it as a random variable. We carry the running budget midpoint here. */
  opponentMinesPlacedHistoryMid: number;
  winner: PlayerColor | null;
  winReason: WinReason | null;
}

export interface BotRequest {
  obs: BotObservation;
  config: BotConfig;
  seed: number;
}

export interface BotResponse {
  move: EngineMove;
  elapsedMs: number;
  simsRun: number;
}
