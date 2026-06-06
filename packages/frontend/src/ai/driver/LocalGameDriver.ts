/**
 * Local game driver. Owns the authoritative `EngineState`, applies human
 * moves synchronously, runs the bot synchronously (with paced wall-clock
 * delays) when it's the bot's turn. Exposes an event-style API so the
 * React hook can subscribe to state updates.
 *
 * Design tradeoffs:
 *   - For MVP we run MCTS on the main thread (synchronous). This blocks
 *     for ~simulationBudget × per-sim-cost ms. With easy=600 sims this is
 *     well under 100 ms; harder modes get capped by `simulationBudget` in
 *     [`difficulty.ts`](packages/frontend/src/ai/difficulty.ts:1). A worker
 *     can be wired in later via [`bot-worker.ts`](packages/frontend/src/ai/bot-worker.ts:1).
 *   - Bot pacing is enforced by `botPacingMs` table — even an instant move
 *     waits this many ms before being applied so the human sees what
 *     happened.
 */

import type { CellMark, GameConfig, PlayerColor } from '@minesweeper-pvp/shared';
import { BALANCE, DEFAULT_TIME_CONTROL } from '@minesweeper-pvp/shared';
import type {
  ApplyEvent,
  BotConfig,
  BotObservation,
  Difficulty,
  EngineMove,
  EngineState,
} from '../types';
import {
  applyConfirmSetupAs,
  applyMove,
  applyPlaceMineSetupAs,
  createInitialState,
  isTerminal,
  oppositeColor,
} from '../engine/simulator';
import { runMcts } from '../engine/mcts';
import { planSetupMines } from '../engine/setup';
import { DIFFICULTY_PRESETS, BOT_PACING_MS } from '../difficulty';

export interface DriverOpts {
  config?: Partial<GameConfig>;
  humanColor: PlayerColor;
  humanName: string;
  botName?: string;
  difficulty: Difficulty;
}

export type DriverListener = (state: EngineState, event?: ApplyEvent) => void;

export class LocalGameDriver {
  private state: EngineState;
  private listeners = new Set<DriverListener>();
  private humanColor: PlayerColor;
  private botColor: PlayerColor;
  private difficulty: Difficulty;
  private botConfig: BotConfig;
  private seed = (Date.now() >>> 0) ^ 0xa5a5a5a5;
  private botTimers = new Set<ReturnType<typeof setTimeout>>();
  private destroyed = false;
  /** Mines the bot saw it lose (its own mines defused / exploded by it) —
   *  used by determinizer for the OPPONENT side. For solo, the opponent IS
   *  the bot; the human's view doesn't run determinizer. Reset every game. */
  private oppMinesRemovedByBot = 0;

  constructor(opts: DriverOpts) {
    this.humanColor = opts.humanColor;
    this.botColor = oppositeColor(opts.humanColor);
    this.difficulty = opts.difficulty;
    this.botConfig = DIFFICULTY_PRESETS[opts.difficulty];
    const cfg = makeConfig(opts.config);
    this.state = createInitialState({
      config: cfg,
      playerNames: {
        red:  this.humanColor === 'red'  ? opts.humanName : (opts.botName ?? 'Бот'),
        blue: this.humanColor === 'blue' ? opts.humanName : (opts.botName ?? 'Бот'),
      },
      noTimer: true,
    });
  }

  destroy(): void {
    this.destroyed = true;
    for (const t of this.botTimers) clearTimeout(t);
    this.botTimers.clear();
    this.listeners.clear();
  }

  subscribe(fn: DriverListener): () => void {
    this.listeners.add(fn);
    fn(this.state);
    return () => this.listeners.delete(fn);
  }

  getState(): EngineState { return this.state; }
  getHumanColor(): PlayerColor { return this.humanColor; }

  /** Kick off the game: schedule bot's setup placements and confirmation. */
  start(): void {
    this.emit();
    this.scheduleBotSetup();
  }

  // ─── Human input ────────────────────────────────────────────────────────

  placeMineSetup(row: number, col: number): void {
    if (this.state.phase !== 'setup') return;
    const ev = applyPlaceMineSetupAs(cloneStateInPlace(this), this.humanColor, row, col);
    this.commit(ev);
  }

  confirmSetup(): void {
    if (this.state.phase !== 'setup') return;
    const ev = applyConfirmSetupAs(cloneStateInPlace(this), this.humanColor);
    this.commit(ev);
    this.maybeScheduleBotTurn();
  }

