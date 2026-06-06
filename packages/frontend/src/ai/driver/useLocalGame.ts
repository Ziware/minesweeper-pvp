/**
 * React hook that mirrors the public API of
 * [`useSocket()`](packages/frontend/src/hooks/useSocket.ts:70) but routes all
 * moves through a local [`LocalGameDriver`](packages/frontend/src/ai/driver/LocalGameDriver.ts:1)
 * (bot vs. human, no network).
 *
 * The exposed shape is intentionally identical so `App.tsx` can swap
 * implementations with a single ternary:
 *
 *   const session = gameMode === 'solo' ? useLocalGame(opts) : useSocket();
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import type {
  CellMark,
  PlayerColor,
  S2C_GameOver,
  S2C_GameState,
  TimeControl,
} from '@minesweeper-pvp/shared';
import type { Difficulty } from '../types';
import { LocalGameDriver } from './LocalGameDriver';
import { toClientGameState } from './projection';

export type GameScreen = 'lobby' | 'waiting' | 'setup' | 'game' | 'finished';

export interface UseLocalGameOpts {
  /** Whether solo mode is active. When false, the hook does nothing
   *  (returns lobby state). */
  enabled: boolean;
  humanColor: PlayerColor;
  humanName: string;
  difficulty: Difficulty;
  /** Increment this to start a fresh game. */
  gameNonce: number;
  /** Callback fired when user clicks "play vs computer" — App will set the
   *  initial state of the local session. */
  onStarted?: () => void;
  /** Опциональный «технический» лог-канал — пишет на бекенд факт партии
   *  и каждое событие движка. На состояние UI не влияет, в подсказках
   *  пользователя не упоминается. */
  onLogEvent?: (event: string, details?: Record<string, unknown>) => void;
}

export interface UseLocalGameApi {
  screen: GameScreen;
  roomId: string;
  myColor: PlayerColor | null;
  myName: string;
  gameState: S2C_GameState | null;
  errorMsg: string;
  gameOver: S2C_GameOver | null;
  restoring: boolean;
  serverReachable: boolean;
  createRoom: (name: string, timeControl: TimeControl) => void;
  joinRoom:   (id: string, name: string) => void;
  placeMineSetup:  (row: number, col: number) => void;
  confirmSetup:    () => void;
  selectZone:      (row: number, col: number) => void;
  captureCell:     (row: number, col: number) => void;
  defuseCell:      (row: number, col: number) => void;
  chord:           (row: number, col: number) => void;
  endPhase2:       () => void;
  endPhase3:       () => void;
  placeMinePhase3: (row: number, col: number) => void;
  toggleMark:      (row: number, col: number, mark: CellMark) => void;
  showLocalError:  (message: string) => void;
  returnToMenu:    () => void;
  leaveRoom:       () => void;
}

