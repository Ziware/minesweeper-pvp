/**
 * Pure, immutable rules engine for Minesweeper PvP.
 *
 * Mirrors the move-application logic in
 * [`packages/backend/src/roomManager.ts`](packages/backend/src/roomManager.ts:1) but:
 *   - never mutates the input state (returns a fresh state),
 *   - never logs / emits events to the outside world (events go in ApplyResult),
 *   - never reads a clock (currentTurnStartedAtMs stays null in solo mode).
 *
 * The simulator is the **single source of truth** for the bot. Any rule
 * divergence between this file and `roomManager.ts` is a correctness bug.
 */

import type {
  CellState,
  GameConfig,
  PlayerColor,
  CellMark,
  LastAction,
} from '@minesweeper-pvp/shared';
import {
  ACTION_ZONE_SIZE,
  DISPLAY_ZONE_SIZE,
  ORTHOGONAL_DIRECTIONS,
  cellKey,
  getActionZoneTopLeft,
  getDisplayZoneTopLeft,
  getHeadquartersCells,
  getHeadquartersOwner,
  getReachablePlayerCells,
  isHeadquartersCell,
  isInBounds,
  summarizeChord,
  BALANCE,
} from '@minesweeper-pvp/shared';
import type {
  ApplyEvent,
  ApplyResult,
  EngineMove,
  EnginePlayer,
  EngineState,
  EngineTurn,
  WinReason,
} from '../types';

// ─── Balance constants (mirror packages/backend/src/gameLogic.ts) ────────────

export const INITIAL_DEFUSES_PER_TURN = BALANCE.defuse.initialPerTurn;
export const DEFUSE_GRANT_INTERVAL    = BALANCE.defuse.grantInterval;
export const HQ_ACTION_ZONE_BONUS_MINES = BALANCE.phase3.hqInActionZoneBonusMines;

export function defusesPerTurnFor(turnsPlayed: number): number {
  return INITIAL_DEFUSES_PER_TURN + Math.floor(turnsPlayed / DEFUSE_GRANT_INTERVAL);
}

// ─── Cell / board helpers (immutable variants) ───────────────────────────────

export function createEmptyBoard(size: number): CellState[][] {
  return Array.from({ length: size }, () =>
    Array.from({ length: size }, (): CellState => ({
      owner: null,
      hasMine: false,
      isRevealed: false,
      number: null,
      mark: 'none',
    })),
  );
}

export function initBoardOwnership(board: CellState[][], size: number): void {
  for (let r = 0; r < size; r++) {
    for (let c = 0; c < size; c++) {
      board[r][c].owner = r < size / 2 ? 'red' : 'blue';
    }
  }
}

export function cloneBoard(board: CellState[][]): CellState[][] {
  return board.map((row) => row.map((cell) => ({ ...cell })));
}

export function cloneState(s: EngineState): EngineState {
  return {
    config: s.config,
    board: cloneBoard(s.board),
    players: s.players.map((p) => ({ ...p })),
    phase: s.phase,
    turn: {
      ...s.turn,
      selectedZone: s.turn.selectedZone ? { ...s.turn.selectedZone } : null,
      actionZone: s.turn.actionZone ? { ...s.turn.actionZone } : null,
      capturedThisTurn: new Set(s.turn.capturedThisTurn),
      lastAction: s.turn.lastAction ? { ...s.turn.lastAction } : null,
    },
    setupConfirmed: new Set(s.setupConfirmed),
    marks: {
      red: { ...s.marks.red },
      blue: { ...s.marks.blue },
    },
    winner: s.winner,
    winReason: s.winReason,
  };
}

export function countAdjacentEnemyMines(
  board: CellState[][],
  row: number,
  col: number,
  playerColor: PlayerColor,
  size: number,
): number {
  let count = 0;
  for (let dr = -1; dr <= 1; dr++) {
    for (let dc = -1; dc <= 1; dc++) {
      if (dr === 0 && dc === 0) continue;
      const nr = row + dr;
      const nc = col + dc;
      if (!isInBounds(nr, nc, size)) continue;
      const cell = board[nr][nc];
      if (cell.hasMine && cell.owner !== playerColor) count++;
    }
  }
  return count;
}