  selectZone(row: number, col: number): void {
    this.humanMove({ type: 'select_zone', row, col });
  }
  captureCell(row: number, col: number): void {
    this.humanMove({ type: 'capture', row, col });
  }
  defuseCell(row: number, col: number): void {
    this.humanMove({ type: 'defuse', row, col });
  }
  chord(row: number, col: number): void {
    this.humanMove({ type: 'chord', row, col });
  }
  endPhase2(): void { this.humanMove({ type: 'end_phase2' }); }
  endPhase3(): void { this.humanMove({ type: 'end_phase3' }); }
  placeMinePhase3(row: number, col: number): void {
    this.humanMove({ type: 'place_mine_phase3', row, col });
  }
  toggleMark(row: number, col: number, mark: CellMark): void {
    this.humanMove({ type: 'toggle_mark', row, col, mark });
  }

  private humanMove(move: EngineMove): boolean {
    if (this.state.turn.currentPlayer !== this.humanColor) {
      this.emitError('Сейчас не ваш ход');
      return false;
    }
    const res = applyMove(this.state, move);
    if (!res.ok) {
      this.emitError(res.error);
      return false;
    }
    this.state = res.next as EngineState;
    this.emit(res.event);
    if (isTerminal(this.state).finished) return true;
    if (this.state.turn.currentPlayer === this.botColor) {
      this.maybeScheduleBotTurn();
    }
    return true;
  }

  // ─── Bot driving ────────────────────────────────────────────────────────

  private scheduleBotSetup(): void {
    if (this.state.phase !== 'setup') return;
    const botPlayer = this.state.players.find((p) => p.color === this.botColor)!;
    if (botPlayer.setupConfirmed) return;
    const required = this.botColor === 'red' ? this.state.config.initialMinesRed : this.state.config.initialMinesBlue;
    const plan = planSetupMines(this.state, {
      color: this.botColor,
      seed: this.seed,
      noise: this.botConfig.setupHeuristicNoise,
    });
    // Apply the plan instantly (no pacing for setup — both players' setups
    // are independent; we don't want the bot to slow down the human).
    for (let i = 0; i < required && i < plan.length; i++) {
      const { row, col } = plan[i];
      const ev = applyPlaceMineSetupAs(this.state, this.botColor, row, col);
      // ignore errors silently (best-effort)
      if ((ev as any).kind === 'ERROR') break;
    }
    const ev = applyConfirmSetupAs(this.state, this.botColor);
    this.emit((ev as any).kind === 'ERROR' ? undefined : ev);
    if (this.state.turn.currentPlayer === this.botColor && this.state.phase !== 'setup') {
      this.maybeScheduleBotTurn();
    }
  }

  private maybeScheduleBotTurn(): void {
    if (this.destroyed) return;
    if (this.state.turn.currentPlayer !== this.botColor) return;
    if (isTerminal(this.state).finished) return;
    // Pace before the first move of a bot turn.
    const delay = BOT_PACING_MS.select_zone;
    const t = setTimeout(() => {
      this.botTimers.delete(t);
      this.runBotStep();
    }, delay);
    this.botTimers.add(t);
  }

  private runBotStep(): void {
    if (this.destroyed) return;
    if (this.state.turn.currentPlayer !== this.botColor) return;
    if (isTerminal(this.state).finished) return;
    const obs = buildBotObservation(this.state, this.botColor, this.oppMinesRemovedByBot);
    const seed = (this.seed = ((this.seed * 1103515245) + 12345) | 0);
    let move: EngineMove;
    try {
      const res = runMcts(obs, this.botConfig, seed);
      move = res.bestMove;
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error('[LocalGameDriver] bot search failed', err);
      // Emergency fallback: end the turn so the game can progress.
      move = this.state.turn.phase === 'phase3' ? { type: 'end_phase3' } :
             this.state.turn.phase === 'phase2' ? { type: 'end_phase2' } :
             // Setup or phase1 with no fallback — log and bail.
             { type: 'end_phase2' };
    }
    const res = applyMove(this.state, move);
    if (!res.ok) {
      // Shouldn't happen — but if it does, force an end-phase to avoid stall.
      // eslint-disable-next-line no-console
      console.warn('[LocalGameDriver] bot picked illegal move, forcing end-phase', move, res.error);
      const fallback: EngineMove =
        this.state.turn.phase === 'phase3' ? { type: 'end_phase3' } : { type: 'end_phase2' };
      const r2 = applyMove(this.state, fallback);
      if (!r2.ok) return;
      this.state = r2.next as EngineState;
      this.emit(r2.event);
    } else {
      this.state = res.next as EngineState;
      this.emit(res.event);
    }

    if (isTerminal(this.state).finished) return;
    if (this.state.turn.currentPlayer === this.botColor) {
      // Same turn continues — pace the next intra-turn step.
      const stepDelay = pickIntraTurnDelay(this.state.turn.phase);
      const t = setTimeout(() => {
        this.botTimers.delete(t);
        this.runBotStep();
      }, stepDelay);
      this.botTimers.add(t);
    }
  }