export function useLocalGame(opts: UseLocalGameOpts): UseLocalGameApi {
  const driverRef = useRef<LocalGameDriver | null>(null);
  const [screen, setScreen] = useState<GameScreen>('lobby');
  const [gameState, setGameState] = useState<S2C_GameState | null>(null);
  const [gameOver, setGameOver] = useState<S2C_GameOver | null>(null);
  const [errorMsg, setErrorMsg] = useState('');
  const errTimerRef = useRef<number | null>(null);

  const myColor = opts.enabled ? opts.humanColor : null;
  const myName = opts.humanName;

  // Build / tear down driver whenever the gameNonce changes (or solo is toggled off).
  useEffect(() => {
    if (!opts.enabled) {
      driverRef.current?.destroy();
      driverRef.current = null;
      setScreen('lobby');
      setGameState(null);
      setGameOver(null);
      return;
    }
    const driver = new LocalGameDriver({
      humanColor: opts.humanColor,
      humanName: opts.humanName,
      difficulty: opts.difficulty,
      // Бот-метаданные (план расстановки, MCTS-статистика выбранного хода,
      // топ-альтернативы, ошибки fallback'ов) идут отдельной струёй в
      // тот же логгер, что и обычные события движка.
      onBotMeta: (kind, details) => {
        opts.onLogEvent?.(kind, details);
      },
    });
    driverRef.current = driver;

    // Технический лог одиночной сессии (молча отправляется на бекенд).
    const logFn = opts.onLogEvent;
    logFn?.('solo_started', {
      humanColor: opts.humanColor,
      difficulty: opts.difficulty,
    });
    let finishedLogged = false;

    const unsub = driver.subscribe((state, event) => {
      const projected = toClientGameState(state, opts.humanColor);
      setGameState(projected);
      const phase = state.phase;
      if      (phase === 'setup')    setScreen('setup');
      else if (phase === 'finished') setScreen('finished');
      else if (phase === 'phase1' || phase === 'phase2' || phase === 'phase3') setScreen('game');
      if (phase === 'finished' && state.winner) {
        setGameOver({ winnerColor: state.winner, reason: state.winReason ?? 'lives' });
      }
      // Стриминг событий движка как лог-записей. Сами события (ApplyEvent)
      // несут тип и параметры хода — этого достаточно, чтобы восстановить
      // картину партии оффлайн.
      if (logFn && event && (event as any).kind !== 'ERROR') {
        logFn('solo_event', {
          phase,
          currentPlayer: state.turn.currentPlayer,
          turnsPlayed: state.turn.turnsPlayed,
          event,
        });
      }
      if (logFn && phase === 'finished' && state.winner && !finishedLogged) {
        finishedLogged = true;
        logFn('solo_finished', {
          winner: state.winner,
          reason: state.winReason ?? 'lives',
          turnsPlayed: state.turn.turnsPlayed,
        });
      }
    });
    const unsubErr = driver.onError((msg) => {
      setErrorMsg(msg);
      if (errTimerRef.current) window.clearTimeout(errTimerRef.current);
      errTimerRef.current = window.setTimeout(() => setErrorMsg(''), 3000);
    });
    driver.start();
    opts.onStarted?.();

    return () => {
      unsub();
      unsubErr();
      driver.destroy();
      driverRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [opts.enabled, opts.gameNonce]);

  // Difficulty / color change without re-creating: not supported (we just
  // rebuild on gameNonce). The lobby UI bumps gameNonce when "Start" is clicked.

  // Bind driver methods.
  const api = useMemo<UseLocalGameApi>(() => ({
    screen,
    roomId: opts.enabled ? 'SOLO' : '',
    myColor,
    myName,
    gameState,
    errorMsg,
    gameOver,
    restoring: false,
    serverReachable: true,
    createRoom: () => { /* no-op in solo */ },
    joinRoom:   () => { /* no-op in solo */ },
    placeMineSetup:  (row, col) => driverRef.current?.placeMineSetup(row, col),
    confirmSetup:    () => driverRef.current?.confirmSetup(),
    selectZone:      (row, col) => driverRef.current?.selectZone(row, col),
    captureCell:     (row, col) => driverRef.current?.captureCell(row, col),
    defuseCell:      (row, col) => driverRef.current?.defuseCell(row, col),
    chord:           (row, col) => driverRef.current?.chord(row, col),
    endPhase2:       () => driverRef.current?.endPhase2(),
    endPhase3:       () => driverRef.current?.endPhase3(),
    placeMinePhase3: (row, col) => driverRef.current?.placeMinePhase3(row, col),
    toggleMark:      (row, col, mark) => driverRef.current?.toggleMark(row, col, mark),
    showLocalError:  (msg) => {
      setErrorMsg(msg);
      if (errTimerRef.current) window.clearTimeout(errTimerRef.current);
      errTimerRef.current = window.setTimeout(() => setErrorMsg(''), 3000);
    },
    returnToMenu:    () => {
      driverRef.current?.destroy();
      driverRef.current = null;
      setScreen('lobby');
      setGameState(null);
      setGameOver(null);
      setErrorMsg('');
    },
    leaveRoom:       () => {
      driverRef.current?.destroy();
      driverRef.current = null;
      setScreen('lobby');
      setGameState(null);
      setGameOver(null);
      setErrorMsg('');
    },
  }), [screen, opts.enabled, myColor, myName, gameState, errorMsg, gameOver]);

  return api;
}
