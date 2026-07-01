import {
  CellState,
  GameConfig,
  GamePhase,
  PlayerColor,
  TurnState,
  CellMark,
  TimeControl,
  LastAction,
  ALLOWED_TIME_CONTROLS as SHARED_ALLOWED_TIME_CONTROLS,
  summarizeChord as sharedSummarizeChord,
} from '@minesweeper-pvp/shared';
import { createGameRecorder, type GameRecorder } from './gameRecorder';
import {
  DEFAULT_CONFIG,
  DEFAULT_TIME_CONTROL,
  createBoard,
  initBoard,
  revealNumbersInDisplayZone,
  refreshNumbersInDisplayZone,
  revealNumberForCell,
  clearRevealedNumbers,
  isValidZoneSelection,
  canCaptureCell,
  getBoardForPlayer,
  createInitialTurnState,
  getDisplayZoneTopLeft,
  getActionZoneTopLeft,
  isInBounds,
  computeBoardStats,
  getHeadquartersOwner,
  isPlayerCellReachable,
  getReachablePlayerCells,
  INITIAL_DEFUSES_PER_TURN,
  DEFUSE_GRANT_INTERVAL,
  HQ_ACTION_ZONE_BONUS_MINES,
  defusesPerTurnFor,
  actionZoneContainsHeadquarters,
} from './gameLogic';

export interface PlayerState {
  id: string;          // текущий socket.id ('__bot__' для бот-игрока)
  tabId: string;       // уникальный id вкладки браузера ('__bot__' для бота)
  color: PlayerColor;
  name: string;
  ip?: string;
  /** Authenticated user id from the API (JWT sub). */
  userId?: string;
  lives: number;
  minesPlaced: number;
  connected: boolean;
  setupConfirmed: boolean;
  /** Оставшееся время на партию в миллисекундах. */
  timeMs: number;
  /** Бот-игрок — ходы вычисляет браузер и отправляет через botMove. */
  isBot?: true;
  botDifficulty?: 'easy' | 'normal' | 'hard';
}

export type WinReason = 'lives' | 'headquarters' | 'time' | 'surrender' | 'aborted';

export interface Room {
  id: string;
  config: GameConfig;
  board: CellState[][];
  players: PlayerState[];
  phase: GamePhase;
  turn: TurnState;
  setupConfirmed: Set<PlayerColor>;
  winner?: PlayerColor;
  winReason?: WinReason;
  marks: Record<PlayerColor, Record<string, CellMark>>;
  recorder: GameRecorder;
  gameOverLogged: boolean;
  /** Timestamp последнего игрового действия (для inactivity-таймаута). */
  lastActionAt: number;
  /** socket.id человека-игрока в bot-комнате — туда шлём botTurn события. */
  botSocketId?: string;
}

/** Допустимые пресеты времени, которые сервер принимает от клиента. */
const ALLOWED_TIME_CONTROLS: TimeControl[] = SHARED_ALLOWED_TIME_CONTROLS;

function normalizeTimeControl(tc?: TimeControl | null): TimeControl {
  if (!tc) return DEFAULT_TIME_CONTROL;
  const match = ALLOWED_TIME_CONTROLS.find(
    (t) => t.baseMs === tc.baseMs && t.incrementMs === tc.incrementMs,
  );
  return match ?? DEFAULT_TIME_CONTROL;
}

const EMPTY_ROOM_TTL_MS = 60 * 60 * 1000;

export class RoomManager {
  private rooms: Map<string, Room> = new Map();
  // socket.id → roomId
  private socketToRoom: Map<string, string> = new Map();
  // socket.id → PlayerColor
  private socketToPlayer: Map<string, PlayerColor> = new Map();
  // roomId → таймер удаления комнаты, если все игроки отключились
  private emptyRoomCleanupTimers: Map<string, ReturnType<typeof setTimeout>> = new Map();

  generateRoomId(): string {
    // 16 символов из 54-символьного алфавита (~87 бит энтропии).
    // Убраны визуально схожие: 0/O, 1/I/l.
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789';
    let id = '';
    for (let i = 0; i < 16; i++) {
      id += chars[Math.floor(Math.random() * chars.length)];
    }
    return id;
  }

  createRoom(
    socketId: string,
    tabId: string,
    playerName: string,
    ip: string,
    timeControl?: TimeControl,
    userId?: string,
  ): Room {
    const roomId     = this.generateRoomId();
    const tc         = normalizeTimeControl(timeControl);
    const fullConfig: GameConfig = { ...DEFAULT_CONFIG, timeControl: tc };
    const board      = createBoard(fullConfig.boardSize);
    initBoard(board, fullConfig);

    const recorder = createGameRecorder({
      sessionId: roomId,
      mode: 'pvp',
      initialPlayer: { color: 'red', name: playerName, ip, userId },
    });
    recorder.setConfig(fullConfig);

    const room: Room = {
      id: roomId,
      config: fullConfig,
      board,
      players: [{
        id: socketId,
        tabId,
        color: 'red',
        name: playerName,
        ip,
        userId,
        lives: fullConfig.maxLives,
        minesPlaced: 0,
        connected: true,
        setupConfirmed: false,
        timeMs: tc.baseMs,
      }],
      phase: 'waiting',
      turn: {
        phase: 'waiting',
        currentPlayer: 'red',
        selectedZone: null,
        actionZone: null,
        canDefuse: true,
        minesPlacedThisTurn: 0,
        minesAllowedThisTurn: fullConfig.minesPerTurn,
        capturedThisTurn: new Set(),
        lastAction: null,
        turnsPlayed: 0,
        defusesPerTurn: INITIAL_DEFUSES_PER_TURN,
        defusesUsedThisTurn: 0,
        currentTurnStartedAtMs: null,
        serverNowMs: Date.now(),
      },
      setupConfirmed: new Set(),
      marks: { red: {}, blue: {} },
      recorder,
      gameOverLogged: false,
      lastActionAt: Date.now(),
    };

    this.rooms.set(roomId, room);
    this.socketToRoom.set(socketId, roomId);
    this.socketToPlayer.set(socketId, 'red');
    return room;
  }

