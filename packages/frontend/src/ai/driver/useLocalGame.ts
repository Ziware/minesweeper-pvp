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
 *
 * Кроме UI-стейта хук отвечает за СТРИМ упрощённых «игровых» событий в тот же
 * технический канал, что и PvP-сервер (см. SoloLogPayload в shared). На каждое
 * изменение состояния он сравнивает с предыдущим снапшотом и порождает
 * минимум один тип события из унифицированного словаря:
 *
 *   setup_mine, setup_confirmed, game_started, zone_select, cell_open,
 *   mine_hit, mine_defused, phase3_mine, turn_end, game_finished.
 *
 * Это нужно, чтобы вьюер мог воспроизводить solo-партии тем же кодом, что
 * и PvP — без особых случаев для аккордов и единичных ходов.
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import type {
  CellMark,
  PlayerColor,
  S2C_GameOver,
  S2C_GameState,
  SoloLogPayload,
  TimeControl,
} from '@minesweeper-pvp/shared';
import type { Difficulty, EngineState } from '../types';
import type { ApplyEvent } from '../types';
import { LocalGameDriver } from './LocalGameDriver';
import { toClientGameState } from './projection';

export type GameScreen = 'lobby' | 'waiting' | 'setup' | 'game' | 'finished';

/** Полезная нагрузка solo-лога БЕЗ sessionId — его добавит App-слой. */
export type SoloLogEvent =
  Exclude<SoloLogPayload, { kind: 'session_start' } | { kind: 'session_aux' }> extends infer T
    ? T extends { sessionId: string } ? Omit<T, 'sessionId'> : never
    : never;

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
  /**
   * Канал упрощённых игровых событий. Сам тип фиксирован SoloLogPayload —
   * вьюер ничего другого не понимает. Прочие события (телеметрия бота)
   * идут отдельным каналом `onLogAux`.
   */
  onSoloEvent?: (event: SoloLogEvent) => void;
  /**
   * Канал «сервисных» событий solo-сессии (план бота, статистика MCTS,
   * fallback'ы). Они пишутся отдельным файлом и НЕ влияют на просмотрщик.
   */
  onLogAux?: (auxKind: string, details?: Record<string, unknown>) => void;
  /**
   * Канал событий жизненного цикла. Один раз на партию вызывается с
   * `'session_start'` (после монтирования driver'а) и с `'session_finished'`
   * (когда в state.phase появился winner). Нужно App-слою, чтобы отправить
   * session_start на сервер и закрыть его естественно.
   */
  onSession?: (kind: 'session_start' | 'session_finished', meta: {
    humanColor: PlayerColor;
    humanName: string;
    difficulty: Difficulty;
    config: EngineState['config'];
  }) => void;
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

/** Мини-снапшот предыдущего состояния, по которому считаем диффы. */
interface PrevSnap {
  phase: string;
  currentPlayer: PlayerColor;
  turnsPlayed: number;
  livesRed: number;
  livesBlue: number;
  defusesUsedThisTurn: number;
  /** captured this turn (set of "r,c"). */
  captured: Set<string>;
  /** Mines placed this turn (phase3). */
  minesPlacedThisTurn: number;
  gameStartedEmitted: boolean;
  finishedEmitted: boolean;
  /** Цвета, для которых уже эмитили setup_confirmed. */
  setupConfirmedEmitted: Set<PlayerColor>;
}

function makeSnap(s: EngineState, carry?: Partial<Pick<PrevSnap, 'gameStartedEmitted' | 'finishedEmitted' | 'setupConfirmedEmitted'>>): PrevSnap {
  const red  = s.players.find((p) => p.color === 'red')!;
  const blue = s.players.find((p) => p.color === 'blue')!;
  return {
    phase: s.phase,
    currentPlayer: s.turn.currentPlayer,
    turnsPlayed: s.turn.turnsPlayed,
    livesRed:  red.lives,
    livesBlue: blue.lives,
    defusesUsedThisTurn: s.turn.defusesUsedThisTurn,
    captured: new Set(s.turn.capturedThisTurn),
    minesPlacedThisTurn: s.turn.minesPlacedThisTurn,
    gameStartedEmitted: carry?.gameStartedEmitted ?? false,
    finishedEmitted:    carry?.finishedEmitted    ?? false,
    setupConfirmedEmitted: carry?.setupConfirmedEmitted ?? new Set<PlayerColor>(),
  };
}