function revealNumbersInDisplayZone(
  board: CellState[][],
  dr0: number, dc0: number,
  color: PlayerColor, size: number,
): void {
  for (let dr = 0; dr < DISPLAY_ZONE_SIZE; dr++) {
    for (let dc = 0; dc < DISPLAY_ZONE_SIZE; dc++) {
      const r = dr0 + dr;
      const c = dc0 + dc;
      if (!isInBounds(r, c, size)) continue;
      const cell = board[r][c];
      if (cell.owner === color) {
        cell.isRevealed = true;
        cell.number = countAdjacentEnemyMines(board, r, c, color, size);
      }
    }
  }
}

function refreshNumbersInDisplayZone(
  board: CellState[][],
  dr0: number, dc0: number,
  color: PlayerColor, size: number,
): void {
  for (let dr = 0; dr < DISPLAY_ZONE_SIZE; dr++) {
    for (let dc = 0; dc < DISPLAY_ZONE_SIZE; dc++) {
      const r = dr0 + dr;
      const c = dc0 + dc;
      if (!isInBounds(r, c, size)) continue;
      const cell = board[r][c];
      if (cell.owner === color && cell.isRevealed) {
        cell.number = countAdjacentEnemyMines(board, r, c, color, size);
      }
    }
  }
}

function revealNumberForCell(
  board: CellState[][],
  row: number, col: number,
  color: PlayerColor, size: number,
): void {
  const cell = board[row][col];
  if (cell.owner === color) {
    cell.isRevealed = true;
    cell.number = countAdjacentEnemyMines(board, row, col, color, size);
  }
}

function clearRevealedNumbers(board: CellState[][]): void {
  for (const row of board) {
    for (const cell of row) {
      cell.isRevealed = false;
      cell.number = null;
    }
  }
}

function actionZoneContainsHeadquarters(
  azRow: number, azCol: number,
  color: PlayerColor, size: number,
): boolean {
  return getHeadquartersCells(color, size).some(({ row, col }) => (
    row >= azRow && row < azRow + ACTION_ZONE_SIZE &&
    col >= azCol && col < azCol + ACTION_ZONE_SIZE &&
    isInBounds(row, col, size)
  ));
}

function isValidZoneSelection(
  board: CellState[][],
  dr0: number, dc0: number,
  color: PlayerColor, size: number,
): boolean {
  const reachable = getReachablePlayerCells(board, color, size);
  for (let dr = 0; dr < DISPLAY_ZONE_SIZE; dr++) {
    for (let dc = 0; dc < DISPLAY_ZONE_SIZE; dc++) {
      const r = dr0 + dr;
      const c = dc0 + dc;
      if (!isInBounds(r, c, size)) continue;
      if (reachable.has(cellKey(r, c))) return true;
    }
  }
  return false;
}

function canCaptureCell(
  board: CellState[][],
  row: number, col: number,
  color: PlayerColor,
  azRow: number, azCol: number,
  size: number,
): boolean {
  const cell = board[row][col];
  if (cell.owner === color) return false;
  const inAz =
    row >= azRow && row < azRow + ACTION_ZONE_SIZE &&
    col >= azCol && col < azCol + ACTION_ZONE_SIZE &&
    isInBounds(row, col, size);
  if (!inAz) return false;
  const reachable = getReachablePlayerCells(board, color, size);
  for (const [dr, dc] of ORTHOGONAL_DIRECTIONS) {
    const nr = row + dr;
    const nc = col + dc;
    if (!isInBounds(nr, nc, size)) continue;
    if (reachable.has(cellKey(nr, nc))) return true;
  }
  return false;
}

function isPlayerCellReachable(
  board: CellState[][],
  row: number, col: number,
  color: PlayerColor, size: number,
): boolean {
  return getReachablePlayerCells(board, color, size).has(cellKey(row, col));
}

// ─── Initial state ───────────────────────────────────────────────────────────

export interface CreateInitialStateOpts {
  config: GameConfig;
  playerNames: { red: string; blue: string };
  /** Force solo no-timer mode — sets every player's timeMs to +Infinity. */
  noTimer?: boolean;
}