  /**
   * Создать комнату с ботом. Сразу переходит в фазу setup (без ожидания).
   * Бот-игрок имеет id='__bot__' — реального сокета нет.
   */
  createBotRoom(
    humanSocketId: string,
    tabId: string,
    playerName: string,
    difficulty: 'easy' | 'normal' | 'hard',
    humanColor: PlayerColor,
    ip: string,
    userId?: string,
  ): Room {
    const roomId = this.generateRoomId();
    // Игры против бота — без таймера
    const noTimerControl: TimeControl = { baseMs: 0, incrementMs: 0 };
    const fullConfig: GameConfig = { ...DEFAULT_CONFIG, timeControl: noTimerControl };
    const board = createBoard(fullConfig.boardSize);
    initBoard(board, fullConfig);

    const botColor: PlayerColor = humanColor === 'red' ? 'blue' : 'red';
    const botName = difficulty === 'easy' ? 'Бот (Легко)' : difficulty === 'normal' ? 'Бот (Нормально)' : 'Бот (Сложно)';

    const recorder = createGameRecorder({
      sessionId: roomId,
      mode: 'solo',
      initialPlayer: { color: humanColor, name: playerName, ip, userId },
    });
    recorder.setConfig(fullConfig);
    recorder.setPlayer({ color: botColor, name: botName, isBot: true, difficulty });

    const humanPlayer: PlayerState = {
      id: humanSocketId,
      tabId,
      color: humanColor,
      name: playerName,
      ip,
      userId,
      lives: fullConfig.maxLives,
      minesPlaced: 0,
      connected: true,
      setupConfirmed: false,
      timeMs: 0,
    };
    const botPlayer: PlayerState = {
      id: '__bot__',
      tabId: '__bot__',
      color: botColor,
      name: botName,
      lives: fullConfig.maxLives,
      minesPlaced: 0,
      connected: true,
      setupConfirmed: false,
      timeMs: 0,
      isBot: true,
      botDifficulty: difficulty,
    };

    const players: PlayerState[] = humanColor === 'red'
      ? [humanPlayer, botPlayer]
      : [botPlayer, humanPlayer];

    const room: Room = {
      id: roomId,
      config: fullConfig,
      board,
      players,
      phase: 'setup',
      turn: {
        phase: 'setup',
        currentPlayer: 'red',
        selectedZone: null,
        actionZone: null,
        canDefuse: true,
        minesPlacedThisTurn: 0,
        minesAllowedThisTurn: fullConfig.minesPerTurn,
        capturedThisTurn: new Set(),
        lastAction: null,
        turnsPlayed: 0,
        defusesPerTurn: INITIAL_DEFUSES_PER_TURN,
        defusesUsedThisTurn: 0,
        currentTurnStartedAtMs: null,
        serverNowMs: Date.now(),
      },
      setupConfirmed: new Set(),
      marks: { red: {}, blue: {} },
      recorder,
      gameOverLogged: false,
      lastActionAt: Date.now(),
      botSocketId: humanSocketId,
    };

    this.rooms.set(roomId, room);
    this.socketToRoom.set(humanSocketId, roomId);
    this.socketToPlayer.set(humanSocketId, humanColor);
    return room;
  }

  joinRoom(socketId: string, tabId: string, roomId: string, playerName: string, ip: string, userId?: string): Room | null {
    const room = this.rooms.get(roomId);
    if (!room || room.players.length >= 2) return null;

    room.players.push({
      id: socketId,
      tabId,
      color: 'blue',
      name: playerName,
      ip,
      userId,
      lives: room.config.maxLives,
      minesPlaced: 0,
      connected: true,
      setupConfirmed: false,
      timeMs: room.config.timeControl.baseMs,
    });
    room.phase      = 'setup';
    room.turn.phase = 'setup';
    room.recorder.setPlayer({ color: 'blue', name: playerName, ip, userId });

    this.socketToRoom.set(socketId, roomId);
    this.socketToPlayer.set(socketId, 'blue');
    return room;
  }

  // Восстановление сессии по roomId + color + tabId
  // tabId гарантирует что разные вкладки не перехватывают сессии друг друга
  restoreSession(
    newSocketId: string,
    roomId: string,
    playerColor: PlayerColor,
    tabId: string,
  ): { room: Room | null; error?: string } {
    const room = this.rooms.get(roomId);
    if (!room) return { room: null, error: 'Сессия истекла или комната не найдена' };

    const player = room.players.find((p) => p.color === playerColor);
    if (!player) return { room: null, error: 'Игрок не найден в комнате' };

    // Проверяем tabId — вкладка должна совпадать
    if (player.tabId !== tabId) {
      return {
        room: null,
        error: 'Сессия принадлежит другой вкладке',
      };
    }

    this.cancelEmptyRoomCleanup(roomId);

    // Обновляем socket.id (он изменился после переподключения)
    const oldSocketId = player.id;
    this.socketToRoom.delete(oldSocketId);
    this.socketToPlayer.delete(oldSocketId);

    player.id        = newSocketId;
    player.connected = true;

    this.socketToRoom.set(newSocketId, roomId);
    this.socketToPlayer.set(newSocketId, playerColor);


    return { room };
  }

  getRoom(socketId: string): Room | null {
    const roomId = this.socketToRoom.get(socketId);
    if (!roomId) return null;
    return this.rooms.get(roomId) || null;
  }

  getPlayerColor(socketId: string): PlayerColor | null {
    return this.socketToPlayer.get(socketId) || null;
  }

  getRoomById(roomId: string): Room | null {
    return this.rooms.get(roomId) || null;
  }

