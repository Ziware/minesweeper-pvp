/**
 * useBotPlayer — runs bot AI in response to 'botTurn' socket events.
 *
 * When `isBotGame` is true, this hook:
 *  - Listens for 'botTurn' events on the socket
 *  - Setup phase: places mines via planSetupMines, then confirms
 *  - Game phase: runs MCTS through bot-worker.ts and emits the result
 *  - Applies visual pacing delays so the human can follow the bot's moves
 */
import { useEffect, useRef } from 'react';
import type { MutableRefObject } from 'react';
import type { Socket } from 'socket.io-client';
import type {
  BotTurnSnapshot,
  BotMovePayload,
  PlayerColor,
  ClientToServerEvents,
  ServerToClientEvents,
} from '@minesweeper-pvp/shared';
import type {
  BotObservation,
  BotRequest,
  BotResponse,
  EngineMove,
  EngineState,
} from '../ai/types';
import { planSetupMines } from '../ai/engine/setup';
import { DIFFICULTY_PRESETS, BOT_PACING_MS } from '../ai/difficulty';

type AppSocket = Socket<ServerToClientEvents, ClientToServerEvents>;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Convert BotTurnSnapshot (server format) into an EngineState (AI engine format).
 * Reconstructs Sets from arrays, adds empty marks.
 */
function snapshotToEngineState(snapshot: BotTurnSnapshot): EngineState {
  return {
    config: snapshot.config,
    board: snapshot.board.map((row) => row.map((cell) => ({ ...cell }))),
    players: snapshot.players.map((p) => ({ ...p })),
    phase: snapshot.phase,
    turn: {
      ...snapshot.turn,
      capturedThisTurn: new Set(snapshot.turn.capturedThisTurn),
      lastAction: snapshot.turn.lastAction ? { ...snapshot.turn.lastAction } : null,
    },
    setupConfirmed: new Set(snapshot.setupConfirmed as PlayerColor[]),
    marks: { red: {}, blue: {} },
    winner: null,
    winReason: null,
  };
}

/** Build BotObservation from EngineState — strips enemy mine positions. */
function buildBotObservation(state: EngineState, botColor: PlayerColor): BotObservation {
  const enemy: PlayerColor = botColor === 'red' ? 'blue' : 'red';
  const board = state.board.map((row) =>
    row.map((cell) => ({
      ...cell,
      hasMine: cell.owner === enemy ? false : cell.hasMine,
    })),
  );
  return {
    config:  state.config,
    board,
    players: state.players.map((p) => ({ ...p })),
    phase:   state.phase,
    turn: {
      ...state.turn,
      capturedThisTurn: new Set(state.turn.capturedThisTurn),
      lastAction: state.turn.lastAction ? { ...state.turn.lastAction } : null,
    },
    setupConfirmed: Array.from(state.setupConfirmed) as PlayerColor[],
    marks: { red: { ...state.marks.red }, blue: { ...state.marks.blue } },
    botColor,
    opponentMinesRemovedByBot: 0,
    opponentMinesPlacedHistoryMid: 0,
    winner:    state.winner,
    winReason: state.winReason,
  };
}

/** Map EngineMove (AI format) to BotMovePayload (server socket format). */
function engineMoveToBotMove(move: EngineMove): BotMovePayload {
  switch (move.type) {
    case 'place_mine_setup':  return { type: 'placeMineSetup', row: move.row, col: move.col };
    case 'confirm_setup':     return { type: 'confirmSetup' };
    case 'select_zone':       return { type: 'selectZone',     row: move.row, col: move.col };
    case 'capture':           return { type: 'captureCell',    row: move.row, col: move.col };
    case 'defuse':            return { type: 'defuseCell',     row: move.row, col: move.col };
    case 'chord':             return { type: 'chord',          row: move.row, col: move.col };
    case 'end_phase2':        return { type: 'endPhase2' };
    case 'place_mine_phase3': return { type: 'placeMinePhase3', row: move.row, col: move.col };
    case 'end_phase3':        return { type: 'endPhase3' };
    default:                  return { type: 'forfeit' };
  }
}

/** Visual pacing delay for the move (ms). */
function getMovePacing(move: EngineMove): number {
  switch (move.type) {
    case 'select_zone':       return BOT_PACING_MS.select_zone;
    case 'capture':           return BOT_PACING_MS.capture_safe;
    case 'defuse':            return BOT_PACING_MS.defuse;
    case 'chord':             return BOT_PACING_MS.chord;
    case 'place_mine_phase3': return BOT_PACING_MS.place_mine_phase3;
    case 'end_phase2':        return BOT_PACING_MS.end_phase2;
    case 'end_phase3':        return BOT_PACING_MS.end_phase3;
    case 'place_mine_setup':  return BOT_PACING_MS.place_mine_setup;
    case 'confirm_setup':     return BOT_PACING_MS.confirm_setup;
    default:                  return 200;
  }
}