export function createInitialState(opts: CreateInitialStateOpts): EngineState {
  const { config, playerNames, noTimer } = opts;
  const board = createEmptyBoard(config.boardSize);
  initBoardOwnership(board, config.boardSize);

  const baseTime = noTimer ? Number.POSITIVE_INFINITY : config.timeControl.baseMs;
  const players: EnginePlayer[] = [
    { color: 'red',  name: playerNames.red,  lives: config.maxLives, minesPlaced: 0, setupConfirmed: false, timeMs: baseTime },
    { color: 'blue', name: playerNames.blue, lives: config.maxLives, minesPlaced: 0, setupConfirmed: false, timeMs: baseTime },
  ];

  const turn: EngineTurn = {
    phase: 'setup',
    currentPlayer: 'red',
    selectedZone: null,
    actionZone: null,
    canDefuse: true,
    phase2Locked: false,
    minesPlacedThisTurn: 0,
    minesAllowedThisTurn: config.minesPerTurn,
    capturedThisTurn: new Set<string>(),
    lastAction: null,
    turnsPlayed: 0,
    defusesPerTurn: INITIAL_DEFUSES_PER_TURN,
    defusesUsedThisTurn: 0,
    currentTurnStartedAtMs: null,
    serverNowMs: Date.now(),
  };

  return {
    config,
    board,
    players,
    phase: 'setup',
    turn,
    setupConfirmed: new Set(),
    marks: { red: {}, blue: {} },
    winner: null,
    winReason: null,
  };
}

// ─── Terminal check ──────────────────────────────────────────────────────────

export function isTerminal(s: EngineState): { finished: boolean; winner: PlayerColor | null; reason: WinReason | null } {
  return { finished: s.phase === 'finished', winner: s.winner, reason: s.winReason };
}

// ─── Move dispatch ───────────────────────────────────────────────────────────

let lastActionIdCounter = 1;
function nextActionId(): number {
  return lastActionIdCounter++;
}

/**
 * Apply a move and return a brand-new state. Does NOT mutate `state`.
 * On illegal move, returns `{ ok: false, error }`.
 */
export function applyMove(state: EngineState, move: EngineMove): ApplyResult {
  if (state.phase === 'finished') {
    return { ok: false, error: 'Игра уже окончена' };
  }
  const next = cloneState(state);
  let event: ApplyEvent | undefined;

  switch (move.type) {
    case 'place_mine_setup':   event = applyPlaceMineSetup(next, move.row, move.col); break;
    case 'confirm_setup':      event = applyConfirmSetup(next); break;
    case 'select_zone':        event = applySelectZone(next, move.row, move.col); break;
    case 'capture':            event = applyCapture(next, move.row, move.col); break;
    case 'defuse':             event = applyDefuse(next, move.row, move.col); break;
    case 'chord':              event = applyChord(next, move.row, move.col); break;
    case 'toggle_mark':        event = applyToggleMark(next, move.row, move.col, move.mark); break;
    case 'end_phase2':         event = applyEndPhase2(next); break;
    case 'place_mine_phase3':  event = applyPlaceMinePhase3(next, move.row, move.col); break;
    case 'end_phase3':         event = applyEndPhase3(next); break;
    default: {
      const _exh: never = move;
      void _exh;
      return { ok: false, error: 'Неизвестное действие' };
    }
  }

  if (event && (event as any).kind === 'ERROR') {
    return { ok: false, error: (event as any).error as string };
  }
  return { ok: true, next, event };
}

// Helper to emit an "error event" from sub-handlers without throwing.
function err(message: string): ApplyEvent {
  return { kind: 'ERROR' as any, error: message } as any;
}

// ─── setup phase ─────────────────────────────────────────────────────────────

function applyPlaceMineSetup(s: EngineState, row: number, col: number): ApplyEvent {
  if (s.phase !== 'setup') return err('Сейчас не фаза расстановки');
  const color = s.turn.currentPlayer; // currentPlayer is the actor in setup? No — in setup BOTH place.
  // In setup phase, both players place simultaneously. The actor is determined
  // by the caller (the human applies for their own colour; the bot applies for
  // its own colour). For our solo flow, we use `placeMineSetupAs` below.
  // This default path uses currentPlayer for backward compat (won't be hit in
  // solo flow).
  return applyPlaceMineSetupAs(s, color, row, col);
}