  /**
   * Добровольный выход игрока из комнаты (например, по кнопке «← В меню»
   * на экране ожидания). В отличие от `removePlayer`, удаляет игрока
   * полностью и, если комната становится пустой — сносит её сразу,
   * не дожидаясь TTL пустой комнаты.
   */
  leaveRoom(socketId: string): Room | null {
    const room = this.getRoom(socketId);
    if (!room) return null;
    const idx = room.players.findIndex((p) => p.id === socketId);
    if (idx >= 0) {
      const player = room.players[idx];
      room.players.splice(idx, 1);
    }
    this.socketToRoom.delete(socketId);
    this.socketToPlayer.delete(socketId);
    if (room.players.length === 0) {
      this.cancelEmptyRoomCleanup(room.id);
      this.deleteRoom(room.id);
    }
    return room;
  }

  removePlayer(socketId: string): { room: Room | null; color: PlayerColor | null } {
    const room  = this.getRoom(socketId);
    const color = this.getPlayerColor(socketId);
    if (room) {
      const player = room.players.find((p) => p.id === socketId);
      if (player) {
        player.connected = false;
      }
    }
    this.socketToRoom.delete(socketId);
    this.socketToPlayer.delete(socketId);
    if (room) this.scheduleEmptyRoomCleanupIfNeeded(room);
    return { room, color };
  }

  private scheduleEmptyRoomCleanupIfNeeded(room: Room): boolean {
    const allPlayersDisconnected = room.players.length > 0 && room.players.every((p) => !p.connected);
    if (!allPlayersDisconnected) return false;
    if (this.emptyRoomCleanupTimers.has(room.id)) return true;

    const timer = setTimeout(() => {
      this.emptyRoomCleanupTimers.delete(room.id);
      const currentRoom = this.rooms.get(room.id);
      if (!currentRoom) return;

      const stillEmpty = currentRoom.players.length > 0 && currentRoom.players.every((p) => !p.connected);
      if (stillEmpty) this.deleteRoom(room.id);
    }, EMPTY_ROOM_TTL_MS);

    timer.unref?.();
    this.emptyRoomCleanupTimers.set(room.id, timer);
    return true;
  }

  private cancelEmptyRoomCleanup(roomId: string): boolean {
    const timer = this.emptyRoomCleanupTimers.get(roomId);
    if (!timer) return false;

    clearTimeout(timer);
    this.emptyRoomCleanupTimers.delete(roomId);
    return true;
  }

  private deleteRoom(roomId: string): boolean {
    const room = this.rooms.get(roomId);
    if (!room) return false;

    this.cancelEmptyRoomCleanup(roomId);
    for (const player of room.players) {
      if (this.socketToRoom.get(player.id) === roomId) {
        this.socketToRoom.delete(player.id);
        this.socketToPlayer.delete(player.id);
      }
    }
    return this.rooms.delete(roomId);
  }

  getOpponentSocketId(room: Room, color: PlayerColor): string | null {
    return room.players.find((p) => p.color !== color)?.id || null;
  }

  logGameFinishedIfNeeded(room: Room): void {
    if (!room.winner || room.gameOverLogged) return;

    // Propagate userIds to recorder so reportGameToApi can include them
    for (const p of room.players) {
      if (p.userId) {
        room.recorder.setPlayerUserId(p.color, p.userId);
      }
    }

    room.recorder.gameFinished(room.winner ?? null, room.winReason || 'lives');
    room.gameOverLogged = true;
  }

  placeMineSetup(room: Room, color: PlayerColor, row: number, col: number) {
    if (room.phase !== 'setup') return { ok: false, error: 'Сейчас не фаза расстановки' };
    const player = room.players.find((p) => p.color === color)!;
    if (player.setupConfirmed) return { ok: false, error: 'Расстановка уже подтверждена' };
    const cell = room.board[row][col];
    if (cell.owner !== color) return { ok: false, error: 'Это не ваша клетка' };
    if (getHeadquartersOwner(row, col, room.config)) return { ok: false, error: 'Штаб нельзя заминировать' };
    if (!isPlayerCellReachable(room.board, row, col, color, room.config)) {
      return { ok: false, error: 'Мины можно ставить только в доступные клетки' };
    }
    if (cell.hasMine) {
      cell.hasMine = false;
      player.minesPlaced--;
      room.recorder.setupMine(color, row, col, false, player.minesPlaced);
      room.lastActionAt = Date.now();
      return { ok: true };
    }
    const setupLimit = color === 'red' ? room.config.initialMinesRed : room.config.initialMinesBlue;
    if (player.minesPlaced >= setupLimit) {
      return { ok: false, error: 'Достигнут лимит мин для расстановки' };
    }
    cell.hasMine = true;
    player.minesPlaced++;
    room.recorder.setupMine(color, row, col, true, player.minesPlaced);
    room.lastActionAt = Date.now();
    return { ok: true };
  }

  confirmSetup(room: Room, color: PlayerColor) {
    if (room.phase !== 'setup') return { ok: false, bothConfirmed: false, error: 'Сейчас не фаза расстановки' };
    const player = room.players.find((p) => p.color === color)!;
    const requiredMines = color === 'red' ? room.config.initialMinesRed : room.config.initialMinesBlue;
    if (player.minesPlaced !== requiredMines) {
      return { ok: false, bothConfirmed: false, error: `Place exactly ${requiredMines} mines` };
    }
    player.setupConfirmed = true;
    room.setupConfirmed.add(color);
    room.recorder.setupConfirmed(color, player.minesPlaced);
    room.lastActionAt = Date.now();
    const bothConfirmed = room.setupConfirmed.size === 2;
    if (bothConfirmed) {
      room.phase = 'phase1';
      room.turn  = createInitialTurnState('red');
      // Старт часов первого игрока
      room.turn.currentTurnStartedAtMs = Date.now();
      room.recorder.gameStarted('red');
    }
    return { ok: true, bothConfirmed };
  }