export function useBotPlayer(
  socketRef: MutableRefObject<AppSocket | null>,
  isBotGame: boolean,
): void {
  const workerRef    = useRef<Worker | null>(null);
  const pendingRef   = useRef(new Map<number, (resp: BotResponse) => void>());
  const requestIdRef = useRef(0);
  const setupSeedRef = useRef(Math.floor(Math.random() * 1e9));
  const setupPlanRef = useRef<Array<{ row: number; col: number }> | null>(null);
  const processingRef = useRef(false);

  // Create / destroy the Web Worker when bot game starts / ends.
  useEffect(() => {
    if (!isBotGame) {
      workerRef.current?.terminate();
      workerRef.current = null;
      setupPlanRef.current = null;
      pendingRef.current.clear();
      return;
    }

    setupSeedRef.current = Math.floor(Math.random() * 1e9);

    const worker = new Worker(
      new URL('../ai/bot-worker.ts', import.meta.url),
      { type: 'module' },
    );
    workerRef.current = worker;

    worker.addEventListener('message', (e: MessageEvent) => {
      const { id, move, error } = e.data as {
        id: number; move?: EngineMove; error?: string;
      };
      const resolve = pendingRef.current.get(id);
      if (!resolve) return;
      pendingRef.current.delete(id);
      if (error || !move) {
        console.error('[useBotPlayer] worker error:', error);
        return;
      }
      resolve({ move, elapsedMs: 0, simsRun: 0 });
    });

    return () => {
      worker.terminate();
      workerRef.current = null;
    };
  }, [isBotGame]);

  // Use a ref to hold the latest async handler — avoids stale closures.
  const handleBotTurnRef = useRef<((snapshot: BotTurnSnapshot) => Promise<void>) | null>(null);
  handleBotTurnRef.current = async (snapshot: BotTurnSnapshot) => {
    if (processingRef.current) return;
    processingRef.current = true;

    try {
      // ── Setup phase ────────────────────────────────────────────────────────
      if (snapshot.phase === 'setup') {
        const botPlayer = snapshot.players.find((p) => p.color === snapshot.botColor)!;
        const required  = snapshot.botColor === 'red'
          ? snapshot.config.initialMinesRed
          : snapshot.config.initialMinesBlue;

        if (botPlayer.minesPlaced < required) {
          if (!setupPlanRef.current) {
            const engineState = snapshotToEngineState(snapshot);
            const noise = DIFFICULTY_PRESETS[snapshot.difficulty].setupHeuristicNoise ?? 0;
            setupPlanRef.current = planSetupMines(engineState, {
              color: snapshot.botColor,
              seed: setupSeedRef.current,
              noise,
            });
          }
          const idx = botPlayer.minesPlaced;
          const plan = setupPlanRef.current;
          if (idx < plan.length) {
            const socket = socketRef.current;
            if (!socket) return;
            await sleep(BOT_PACING_MS.place_mine_setup);
            socket.emit('botMove', { type: 'placeMineSetup', row: plan[idx].row, col: plan[idx].col });
          }
        } else {
          setupPlanRef.current = null;
          const socket = socketRef.current;
          if (!socket) return;
          await sleep(BOT_PACING_MS.confirm_setup);
          socket.emit('botMove', { type: 'confirmSetup' });
        }
        return;
      }

      // ── Game phase: run MCTS via worker ────────────────────────────────────
      const worker = workerRef.current;
      const socket = socketRef.current;
      if (!worker || !socket) return;

      const engineState = snapshotToEngineState(snapshot);
      const obs         = buildBotObservation(engineState, snapshot.botColor);
      const config      = DIFFICULTY_PRESETS[snapshot.difficulty];
      const seed        = Math.floor(Math.random() * 1e9);

      const id = ++requestIdRef.current;
      const move = await new Promise<EngineMove>((resolve, reject) => {
        const timeout = setTimeout(() => {
          pendingRef.current.delete(id);
          reject(new Error('[useBotPlayer] worker timeout'));
        }, 15_000);
        pendingRef.current.set(id, (resp) => {
          clearTimeout(timeout);
          resolve(resp.move);
        });
        const request: BotRequest & { id: number } = { obs, config, seed, id };
        worker.postMessage(request);
      });

      const delay = getMovePacing(move);
      await sleep(delay);
      socket.emit('botMove', engineMoveToBotMove(move));
    } catch (err) {
      console.error('[useBotPlayer] error:', err);
    } finally {
      processingRef.current = false;
    }
  };

  // Register the botTurn listener once when isBotGame changes.
  useEffect(() => {
    const socket = socketRef.current;
    if (!socket || !isBotGame) return;

    const handler = (snapshot: BotTurnSnapshot) => {
      handleBotTurnRef.current?.(snapshot);
    };

    socket.on('botTurn', handler);
    return () => {
      socket.off('botTurn', handler);
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isBotGame]);
}