/** Variant exposed for the driver: explicitly state which colour is placing. */
export function applyPlaceMineSetupAs(s: EngineState, color: PlayerColor, row: number, col: number): ApplyEvent {
  if (s.phase !== 'setup') return err('Сейчас не фаза расстановки');
  const size = s.config.boardSize;
  if (!isInBounds(row, col, size)) return err('Клетка вне поля');
  const player = s.players.find((p) => p.color === color)!;
  if (player.setupConfirmed) return err('Расстановка уже подтверждена');
  const cell = s.board[row][col];
  if (cell.owner !== color) return err('Это не ваша клетка');
  if (getHeadquartersOwner(row, col, size)) return err('Штаб нельзя заминировать');
  if (!isPlayerCellReachable(s.board, row, col, color, size)) {
    return err('Мины можно ставить только в доступные клетки');
  }
  if (cell.hasMine) {
    cell.hasMine = false;
    player.minesPlaced--;
    return { kind: 'setup_mine_toggled', row, col, actor: color };
  }
  const limit = color === 'red' ? s.config.initialMinesRed : s.config.initialMinesBlue;
  if (player.minesPlaced >= limit) return err('Достигнут лимит мин для расстановки');
  cell.hasMine = true;
  player.minesPlaced++;
  return { kind: 'setup_mine_toggled', row, col, actor: color };
}

function applyConfirmSetup(s: EngineState): ApplyEvent {
  // See note above; the driver should use applyConfirmSetupAs.
  return applyConfirmSetupAs(s, s.turn.currentPlayer);
}

export function applyConfirmSetupAs(s: EngineState, color: PlayerColor): ApplyEvent {
  if (s.phase !== 'setup') return err('Сейчас не фаза расстановки');
  const player = s.players.find((p) => p.color === color)!;
  const required = color === 'red' ? s.config.initialMinesRed : s.config.initialMinesBlue;
  if (player.minesPlaced !== required) return err(`Поставьте ровно ${required} мин`);
  if (player.setupConfirmed) return err('Уже подтверждено');
  player.setupConfirmed = true;
  s.setupConfirmed.add(color);
  if (s.setupConfirmed.size === 2) {
    // Transition to phase1 for red.
    s.phase = 'phase1';
    s.turn = createInitialTurn('red', 0, s.config.minesPerTurn);
    return { kind: 'game_started' };
  }
  return { kind: 'setup_confirmed', actor: color };
}

function createInitialTurn(currentPlayer: PlayerColor, turnsPlayed: number, minesAllowedThisTurn: number): EngineTurn {
  const defusesPerTurn = defusesPerTurnFor(turnsPlayed);
  return {
    phase: 'phase1',
    currentPlayer,
    selectedZone: null,
    actionZone: null,
    canDefuse: defusesPerTurn > 0,
    phase2Locked: false,
    minesPlacedThisTurn: 0,
    minesAllowedThisTurn,
    capturedThisTurn: new Set<string>(),
    lastAction: null,
    turnsPlayed,
    defusesPerTurn,
    defusesUsedThisTurn: 0,
    currentTurnStartedAtMs: null,
    serverNowMs: Date.now(),
  };
}

// ─── phase 1 ─────────────────────────────────────────────────────────────────

function applySelectZone(s: EngineState, clickedRow: number, clickedCol: number): ApplyEvent {
  if (s.turn.phase !== 'phase1') return err('Сейчас не фаза разведки');
  const color = s.turn.currentPlayer;
  const size = s.config.boardSize;
  const display = getDisplayZoneTopLeft(clickedRow, clickedCol);
  const action = getActionZoneTopLeft(clickedRow, clickedCol);
  if (!isValidZoneSelection(s.board, display.row, display.col, color, size)) {
    return err('В зоне 3×3 нет доступных клеток вашей территории');
  }
  const defensive = actionZoneContainsHeadquarters(action.row, action.col, color, size);
  const minesAllowed = s.config.minesPerTurn + (defensive ? HQ_ACTION_ZONE_BONUS_MINES : 0);
  s.turn.selectedZone = display;
  s.turn.actionZone = action;
  s.turn.canDefuse = s.turn.defusesUsedThisTurn < s.turn.defusesPerTurn;
  s.turn.minesAllowedThisTurn = minesAllowed;
  revealNumbersInDisplayZone(s.board, display.row, display.col, color, size);
  s.turn.phase = 'phase2';
  s.phase = 'phase2';
  s.turn.lastAction = null;
  return { kind: 'zone_selected', row: clickedRow, col: clickedCol, actor: color };
}

// ─── phase 2 ─────────────────────────────────────────────────────────────────