  selectZone(room: Room, color: PlayerColor, clickedRow: number, clickedCol: number) {
    if (room.turn.phase !== 'phase1') return { ok: false, error: 'Сейчас не фаза разведки' };
    if (room.turn.currentPlayer !== color) return { ok: false, error: 'Сейчас не ваш ход' };
    const displayZone = getDisplayZoneTopLeft(clickedRow, clickedCol);
    const actionZone  = getActionZoneTopLeft(clickedRow, clickedCol);
    if (!isValidZoneSelection(room.board, displayZone.row, displayZone.col, color, room.config)) {
      return { ok: false, error: 'В зоне 3×3 нет доступных клеток вашей территории' };
    }

    // Бонус за «защитную» зону: если в 5×5 попадает свой штаб — +1 мина в фазе 3.
    const defensiveZone = actionZoneContainsHeadquarters(
      actionZone.row, actionZone.col, color, room.config,
    );
    const minesAllowedThisTurn =
      room.config.minesPerTurn + (defensiveZone ? HQ_ACTION_ZONE_BONUS_MINES : 0);

    const player = room.players.find((p) => p.color === color)!;
    room.recorder.zoneSelect(color, { row: clickedRow, col: clickedCol }, displayZone, actionZone, this.getTimeLeftMs(room, color));

    room.turn.selectedZone = displayZone;
    room.turn.actionZone   = actionZone;
    room.turn.canDefuse = room.turn.defusesUsedThisTurn < room.turn.defusesPerTurn;
    room.turn.minesAllowedThisTurn = minesAllowedThisTurn;
    revealNumbersInDisplayZone(room.board, displayZone.row, displayZone.col, color, room.config);
    room.turn.phase = 'phase2';
    room.phase      = 'phase2';
    room.turn.lastAction = null;
    room.lastActionAt = Date.now();
    return { ok: true };
  }

  captureCell(room: Room, color: PlayerColor, row: number, col: number) {
    if (room.turn.phase !== 'phase2') return { ok: false, hitMine: false, gameOver: false, error: 'Сейчас не фаза захвата' };
    if (room.turn.currentPlayer !== color) return { ok: false, hitMine: false, gameOver: false, error: 'Сейчас не ваш ход' };
    if (room.turn.phase2Locked) return { ok: false, hitMine: false, gameOver: false, error: 'Захват заблокирован — завершите фазу захвата кнопкой' };
    const actionZone  = room.turn.actionZone!;
    const displayZone = room.turn.selectedZone!;
    const captured    = room.turn.capturedThisTurn as Set<string>;
    if (!canCaptureCell(room.board, row, col, color, actionZone.row, actionZone.col, room.config)) {
      return { ok: false, hitMine: false, gameOver: false, error: 'Клетка должна быть в зоне 5×5 и рядом с доступной клеткой вашей территории' };
    }
    const cell    = room.board[row][col];
    const hitMine = cell.hasMine;
    if (hitMine) {
      cell.hasMine = false;
      const player = room.players.find((p) => p.color === color)!;
      player.lives--;
      room.recorder.mineHit(color, row, col, player.lives, { timeLeftMs: this.getTimeLeftMs(room, color) });
      refreshNumbersInDisplayZone(room.board, displayZone.row, displayZone.col, color, room.config);
      // Сначала фиксируем «что произошло» — этим питается клиентский эффект
      // звука взрыва. Если этого не сделать ДО finalizeGameOver, на последнем
      // фатальном клике на мину клиент не получит lastAction и не услышит взрыв.
      room.turn.lastAction = { type: 'mine_exploded', actorColor: color, row, col, id: Date.now() };
      if (player.lives <= 0) {
        const opp = room.players.find((p) => p.color !== color)!;
        this.finalizeGameOver(room, opp.color, 'lives');
        return { ok: true, hitMine: true, gameOver: true };
      }
      // Блокируем дальнейшие захваты — только флаги и кнопка «Завершить захват».
      room.turn.phase2Locked = true;
    } else {
      this.clearMarkOnCell(room, row, col);
      cell.owner = color;
      captured.add(`${row},${col}`);
      const player = room.players.find((p) => p.color === color)!;
      room.recorder.cellOpen(color, row, col, { timeLeftMs: this.getTimeLeftMs(room, color) });
      const inDisplayZone =
        row >= displayZone.row && row < displayZone.row + 3 &&
        col >= displayZone.col && col < displayZone.col + 3 &&
        isInBounds(row, col, room.config.boardSize);
      if (inDisplayZone) {
        revealNumberForCell(room.board, row, col, color, room.config);
        refreshNumbersInDisplayZone(room.board, displayZone.row, displayZone.col, color, room.config);
      }
      if (this.checkHeadquartersCapture(room, color, row, col)) {
        return { ok: true, hitMine, gameOver: true };
      }
      room.turn.lastAction = null;
    }
    room.lastActionAt = Date.now();
    return { ok: true, hitMine, gameOver: false };
  }