function carryFrom(prev: PrevSnap, overrides: Partial<Pick<PrevSnap, 'gameStartedEmitted' | 'finishedEmitted' | 'setupConfirmedEmitted'>> = {}) {
  return {
    gameStartedEmitted: overrides.gameStartedEmitted ?? prev.gameStartedEmitted,
    finishedEmitted:    overrides.finishedEmitted    ?? prev.finishedEmitted,
    setupConfirmedEmitted: overrides.setupConfirmedEmitted ?? new Set(prev.setupConfirmedEmitted),
  };
}

/**
 * Перевести очередное обновление engine-state + ApplyEvent в одну или
 * несколько записей унифицированного solo-лога. Возвращает обновлённый
 * снапшот предыдущего состояния.
 */
function diffAndEmit(
  prev: PrevSnap,
  next: EngineState,
  event: ApplyEvent | undefined,
  emit: (ev: SoloLogEvent) => void,
): PrevSnap {
  // 1) Setup phase events.
  if (event?.kind === 'setup_mine_toggled') {
    const p = next.players.find((pp) => pp.color === event.actor)!;
    const cell = next.board[event.row][event.col];
    emit({
      kind: 'setup_mine',
      actor: event.actor,
      row: event.row,
      col: event.col,
      hasMine: cell.hasMine,
      minesPlaced: p.minesPlaced,
    });
    return makeSnap(next, carryFrom(prev));
  }

  if (event?.kind === 'setup_confirmed') {
    const p = next.players.find((pp) => pp.color === event.actor)!;
    emit({ kind: 'setup_confirmed', actor: event.actor, minesPlaced: p.minesPlaced });
    const nextSnap = makeSnap(next, carryFrom(prev));
    nextSnap.setupConfirmedEmitted = new Set(prev.setupConfirmedEmitted);
    nextSnap.setupConfirmedEmitted.add(event.actor);
    return nextSnap;
  }

  if (event?.kind === 'game_started' || (!prev.gameStartedEmitted && prev.phase === 'setup' && next.phase !== 'setup' && next.phase !== 'finished')) {
    // Симулятор возвращает 'game_started' вместо setup_confirmed для ВТОРОГО
    // подтверждения. Добиваем недостающий setup_confirmed для тех игроков,
    // кого ещё не зафиксировали.
    for (const color of ['red', 'blue'] as PlayerColor[]) {
      if (prev.setupConfirmedEmitted.has(color)) continue;
      const p = next.players.find((pp) => pp.color === color)!;
      if (p.setupConfirmed) {
        emit({ kind: 'setup_confirmed', actor: color, minesPlaced: p.minesPlaced });
      }
    }
    emit({ kind: 'game_started', firstPlayer: next.turn.currentPlayer });
    const nextSnap = makeSnap(next, carryFrom(prev, { gameStartedEmitted: true }));
    nextSnap.setupConfirmedEmitted = new Set<PlayerColor>(['red', 'blue']);
    return nextSnap;
  }

  // 2) zone_selected → zone_select.
  if (event?.kind === 'zone_selected') {
    const dz = next.turn.selectedZone!;
    const az = next.turn.actionZone!;
    emit({
      kind: 'zone_select',
      actor: event.actor,
      clicked: { row: event.row, col: event.col },
      displayZone: { row: dz.row, col: dz.col },
      actionZone: { row: az.row, col: az.col },
    });
    return makeSnap(next, carryFrom(prev));
  }

  // 3) phase3 mine placement.
  if (event?.kind === 'mine_placed_phase3') {
    emit({ kind: 'phase3_mine', actor: event.actor, row: event.row, col: event.col });
    // Если minesPlacedThisTurn достиг лимита, симулятор вызовет
    // checkAndFinishTurn и turnsPlayed увеличится — это поймаем ниже.
  }

  // 4) Capture-class events: единичные захваты, мины-взрывы, дефьюзы и аккорды.
  // Решающим источником истины тут является диффирование captured/lives/defuses.
  // Простое правило:
  //   • если defusesUsedThisTurn увеличился — это был defuseCell;
  //   • если lives актора уменьшился — была мина-взрыв (mine_hit);
  //   • новые клетки в capturedThisTurn → cell_open, по одной на клетку.

  const actor = next.turn.currentPlayer; // актор не сменился внутри одного хода
  const prevLives = actor === 'red' ? prev.livesRed : prev.livesBlue;
  const nextRed  = next.players.find((p) => p.color === 'red')!;
  const nextBlue = next.players.find((p) => p.color === 'blue')!;
  const nextLives = actor === 'red' ? nextRed.lives : nextBlue.lives;

  const isMineHitEvent = event?.kind === 'mine_exploded';
  const isDefuseEvent  = event?.kind === 'defuse_success' || event?.kind === 'defuse_no_mine';

  // Захват/дефьюз/аккорд: ищем новые клетки в captured.
  const newCaptures: Array<{ row: number; col: number }> = [];
  for (const key of next.turn.capturedThisTurn) {
    if (!prev.captured.has(key)) {
      const [r, c] = key.split(',').map(Number);
      newCaptures.push({ row: r, col: c });
    }
  }

  // 4.a) Mine hit: одно событие на ход (мина взрывается, ход прерывается).
  if (isMineHitEvent && event && event.kind === 'mine_exploded') {
    emit({
      kind: 'mine_hit',
      actor,
      row: event.row,
      col: event.col,
      livesLeft: nextLives,
      viaChord: false, // simulator emits event for the *first* mine; chord-vs-single neразличимо здесь, но для просмотрщика разницы нет
    });
    return makeSnap(next, carryFrom(prev));
  }

  // 4.b) Defuse (one cell per call). Сначала событие mine_defused, потом —
  // если клетка была захвачена — это уже отражено в newCaptures, не пишем
  // дополнительно cell_open: запись mine_defused и без того означает захват.
  if (isDefuseEvent && event && (event.kind === 'defuse_success' || event.kind === 'defuse_no_mine')) {
    const hadMine = event.kind === 'defuse_success';
    emit({
      kind: 'mine_defused',
      actor,
      row: event.row,
      col: event.col,
      hadMine,
    });
    // Несмотря на дефьюз клетка захватывается и попадает в capturedThisTurn —
    // но cell_open для неё нам не нужен (mine_defused уже несёт смысл захвата).
    return makeSnap(next, carryFrom(prev));
  }

  // 4.c) Обычный захват: одна клетка (single capture) или несколько (chord).
  // Симулятор всегда отдаёт один ApplyEvent {kind:'capture'} на любой вариант —
  // мы переводим это в N событий cell_open по diff'у capturedThisTurn.
  if (event?.kind === 'capture' && newCaptures.length > 0) {
    const viaChord = newCaptures.length > 1;
    for (const { row, col } of newCaptures) {
      emit({ kind: 'cell_open', actor, row, col, viaChord });
    }
  }

  // 5) Конец хода: detect turn switch.
  if (next.turn.turnsPlayed > prev.turnsPlayed || (prev.currentPlayer !== next.turn.currentPlayer && prev.phase !== 'setup')) {
    // Актор закончившегося хода — это prev.currentPlayer.
    emit({ kind: 'turn_end', actor: prev.currentPlayer, turnsPlayed: next.turn.turnsPlayed });
  }

  // 6) Game finished.
  let finishedEmitted = prev.finishedEmitted;
  if (!finishedEmitted && next.phase === 'finished' && next.winner) {
    emit({
      kind: 'game_finished',
      winner: next.winner,
      reason: next.winReason ?? 'lives',
    });
    finishedEmitted = true;
  }

  return makeSnap(next, carryFrom(prev, { finishedEmitted }));
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
      onBotMeta: (kind, details) => {
        opts.onLogAux?.(kind, details);
      },
    });
    driverRef.current = driver;

    let prevSnap: PrevSnap | null = null;
    let sessionStartSent = false;
    const sendSoloEvent = opts.onSoloEvent;

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

      // Подняли session_start один раз — как только driver выдал первый
      // state (это initial subscribe; см. LocalGameDriver.subscribe).
      if (!sessionStartSent) {
        sessionStartSent = true;
        opts.onSession?.('session_start', {
          humanColor: opts.humanColor,
          humanName: opts.humanName,
          difficulty: opts.difficulty,
          config: state.config,
        });
        prevSnap = makeSnap(state);
        // Не диффируем initial — это исходное состояние, событий ещё не было.
        return;
      }

      if (prevSnap && sendSoloEvent) {
        prevSnap = diffAndEmit(prevSnap, state, event, sendSoloEvent);
      } else {
        prevSnap = makeSnap(state, prevSnap ? carryFrom(prevSnap) : undefined);
      }

      if (phase === 'finished' && state.winner && prevSnap?.finishedEmitted) {
        opts.onSession?.('session_finished', {
          humanColor: opts.humanColor,
          humanName: opts.humanName,
          difficulty: opts.difficulty,
          config: state.config,
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