function applyCapture(s: EngineState, row: number, col: number): ApplyEvent {
  if (s.turn.phase !== 'phase2') return err('Сейчас не фаза захвата');
  if (s.turn.phase2Locked) return err('Захват заблокирован — завершите фазу захвата кнопкой');
  const color = s.turn.currentPlayer;
  const size = s.config.boardSize;
  const az = s.turn.actionZone!;
  const dz = s.turn.selectedZone!;
  if (!canCaptureCell(s.board, row, col, color, az.row, az.col, size)) {
    return err('Клетка должна быть в зоне 5×5 и рядом с доступной клеткой вашей территории');
  }
  const cell = s.board[row][col];
  if (cell.hasMine) {
    cell.hasMine = false;
    const player = s.players.find((p) => p.color === color)!;
    player.lives--;
    refreshNumbersInDisplayZone(s.board, dz.row, dz.col, color, size);
    s.turn.lastAction = { type: 'mine_exploded', actorColor: color, row, col, id: nextActionId() };
    if (player.lives <= 0) {
      finalizeGameOver(s, oppositeColor(color), 'lives');
      return { kind: 'mine_exploded', row, col, actor: color };
    }
    // Блокируем дальнейшие захваты — только флаги и кнопка «Завершить захват».
    s.turn.phase2Locked = true;
    return { kind: 'mine_exploded', row, col, actor: color };
  }
  // Safe capture.
  clearMarkOnCell(s, row, col);
  cell.owner = color;
  s.turn.capturedThisTurn.add(`${row},${col}`);
  const inDz =
    row >= dz.row && row < dz.row + 3 &&
    col >= dz.col && col < dz.col + 3 &&
    isInBounds(row, col, size);
  if (inDz) {
    revealNumberForCell(s.board, row, col, color, size);
    refreshNumbersInDisplayZone(s.board, dz.row, dz.col, color, size);
  }
  if (checkHeadquartersCapture(s, color, row, col)) {
    return { kind: 'capture', row, col, actor: color };
  }
  s.turn.lastAction = null;
  return { kind: 'capture', row, col, actor: color };
}

function applyDefuse(s: EngineState, row: number, col: number): ApplyEvent {
  if (s.turn.phase !== 'phase2') return err('Сейчас не фаза захвата');
  if (s.turn.phase2Locked) return err('Захват заблокирован — завершите фазу захвата кнопкой');
  const color = s.turn.currentPlayer;
  const size = s.config.boardSize;
  if (!s.turn.canDefuse || s.turn.defusesUsedThisTurn >= s.turn.defusesPerTurn) {
    return err('Лимит разминирований на ход исчерпан');
  }
  const az = s.turn.actionZone!;
  const dz = s.turn.selectedZone!;
  if (!canCaptureCell(s.board, row, col, color, az.row, az.col, size)) {
    return err('Клетка должна быть в зоне 5×5 и рядом с доступной клеткой вашей территории');
  }
  const cell = s.board[row][col];
  if (cell.owner === color) return err('Нельзя разминировать свою клетку');

  s.turn.defusesUsedThisTurn++;
  s.turn.canDefuse = s.turn.defusesUsedThisTurn < s.turn.defusesPerTurn;
  const hadMine = cell.hasMine;
  if (hadMine) {
    clearMarkOnCell(s, row, col);
    cell.hasMine = false;
    cell.owner = color;
    s.turn.capturedThisTurn.add(`${row},${col}`);
    const inDz =
      row >= dz.row && row < dz.row + 3 &&
      col >= dz.col && col < dz.col + 3 &&
      isInBounds(row, col, size);
    if (inDz) revealNumberForCell(s.board, row, col, color, size);
    refreshNumbersInDisplayZone(s.board, dz.row, dz.col, color, size);
    if (checkHeadquartersCapture(s, color, row, col)) {
      return { kind: 'defuse_success', row, col, actor: color };
    }
    s.turn.lastAction = { type: 'defuse_success', actorColor: color, row, col, id: nextActionId() };
    return { kind: 'defuse_success', row, col, actor: color };
  } else {
    clearMarkOnCell(s, row, col);
    cell.owner = color;
    s.turn.capturedThisTurn.add(`${row},${col}`);
    const inDzNoMine =
      row >= dz.row && row < dz.row + 3 &&
      col >= dz.col && col < dz.col + 3 &&
      isInBounds(row, col, size);
    if (inDzNoMine) revealNumberForCell(s.board, row, col, color, size);
    refreshNumbersInDisplayZone(s.board, dz.row, dz.col, color, size);
    if (checkHeadquartersCapture(s, color, row, col)) {
      return { kind: 'defuse_no_mine', row, col, actor: color };
    }
    // Блокируем дальнейшие захваты — только флаги и кнопка «Завершить захват».
    s.turn.phase2Locked = true;
    s.turn.lastAction = { type: 'defuse_no_mine', actorColor: color, row, col, id: nextActionId() };
    return { kind: 'defuse_no_mine', row, col, actor: color };
  }
}