  defuseCell(
    room: Room, color: PlayerColor, row: number, col: number
  ): { ok: boolean; hadMine: boolean; gameOver: boolean; error?: string } {
    if (room.turn.phase !== 'phase2') {
      return { ok: false, hadMine: false, gameOver: false, error: 'Сейчас не фаза захвата' };
    }
    if (room.turn.currentPlayer !== color) {
      return { ok: false, hadMine: false, gameOver: false, error: 'Сейчас не ваш ход' };
    }
    if (room.turn.phase2Locked) {
      return { ok: false, hadMine: false, gameOver: false, error: 'Захват заблокирован — завершите фазу захвата кнопкой' };
    }
    if (!room.turn.canDefuse || room.turn.defusesUsedThisTurn >= room.turn.defusesPerTurn) {
      return { ok: false, hadMine: false, gameOver: false, error: 'Лимит разминирований на ход исчерпан' };
    }

    const actionZone  = room.turn.actionZone!;
    const displayZone = room.turn.selectedZone!;
    const captured    = room.turn.capturedThisTurn as Set<string>;

    if (!canCaptureCell(room.board, row, col, color, actionZone.row, actionZone.col, room.config)) {
      return { ok: false, hadMine: false, gameOver: false, error: 'Клетка должна быть в зоне 5×5 и рядом с доступной клеткой вашей территории' };
    }

    const cell = room.board[row][col];
    if (cell.owner === color) {
      return { ok: false, hadMine: false, gameOver: false, error: 'Нельзя разминировать свою клетку' };
    }

    room.turn.defusesUsedThisTurn++;
    room.turn.canDefuse = room.turn.defusesUsedThisTurn < room.turn.defusesPerTurn;
    const hadMine = cell.hasMine;
    const player = room.players.find((p) => p.color === color)!;
    room.recorder.mineDefused(color, row, col, hadMine, { timeLeftMs: this.getTimeLeftMs(room, color) });

    if (hadMine) {
      this.clearMarkOnCell(room, row, col);
      cell.hasMine = false;
      cell.owner   = color;
      (room.turn.capturedThisTurn as Set<string>).add(`${row},${col}`);

      const inDisplayZone =
        row >= displayZone.row && row < displayZone.row + 3 &&
        col >= displayZone.col && col < displayZone.col + 3 &&
        isInBounds(row, col, room.config.boardSize);

      if (inDisplayZone) {
        revealNumberForCell(room.board, row, col, color, room.config);
      }

      refreshNumbersInDisplayZone(room.board, displayZone.row, displayZone.col, color, room.config);
      if (this.checkHeadquartersCapture(room, color, row, col)) {
        return { ok: true, hadMine, gameOver: true };
      }
      room.turn.lastAction = { type: 'defuse_success', actorColor: color, row, col, id: Date.now() };
    } else {
      this.clearMarkOnCell(room, row, col);
      cell.owner   = color;
      (room.turn.capturedThisTurn as Set<string>).add(`${row},${col}`);

      const inDisplayZoneNoMine =
        row >= displayZone.row && row < displayZone.row + 3 &&
        col >= displayZone.col && col < displayZone.col + 3 &&
        isInBounds(row, col, room.config.boardSize);

      if (inDisplayZoneNoMine) {
        revealNumberForCell(room.board, row, col, color, room.config);
      }
      refreshNumbersInDisplayZone(room.board, displayZone.row, displayZone.col, color, room.config);

      if (this.checkHeadquartersCapture(room, color, row, col)) {
        return { ok: true, hadMine, gameOver: true };
      }
      // Блокируем дальнейшие захваты — только флаги и кнопка «Завершить захват».
      room.turn.phase2Locked = true;
      room.turn.lastAction = { type: 'defuse_no_mine', actorColor: color };
    }

    return { ok: true, hadMine, gameOver: false };
  }