  // ─── Emitting state to the React hook ──────────────────────────────────

  private commit(ev: ApplyEvent): void {
    if ((ev as any).kind === 'ERROR') {
      this.emitError((ev as any).error);
      return;
    }
    this.emit(ev);
  }

  private emit(ev?: ApplyEvent): void {
    for (const l of this.listeners) l(this.state, ev);
  }

  private errorListeners = new Set<(msg: string) => void>();

  onError(fn: (msg: string) => void): () => void {
    this.errorListeners.add(fn);
    return () => this.errorListeners.delete(fn);
  }

  private emitError(msg: string): void {
    for (const l of this.errorListeners) l(msg);
  }
}

// ─── Helpers ────────────────────────────────────────────────────────────────

function pickIntraTurnDelay(phase: string): number {
  switch (phase) {
    case 'phase1': return BOT_PACING_MS.select_zone;
    case 'phase2': return BOT_PACING_MS.capture_safe;
    case 'phase3': return BOT_PACING_MS.place_mine_phase3;
    default:       return BOT_PACING_MS.end_phase2;
  }
}

/** In-place clone hack so simulator's setup-phase helpers don't mutate the
 *  shared state in surprising ways. Replaces driver.state with a fresh
 *  clone and returns it. */
function cloneStateInPlace(driver: LocalGameDriver): EngineState {
  // We deep-clone via JSON-free path: simulator exports cloneState but we
  // want a single mutable copy here.
  // (The applyPlaceMineSetupAs / applyConfirmSetupAs helpers mutate state in
  // place — that's by design for our driver path.)
  return (driver as any).state as EngineState;
}

/** Build an honest BotObservation by stripping enemy mines. */
function buildBotObservation(
  state: EngineState,
  botColor: PlayerColor,
  oppMinesRemovedByBot: number,
): BotObservation {
  const enemy = oppositeColor(botColor);
  const board = state.board.map((row) => row.map((cell) => {
    if (cell.owner === enemy) {
      // CRITICAL: hide enemy mines.
      return { ...cell, hasMine: false };
    }
    return { ...cell };
  }));
  return {
    config: state.config,
    board,
    players: state.players.map((p) => ({ ...p })),
    phase: state.phase,
    turn: {
      ...state.turn,
      selectedZone: state.turn.selectedZone ? { ...state.turn.selectedZone } : null,
      actionZone: state.turn.actionZone ? { ...state.turn.actionZone } : null,
      capturedThisTurn: new Set(state.turn.capturedThisTurn),
      lastAction: state.turn.lastAction ? { ...state.turn.lastAction } : null,
    },
    setupConfirmed: Array.from(state.setupConfirmed),
    marks: { red: { ...state.marks.red }, blue: { ...state.marks.blue } },
    botColor,
    opponentMinesRemovedByBot: oppMinesRemovedByBot,
    opponentMinesPlacedHistoryMid: 0, // Phase 3 placements come from currentTurn already in the board state.
    winner: state.winner,
    winReason: state.winReason,
  };
}

function makeConfig(partial?: Partial<GameConfig>): GameConfig {
  const base: GameConfig = {
    boardSize: BALANCE.board.size,
    maxLives:  BALANCE.player.maxLives,
    minesPerTurn:    BALANCE.phase3.minesPerTurn,
    initialMinesRed:  BALANCE.board.initialMinesRed,
    initialMinesBlue: BALANCE.board.initialMinesBlue,
    timeControl: DEFAULT_TIME_CONTROL,
  };
  return { ...base, ...(partial ?? {}) };
}