function applyChord(s: EngineState, row: number, col: number): ApplyEvent {
  if (s.turn.phase !== 'phase2') return err('Сейчас не фаза захвата');
  if (s.turn.phase2Locked) return err('Захват заблокирован — завершите фазу захвата кнопкой');
  const color = s.turn.currentPlayer;
  const size = s.config.boardSize;
  if (!isInBounds(row, col, size)) return err('Клетка вне поля');
  const dz = s.turn.selectedZone!;
  const az = s.turn.actionZone!;
  const cell = s.board[row][col];
  if (cell.owner !== color) return err('Аккорд работает только по своей клетке');
  const inDisplay =
    row >= dz.row && row < dz.row + 3 &&
    col >= dz.col && col < dz.col + 3;
  if (!inDisplay || !cell.isRevealed || cell.number === null) {
    return err('Аккорд возможен только на открытой клетке с цифрой в зоне 3×3');
  }
  const myMarks = s.marks[color];
  const reachable = getReachablePlayerCells(s.board, color, size);
  const { flagCount, candidates } = summarizeChord(row, col, {
    boardSize: size,
    isFlag:        (r, c) => myMarks[`${r},${c}`] === 'flag',
    isOwnedByActor:(r, c) => isInBounds(r, c, size) && s.board[r][c].owner === color,
    isReachableOwn:(r, c) => reachable.has(`${r},${c}`),
  });
  if (flagCount > cell.number) return err('Слишком много флажков для аккорда');
  if (flagCount < cell.number) return err('Недостаточно флажков для аккорда');

  // Step 1: first mine explodes; rest of candidates not captured.
  for (const { row: r, col: c } of candidates) {
    const target = s.board[r][c];
    if (!target.hasMine) continue;
    if (!canCaptureCell(s.board, r, c, color, az.row, az.col, size)) continue;
    target.hasMine = false;
    const player = s.players.find((p) => p.color === color)!;
    player.lives--;
    refreshNumbersInDisplayZone(s.board, dz.row, dz.col, color, size);
    s.turn.lastAction = { type: 'mine_exploded', actorColor: color, row: r, col: c, id: nextActionId() };
    if (player.lives <= 0) {
      finalizeGameOver(s, oppositeColor(color), 'lives');
      return { kind: 'mine_exploded', row: r, col: c, actor: color };
    }
    // Блокируем дальнейшие захваты — только флаги и кнопка «Завершить захват».
    s.turn.phase2Locked = true;
    return { kind: 'mine_exploded', row: r, col: c, actor: color };
  }

  // Step 2: no mines in candidates — capture all accessible.
  let captureCount = 0;
  for (const { row: r, col: c } of candidates) {
    const target = s.board[r][c];
    if (target.owner === color) continue;
    if (!canCaptureCell(s.board, r, c, color, az.row, az.col, size)) continue;
    clearMarkOnCell(s, r, c);
    target.owner = color;
    s.turn.capturedThisTurn.add(`${r},${c}`);
    captureCount++;
    const targetInDz =
      r >= dz.row && r < dz.row + 3 &&
      c >= dz.col && c < dz.col + 3;
    if (targetInDz) revealNumberForCell(s.board, r, c, color, size);
    if (checkHeadquartersCapture(s, color, r, c)) {
      return { kind: 'capture', row: r, col: c, actor: color };
    }
  }
  refreshNumbersInDisplayZone(s.board, dz.row, dz.col, color, size);
  if (captureCount > 0) s.turn.lastAction = null;
  return { kind: 'capture', row, col, actor: color };
}