  /**
   * Аккорд: клик по своей открытой клетке с цифрой N (N ≥ 0) в фазе 2.
   *
   * Условия: фаза 2, мой ход, клетка моя, в зоне 3×3, открыта, имеет цифру.
   * Среди 8 прямых соседей должно быть ровно N моих флажков.
   *
   * Множество кандидатов на открытие строится flood-fill'ом:
   *   1) база — закрытые непомеченные 8-соседи источника;
   *   2) повторно добавляем закрытые непомеченные клетки, у которых есть
   *      8-сосед среди уже добавленных, пока множество растёт.
   * Это имитирует каскадное «открывание нулей» классического сапёра.
   *
   * Кандидаты обходятся в цикле; каждый каскадно проверяется через
   * canCaptureCell, потому что после захвата соседа цепочка достижимости
   * растёт, и кандидат, который изначально был недоступен, может стать
   * захватываемым. Поэтому идём итерационно до фиксации.
   *
   * При первой же мине — взрыв (как в captureCell), захваты прерываются,
   * фаза 3 или конец игры.
   */
  chordCapture(room: Room, color: PlayerColor, row: number, col: number):
    { ok: boolean; hitMine: boolean; gameOver: boolean; error?: string } {
    if (room.turn.phase !== 'phase2') {
      return { ok: false, hitMine: false, gameOver: false, error: 'Сейчас не фаза захвата' };
    }
    if (room.turn.currentPlayer !== color) {
      return { ok: false, hitMine: false, gameOver: false, error: 'Сейчас не ваш ход' };
    }
    if (room.turn.phase2Locked) {
      return { ok: false, hitMine: false, gameOver: false, error: 'Захват заблокирован — завершите фазу захвата кнопкой' };
    }
    const size = room.config.boardSize;
    if (!isInBounds(row, col, size)) {
      return { ok: false, hitMine: false, gameOver: false, error: 'Клетка вне поля' };
    }
    const displayZone = room.turn.selectedZone!;
    const actionZone  = room.turn.actionZone!;
    const cell = room.board[row][col];
    if (cell.owner !== color) {
      return { ok: false, hitMine: false, gameOver: false, error: 'Аккорд работает только по своей клетке' };
    }
    // Клетка должна быть в зоне 3×3 и иметь цифру (включая 0).
    const inDisplay =
      row >= displayZone.row && row < displayZone.row + 3 &&
      col >= displayZone.col && col < displayZone.col + 3;
    if (!inDisplay || !cell.isRevealed || cell.number === null) {
      return { ok: false, hitMine: false, gameOver: false, error: 'Аккорд возможен только на открытой клетке с цифрой в зоне 3×3' };
    }

    // Используем общую с фронтом функцию суммаризации, чтобы не было
    // расхождений между превью аккорда и его серверной реализацией.
    const myMarks = room.marks[color];
    const reachableOwn = getReachablePlayerCells(room.board, color, room.config);
    const { flagCount, candidates } = sharedSummarizeChord(row, col, {
      boardSize: size,
      isFlag:        (r, c) => myMarks[`${r},${c}`] === 'flag',
      isOwnedByActor:(r, c) => isInBounds(r, c, size) && room.board[r][c].owner === color,
      isReachableOwn:(r, c) => reachableOwn.has(`${r},${c}`),
    });

    if (flagCount > cell.number) {
      return { ok: false, hitMine: false, gameOver: false, error: 'Слишком много флажков для аккорда' };
    }
    if (flagCount < cell.number) {
      return { ok: false, hitMine: false, gameOver: false, error: 'Недостаточно флажков для аккорда' };
    }

    const captured = room.turn.capturedThisTurn as Set<string>;
    const player = room.players.find((p) => p.color === color)!;

    // Шаг 1: ищем мину среди кандидатов. Если есть хотя бы одна — взрывается
    // ПЕРВАЯ по порядку обхода, остальные кандидаты НЕ захватываются.
    for (const { row: r, col: c } of candidates) {
      const target = room.board[r][c];
      if (!target.hasMine) continue;
      // Проверяем доступность по правилам захвата (зона 5×5 + соседство со
      // своей территорией) — без неё взрыв тоже невозможен.
      if (!canCaptureCell(room.board, r, c, color, actionZone.row, actionZone.col, room.config)) {
        continue;
      }
      target.hasMine = false;
      player.lives--;
      room.recorder.mineHit(color, r, c, player.lives, { viaChord: true, timeLeftMs: this.getTimeLeftMs(room, color) });
      refreshNumbersInDisplayZone(room.board, displayZone.row, displayZone.col, color, room.config);
      room.turn.lastAction = { type: 'mine_exploded', actorColor: color, row: r, col: c, id: Date.now() };
      if (player.lives <= 0) {
        const opp = room.players.find((p) => p.color !== color)!;
        this.finalizeGameOver(room, opp.color, 'lives');
        return { ok: true, hitMine: true, gameOver: true };
      }
      // Не переходим автоматически в фазу 3 — игрок сам завершит фазу 2 кнопкой.
      return { ok: true, hitMine: true, gameOver: false };
    }

    // Шаг 2: мин среди кандидатов нет — захватываем все доступные клетки.
    let captureCount = 0;
    for (const { row: r, col: c } of candidates) {
      const target = room.board[r][c];
      if (target.owner === color) continue;
      if (!canCaptureCell(room.board, r, c, color, actionZone.row, actionZone.col, room.config)) continue;

      this.clearMarkOnCell(room, r, c);
      target.owner = color;
      captured.add(`${r},${c}`);
      captureCount++;
      room.recorder.cellOpen(color, r, c, { viaChord: true, timeLeftMs: this.getTimeLeftMs(room, color) });
      const targetInDisplay =
        r >= displayZone.row && r < displayZone.row + 3 &&
        c >= displayZone.col && c < displayZone.col + 3;
      if (targetInDisplay) {
        revealNumberForCell(room.board, r, c, color, room.config);
      }
      if (this.checkHeadquartersCapture(room, color, r, c)) {
        return { ok: true, hitMine: false, gameOver: true };
      }
    }

    refreshNumbersInDisplayZone(room.board, displayZone.row, displayZone.col, color, room.config);
    if (captureCount > 0) {
      room.turn.lastAction = null;
    }
    return { ok: true, hitMine: false, gameOver: false };
  }

  private clearMarkOnCell(room: Room, row: number, col: number) {
    const key = `${row},${col}`;
    room.marks['red'][key]  = 'none';
    room.marks['blue'][key] = 'none';
  }

  endPhase2(room: Room, color: PlayerColor) {
    if (room.turn.phase !== 'phase2') return { ok: false, error: 'Сейчас не фаза захвата' };
    if (room.turn.currentPlayer !== color) return { ok: false, error: 'Сейчас не ваш ход' };
    this.startPhase3(room);
    room.lastActionAt = Date.now();
    return { ok: true };
  }

  private startPhase3(room: Room, lastAction?: LastAction) {
    clearRevealedNumbers(room.board);
    room.turn.selectedZone        = null;
    room.turn.actionZone          = null;
    room.turn.phase               = 'phase3';
    room.phase                    = 'phase3';
    room.turn.minesPlacedThisTurn = 0;
    if (lastAction) room.turn.lastAction = lastAction;
  }

  /**
   * Универсальный финализатор партии. Останавливает часы текущего игрока
   * (commitTurnTime), переводит фазу в finished и чистит подсвеченные цифры.
   * Не вызывает logGameFinishedIfNeeded — это делает index.ts при рассылке.
   */
  private finalizeGameOver(room: Room, winner: PlayerColor, reason: WinReason) {
    // Если часы шли (вне setup/finished) — списываем потраченное время.
    if (room.turn.currentTurnStartedAtMs !== null) {
      this.commitTurnTime(room);
    }
    room.winner    = winner;
    room.winReason = reason;
    room.phase     = 'finished';
    room.turn.phase = 'finished';
    clearRevealedNumbers(room.board);
  }

  surrender(room: Room, color: PlayerColor): void {
    const opponent: PlayerColor = color === 'red' ? 'blue' : 'red';
    room.lastActionAt = Date.now();
    this.finalizeGameOver(room, opponent, 'surrender');
  }

  placeMinePhase3(room: Room, color: PlayerColor, row: number, col: number) {
    if (room.turn.phase !== 'phase3') return { ok: false, done: false, gameOver: false, error: 'Сейчас не фаза минирования' };
    if (room.turn.currentPlayer !== color) return { ok: false, done: false, gameOver: false, error: 'Сейчас не ваш ход' };
    if (room.turn.minesPlacedThisTurn >= room.turn.minesAllowedThisTurn) {
      return { ok: false, done: false, gameOver: false, error: 'Достигнут лимит мин на этот ход' };
    }
    const cell = room.board[row][col];
    if (cell.owner !== color) return { ok: false, done: false, gameOver: false, error: 'Это не ваша клетка' };
    if (getHeadquartersOwner(row, col, room.config)) {
      return { ok: false, done: false, gameOver: false, error: 'Штаб нельзя заминировать' };
    }
    if (!isPlayerCellReachable(room.board, row, col, color, room.config)) {
      return { ok: false, done: false, gameOver: false, error: 'Мины можно ставить только в доступные клетки' };
    }
    if (cell.hasMine)         return { ok: false, done: false, gameOver: false, error: 'Здесь уже стоит мина' };
    cell.hasMine = true;
    room.turn.minesPlacedThisTurn++;
    room.recorder.phase3Mine(color, row, col, { timeLeftMs: this.getTimeLeftMs(room, color) });
    room.lastActionAt = Date.now();
    const done = room.turn.minesPlacedThisTurn >= room.turn.minesAllowedThisTurn;
    if (done) {
      room.recorder.turnEnd(color, { timeLeftMs: this.getTimeLeftMs(room, color), turnsPlayed: room.turn.turnsPlayed });
      const gameOver = this.checkAndFinishTurn(room);
      return { ok: true, done: true, gameOver };
    }
    return { ok: true, done: false, gameOver: false };
  }

  endPhase3(room: Room, color: PlayerColor) {
    if (room.turn.phase !== 'phase3') return { ok: false, gameOver: false, error: 'Сейчас не фаза минирования' };
    if (room.turn.currentPlayer !== color) return { ok: false, gameOver: false, error: 'Сейчас не ваш ход' };
    room.recorder.turnEnd(color, { timeLeftMs: this.getTimeLeftMs(room, color), turnsPlayed: room.turn.turnsPlayed });
    room.lastActionAt = Date.now();
    const gameOver = this.checkAndFinishTurn(room);
    return { ok: true, gameOver };
  }

  private checkHeadquartersCapture(room: Room, color: PlayerColor, row: number, col: number): boolean {
    const headquartersOwner = getHeadquartersOwner(row, col, room.config);
    if (!headquartersOwner || headquartersOwner === color) return false;

    this.finalizeGameOver(room, color, 'headquarters');
    return true;
  }

  private checkAndFinishTurn(room: Room): boolean {
    const cur = room.players.find((p) => p.color === room.turn.currentPlayer)!;
    if (cur.lives <= 0) {
      const opp = room.players.find((p) => p.color !== room.turn.currentPlayer)!;
      this.finalizeGameOver(room, opp.color, 'lives');
      return true;
    }

    const untimed = room.config.timeControl.baseMs === 0;
    // Списываем потраченное на ход время и начисляем инкремент
    this.commitTurnTime(room);
    if (!untimed && cur.timeMs <= 0) {
      const opp = room.players.find((p) => p.color !== room.turn.currentPlayer)!;
      cur.timeMs = 0;
      this.finalizeGameOver(room, opp.color, 'time');
      return true;
    }
    if (!untimed) cur.timeMs += room.config.timeControl.incrementMs;

    const turnsPlayed = room.turn.turnsPlayed + 1;
    const prevDefusesPerTurn = room.turn.defusesPerTurn;
    const nextDefusesPerTurn = defusesPerTurnFor(turnsPlayed);

    // Каждые DEFUSE_GRANT_INTERVAL завершённых совместных ходов оба игрока
    // получают +1 к лимиту разминирований на ход.
    if (nextDefusesPerTurn > prevDefusesPerTurn) {
    }

    const nextColor: PlayerColor = room.turn.currentPlayer === 'red' ? 'blue' : 'red';
    room.turn  = createInitialTurnState(nextColor, turnsPlayed);
    // Старт часов следующего игрока
    room.turn.currentTurnStartedAtMs = Date.now();
    room.phase = 'phase1';
    return false;
  }

  /**
   * Списать с текущего игрока время, прошедшее с начала его хода.
   * Сбрасывает currentTurnStartedAtMs — после вызова часы не идут.
   */
/** Сколько мс осталось у игрока (с учётом времени, уже прошедшего в текущем ходу). */
  private getTimeLeftMs(room: Room, color: PlayerColor): number | undefined {
    if (room.config.timeControl.baseMs === 0) return undefined;
    const p = room.players.find((pp) => pp.color === color);
    if (!p) return undefined;
    const startedAt = room.turn.currentTurnStartedAtMs;
    if (room.turn.currentPlayer === color && startedAt !== null) {
      return Math.max(0, p.timeMs - (Date.now() - startedAt));
    }
    return Math.max(0, p.timeMs);
  }

  private commitTurnTime(room: Room): void {
    const startedAt = room.turn.currentTurnStartedAtMs;
    if (startedAt === null) return;
    // Режим «без таймера»: часы не идут, время не списываем.
    if (room.config.timeControl.baseMs === 0) {
      room.turn.currentTurnStartedAtMs = null;
      return;
    }
    const elapsed = Math.max(0, Date.now() - startedAt);
    const cur = room.players.find((p) => p.color === room.turn.currentPlayer);
    if (cur) {
      cur.timeMs = Math.max(0, cur.timeMs - elapsed);
    }
    room.turn.currentTurnStartedAtMs = null;
  }