function applyToggleMark(s: EngineState, row: number, col: number, mark: CellMark): ApplyEvent {
  const color = s.turn.currentPlayer; // Either side can mark, but the bot won't use this.
  const size = s.config.boardSize;
  if (!isInBounds(row, col, size)) return err('Клетка вне поля');
  const cell = s.board[row][col];
  if (cell.owner === color) return err('Нельзя ставить метку на свою клетку');
  s.marks[color][`${row},${col}`] = mark;
  return { kind: 'mark_toggled', row, col, actor: color };
}

function applyEndPhase2(s: EngineState): ApplyEvent {
  if (s.turn.phase !== 'phase2') return err('Сейчас не фаза захвата');
  const actor = s.turn.currentPlayer;
  startPhase3(s);
  return { kind: 'end_phase2', actor };
}

function startPhase3(s: EngineState, lastAction?: LastAction): void {
  clearRevealedNumbers(s.board);
  s.turn.selectedZone = null;
  s.turn.actionZone = null;
  s.turn.phase = 'phase3';
  s.phase = 'phase3';
  s.turn.minesPlacedThisTurn = 0;
  if (lastAction) s.turn.lastAction = lastAction;
}

// ─── phase 3 ─────────────────────────────────────────────────────────────────

function applyPlaceMinePhase3(s: EngineState, row: number, col: number): ApplyEvent {
  if (s.turn.phase !== 'phase3') return err('Сейчас не фаза минирования');
  const color = s.turn.currentPlayer;
  const size = s.config.boardSize;
  if (s.turn.minesPlacedThisTurn >= s.turn.minesAllowedThisTurn) {
    return err('Достигнут лимит мин на этот ход');
  }
  const cell = s.board[row][col];
  if (cell.owner !== color) return err('Это не ваша клетка');
  if (getHeadquartersOwner(row, col, size)) return err('Штаб нельзя заминировать');
  if (!isPlayerCellReachable(s.board, row, col, color, size)) {
    return err('Мины можно ставить только в доступные клетки');
  }
  if (cell.hasMine) return err('Здесь уже стоит мина');
  cell.hasMine = true;
  s.turn.minesPlacedThisTurn++;
  if (s.turn.minesPlacedThisTurn >= s.turn.minesAllowedThisTurn) {
    checkAndFinishTurn(s);
  }
  return { kind: 'mine_placed_phase3', row, col, actor: color };
}

function applyEndPhase3(s: EngineState): ApplyEvent {
  if (s.turn.phase !== 'phase3') return err('Сейчас не фаза минирования');
  const actor = s.turn.currentPlayer;
  checkAndFinishTurn(s);
  return { kind: 'end_phase3', actor };
}

function checkAndFinishTurn(s: EngineState): boolean {
  const cur = s.players.find((p) => p.color === s.turn.currentPlayer)!;
  if (cur.lives <= 0) {
    finalizeGameOver(s, oppositeColor(cur.color), 'lives');
    return true;
  }
  // Solo: no timer; we do not commit time.
  const turnsPlayed = s.turn.turnsPlayed + 1;
  const nextColor = oppositeColor(s.turn.currentPlayer);
  s.turn = createInitialTurn(nextColor, turnsPlayed, s.config.minesPerTurn);
  s.phase = 'phase1';
  return false;
}

// ─── shared helpers ─────────────────────────────────────────────────────────

function clearMarkOnCell(s: EngineState, row: number, col: number): void {
  s.marks.red[`${row},${col}`] = 'none';
  s.marks.blue[`${row},${col}`] = 'none';
}

function checkHeadquartersCapture(s: EngineState, color: PlayerColor, row: number, col: number): boolean {
  const owner = getHeadquartersOwner(row, col, s.config.boardSize);
  if (!owner || owner === color) return false;
  finalizeGameOver(s, color, 'headquarters');
  return true;
}

function finalizeGameOver(s: EngineState, winner: PlayerColor, reason: WinReason): void {
  s.winner = winner;
  s.winReason = reason;
  s.phase = 'finished';
  s.turn.phase = 'finished';
  clearRevealedNumbers(s.board);
}

export function oppositeColor(c: PlayerColor): PlayerColor {
  return c === 'red' ? 'blue' : 'red';
}

// ─── Re-exports for action enumerator ────────────────────────────────────────

export {
  isValidZoneSelection,
  canCaptureCell,
  isPlayerCellReachable,
  actionZoneContainsHeadquarters,
  revealNumbersInDisplayZone,
  refreshNumbersInDisplayZone,
  isHeadquartersCell,
};