  /**
   * Проверка тайм-аута: если у текущего игрока ушло всё время,
   * партия завершается, возвращается true.
   * Вызывается из периодического тика сервера.
   */
  checkTimeout(room: Room): boolean {
    if (room.phase === 'waiting' || room.phase === 'setup' || room.phase === 'finished') {
      return false;
    }
    // Режим «без таймера»: timeout невозможен.
    if (room.config.timeControl.baseMs === 0) return false;
    const startedAt = room.turn.currentTurnStartedAtMs;
    if (startedAt === null) return false;
    const cur = room.players.find((p) => p.color === room.turn.currentPlayer);
    if (!cur) return false;
    const elapsed = Date.now() - startedAt;
    if (cur.timeMs - elapsed > 0) return false;

    // Тайм-аут: списываем остаток в ноль, завершаем партию
    cur.timeMs = 0;
    room.turn.currentTurnStartedAtMs = null;
    const opp = room.players.find((p) => p.color !== cur.color)!;
    // currentTurnStartedAtMs уже сброшен выше, finalizeGameOver просто меняет статус
    this.finalizeGameOver(room, opp.color, 'time');
    return true;
  }

  /** Перебрать все комнаты, вернуть те, где сработал тайм-аут или inactivity — нужно разослать gameState/gameOver. */
  tickTimeouts(): Room[] {
    const finished: Room[] = [];
    for (const room of this.rooms.values()) {
      if (room.phase === 'finished') continue;
      if (this.checkTimeout(room)) { finished.push(room); continue; }
      if (this.checkInactivity(room)) { finished.push(room); }
    }
    return finished;
  }

  /**
   * Проверить бездействие игроков. Применяется только к играм без таймера
   * (timeControl.baseMs === 0). Если с момента последнего хода прошло ≥24ч,
   * партия завершается как 'aborted' — проигрывает тот, чья сейчас очередь.
   */
  private checkInactivity(room: Room): boolean {
    // Только игры без таймера (включая игры с ботом)
    if (room.config.timeControl.baseMs !== 0) return false;
    // Только в активных фазах
    if (room.phase !== 'setup' && room.phase !== 'phase1' &&
        room.phase !== 'phase2' && room.phase !== 'phase3') return false;
    const LIMIT_MS = 24 * 60 * 60 * 1000; // 24 часа
    if (Date.now() - room.lastActionAt < LIMIT_MS) return false;

    // Проигрывает тот, чей сейчас ход (не сделал ход за 24 часа)
    const currentPlayer = room.turn.currentPlayer;
    const winner: PlayerColor = currentPlayer === 'red' ? 'blue' : 'red';
    this.finalizeGameOver(room, winner, 'aborted');
    return true;
  }

  toggleMark(room: Room, color: PlayerColor, row: number, col: number, mark: CellMark) {
    const cell = room.board[row][col];
    if (cell.owner === color) return { ok: false, error: 'Нельзя ставить метку на свою клетку' };
    room.marks[color][`${row},${col}`] = mark;
    return { ok: true };
  }

  getBoardForPlayer(room: Room, color: PlayerColor) {
    // По окончании партии открываем расположение всех мин обоим игрокам и
    // убираем флажки/вопросы — это превращает финальное поле в «итоговую карту».
    // Режим отладки (env DEBUG_REVEAL_BOARD=1) — отдаём полное поле всегда.
    if (room.phase === 'finished' || process.env.DEBUG_REVEAL_BOARD === '1') {
      return room.board.map((row) =>
        row.map((cell) => ({
          owner: cell.owner,
          hasMine: cell.hasMine,
          isRevealed: cell.isRevealed,
          number: cell.number,
          mark: 'none' as const,
        })),
      );
    }

    const board   = getBoardForPlayer(room.board, color);
    const myMarks = room.marks[color];
    for (const [key, mark] of Object.entries(myMarks)) {
      const [r, c] = key.split(',').map(Number);
      if (isInBounds(r, c, room.config.boardSize)) board[r][c].mark = mark;
    }
    return board;
  }

  /**
   * Сериализует состояние движка для отправки боту через botTurn событие.
   * Включает все данные (в том числе расположение мин обоих игроков) —
   * безопасно, т.к. человек и бот в одной вкладке браузера.
   */
  serializeEngineState(room: Room, botColor: PlayerColor, difficulty: 'easy' | 'normal' | 'hard'): import('@minesweeper-pvp/shared').BotTurnSnapshot {
    return {
      botColor,
      difficulty,
      phase: room.phase,
      board: room.board.map((row) => row.map((cell) => ({ ...cell }))),
      players: room.players.map((p) => ({
        color: p.color,
        name: p.name,
        lives: p.lives,
        minesPlaced: p.minesPlaced,
        setupConfirmed: p.setupConfirmed,
        timeMs: p.timeMs,
      })),
      turn: {
        phase: room.turn.phase,
        currentPlayer: room.turn.currentPlayer,
        selectedZone: room.turn.selectedZone,
        actionZone: room.turn.actionZone,
        canDefuse: room.turn.canDefuse,
        phase2Locked: room.turn.phase2Locked ?? false,
        minesPlacedThisTurn: room.turn.minesPlacedThisTurn,
        minesAllowedThisTurn: room.turn.minesAllowedThisTurn,
        capturedThisTurn: Array.from(room.turn.capturedThisTurn as Set<string>),
        lastAction: room.turn.lastAction ?? null,
        turnsPlayed: room.turn.turnsPlayed,
        defusesPerTurn: room.turn.defusesPerTurn,
        defusesUsedThisTurn: room.turn.defusesUsedThisTurn,
        currentTurnStartedAtMs: room.turn.currentTurnStartedAtMs,
        serverNowMs: Date.now(),
      },
      setupConfirmed: Array.from(room.setupConfirmed) as PlayerColor[],
      config: room.config,
    };
  }

  getGameStateForPlayer(room: Room, color: PlayerColor) {
    return {
      board:       this.getBoardForPlayer(room, color),
      players:     room.players.map(({ ip, tabId, ...player }) => player),
      turn: {
        ...room.turn,
        capturedThisTurn: Array.from(room.turn.capturedThisTurn as Set<string>),
        serverNowMs: Date.now(),
      },
      config:      room.config,
      stats:       computeBoardStats(room.board),
      winnerColor: room.winner,
    };
  }
}
