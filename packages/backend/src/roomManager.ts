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
import { createGameLogger, GameLogger } from './gameLogger';
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
  id: string;          // текущий socket.id
  tabId: string;       // уникальный id вкладки браузера
  color: PlayerColor;
  name: string;
  ip?: string;
  lives: number;
  minesPlaced: number;
  connected: boolean;
  setupConfirmed: boolean;
  /** Оставшееся время на партию в миллисекундах. */
  timeMs: number;
}

export type WinReason = 'lives' | 'headquarters' | 'time';

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
  logger: GameLogger;
  gameOverLogged: boolean;
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
    // 5 заглавных латинских букв (без цифр и схожих символов) — короче и
    // удобнее передавать голосом другу.
    const LETTERS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
    let id = '';
    for (let i = 0; i < 5; i++) {
      id += LETTERS[Math.floor(Math.random() * LETTERS.length)];
    }
    return id;
  }

  createRoom(
    socketId: string,
    tabId: string,
    playerName: string,
    ip: string,
    timeControl?: TimeControl,
  ): Room {
    const roomId     = this.generateRoomId();
    const tc         = normalizeTimeControl(timeControl);
    const fullConfig: GameConfig = { ...DEFAULT_CONFIG, timeControl: tc };
    const board      = createBoard(fullConfig.boardSize);
    initBoard(board, fullConfig);

    const logger = createGameLogger(roomId, {
      color: 'red',
      name: playerName,
      ip,
    });

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
      logger,
      gameOverLogged: false,
    };

    this.rooms.set(roomId, room);
    this.socketToRoom.set(socketId, roomId);
    this.socketToPlayer.set(socketId, 'red');
    return room;
  }

  joinRoom(socketId: string, tabId: string, roomId: string, playerName: string, ip: string): Room | null {
    const room = this.rooms.get(roomId);
    if (!room || room.players.length >= 2) return null;

    room.players.push({
      id: socketId,
      tabId,
      color: 'blue',
      name: playerName,
      ip,
      lives: room.config.maxLives,
      minesPlaced: 0,
      connected: true,
      setupConfirmed: false,
      timeMs: room.config.timeControl.baseMs,
    });
    room.phase      = 'setup';
    room.turn.phase = 'setup';
    room.logger.setPlayers(room.players.map((player) => ({
      color: player.color,
      name: player.name,
      ip: player.ip,
    })));
    room.logger.event('player_joined', {
      player: { color: 'blue', name: playerName, ip },
    });

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

    room.logger.event('session_restored', {
      player: { color: playerColor, name: player.name, ip: player.ip },
      tabId,
    });

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
      room.logger.event('player_left', {
        player: { color: player.color, name: player.name, ip: player.ip },
      });
      room.players.splice(idx, 1);
      room.logger.setPlayers(room.players.map((p) => ({
        id: p.id, color: p.color, name: p.name, ip: p.ip,
      })));
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
        room.logger.event('player_disconnected', {
          player: { color: player.color, name: player.name, ip: player.ip },
        });
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
    room.logger.event('room_deleted', { reason: 'empty_room_cleanup' });
    return this.rooms.delete(roomId);
  }

  getOpponentSocketId(room: Room, color: PlayerColor): string | null {
    return room.players.find((p) => p.color !== color)?.id || null;
  }

  logGameFinishedIfNeeded(room: Room): void {
    if (!room.winner || room.gameOverLogged) return;

    const winner = room.players.find((p) => p.color === room.winner);
    const loser = room.players.find((p) => p.color !== room.winner);
    const stats = computeBoardStats(room.board);

    room.logger.event('game_finished', {
      winner: winner ? { color: winner.color, name: winner.name, ip: winner.ip } : { color: room.winner },
      loser: loser ? { color: loser.color, name: loser.name, ip: loser.ip } : null,
      reason: room.winReason || 'lives',
      stats,
      turnsPlayed: room.turn.turnsPlayed,
    });
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
      room.logger.event('setup_mine_toggled', {
        player: { color, name: player.name, ip: player.ip },
        row,
        col,
        hasMine: false,
        minesPlaced: player.minesPlaced,
      });
      return { ok: true };
    }
    const setupLimit = color === 'red' ? room.config.initialMinesRed : room.config.initialMinesBlue;
    if (player.minesPlaced >= setupLimit) {
      return { ok: false, error: 'Достигнут лимит мин для расстановки' };
    }
    cell.hasMine = true;
    player.minesPlaced++;
    room.logger.event('setup_mine_toggled', {
      player: { color, name: player.name, ip: player.ip },
      row,
      col,
      hasMine: true,
      minesPlaced: player.minesPlaced,
    });
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
    room.logger.event('setup_confirmed', {
      player: { color, name: player.name, ip: player.ip },
      minesPlaced: player.minesPlaced,
    });
    const bothConfirmed = room.setupConfirmed.size === 2;
    if (bothConfirmed) {
      room.phase = 'phase1';
      room.turn  = createInitialTurnState('red');
      // Старт часов первого игрока
      room.turn.currentTurnStartedAtMs = Date.now();
      room.logger.event('game_started', {
        firstPlayer: 'red',
        players: room.players.map((p) => ({ color: p.color, name: p.name, ip: p.ip })),
        timeControl: room.config.timeControl,
      });
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
    room.logger.event('zone_selected', {
      player: { color, name: player.name, ip: player.ip },
      clicked: { row: clickedRow, col: clickedCol },
      displayZone,
      actionZone,
      defusesPerTurn: room.turn.defusesPerTurn,
      defensiveZone,
      minesAllowedThisTurn,
    });

    room.turn.selectedZone = displayZone;
    room.turn.actionZone   = actionZone;
    room.turn.canDefuse = room.turn.defusesUsedThisTurn < room.turn.defusesPerTurn;
    room.turn.minesAllowedThisTurn = minesAllowedThisTurn;
    revealNumbersInDisplayZone(room.board, displayZone.row, displayZone.col, color, room.config);
    room.turn.phase = 'phase2';
    room.phase      = 'phase2';
    room.turn.lastAction = null;
    return { ok: true };
  }

  captureCell(room: Room, color: PlayerColor, row: number, col: number) {
    if (room.turn.phase !== 'phase2') return { ok: false, hitMine: false, gameOver: false, error: 'Сейчас не фаза захвата' };
    if (room.turn.currentPlayer !== color) return { ok: false, hitMine: false, gameOver: false, error: 'Сейчас не ваш ход' };
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
      room.logger.event('mine_exploded', {
        player: { color, name: player.name, ip: player.ip },
        row,
        col,
        livesLeft: player.lives,
      });
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
      this.startPhase3(room);
    } else {
      this.clearMarkOnCell(room, row, col);
      cell.owner = color;
      captured.add(`${row},${col}`);
      const player = room.players.find((p) => p.color === color)!;
      room.logger.event('cell_captured', {
        player: { color, name: player.name, ip: player.ip },
        row,
        col,
        capturedThisTurn: captured.size,
      });
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
    room.logger.event('cell_defused', {
      player: { color, name: player.name, ip: player.ip },
      row,
      col,
      hadMine,
      defusesUsedThisTurn: room.turn.defusesUsedThisTurn,
      defusesPerTurn: room.turn.defusesPerTurn,
    });

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
      if (this.checkHeadquartersCapture(room, color, row, col)) {
        return { ok: true, hadMine, gameOver: true };
      }
      this.startPhase3(room, { type: 'defuse_no_mine', actorColor: color });
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
    room.logger.event('chord_started', {
      player: { color, name: player.name, ip: player.ip },
      row,
      col,
      number: cell.number,
      flagCount,
      candidatesCount: candidates.length,
    });

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
      room.logger.event('mine_exploded', {
        player: { color, name: player.name, ip: player.ip },
        row: r,
        col: c,
        livesLeft: player.lives,
        viaChord: true,
      });
      refreshNumbersInDisplayZone(room.board, displayZone.row, displayZone.col, color, room.config);
      room.turn.lastAction = { type: 'mine_exploded', actorColor: color, row: r, col: c, id: Date.now() };
      room.logger.event('chord_finished', {
        player: { color, name: player.name, ip: player.ip },
        row,
        col,
        captureCount: 0,
        hitMine: true,
        mineRow: r,
        mineCol: c,
      });
      if (player.lives <= 0) {
        const opp = room.players.find((p) => p.color !== color)!;
        this.finalizeGameOver(room, opp.color, 'lives');
        return { ok: true, hitMine: true, gameOver: true };
      }
      this.startPhase3(room);
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
      const targetInDisplay =
        r >= displayZone.row && r < displayZone.row + 3 &&
        c >= displayZone.col && c < displayZone.col + 3;
      if (targetInDisplay) {
        revealNumberForCell(room.board, r, c, color, room.config);
      }
      if (this.checkHeadquartersCapture(room, color, r, c)) {
        room.logger.event('chord_finished', {
          player: { color, name: player.name, ip: player.ip },
          row,
          col,
          captureCount,
          hitMine: false,
          headquarters: true,
        });
        return { ok: true, hitMine: false, gameOver: true };
      }
    }

    refreshNumbersInDisplayZone(room.board, displayZone.row, displayZone.col, color, room.config);
    if (captureCount > 0) {
      room.turn.lastAction = null;
    }
    room.logger.event('chord_finished', {
      player: { color, name: player.name, ip: player.ip },
      row,
      col,
      captureCount,
      hitMine: false,
    });
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
    const player = room.players.find((p) => p.color === color)!;
    room.logger.event('phase2_ended', {
      player: { color, name: player.name, ip: player.ip },
      capturedThisTurn: Array.from(room.turn.capturedThisTurn as Set<string>),
      defusesUsedThisTurn: room.turn.defusesUsedThisTurn,
      defusesPerTurn: room.turn.defusesPerTurn,
    });
    this.startPhase3(room);
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
    const player = room.players.find((p) => p.color === color)!;
    room.logger.event('phase3_mine_placed', {
      player: { color, name: player.name, ip: player.ip },
      row,
      col,
      minesPlacedThisTurn: room.turn.minesPlacedThisTurn,
    });
    const done = room.turn.minesPlacedThisTurn >= room.turn.minesAllowedThisTurn;
    if (done) {
      room.logger.event('phase3_ended', {
        player: { color, name: player.name, ip: player.ip },
        minesPlacedThisTurn: room.turn.minesPlacedThisTurn,
        reason: 'mine_limit_reached',
      });
      const gameOver = this.checkAndFinishTurn(room);
      return { ok: true, done: true, gameOver };
    }
    return { ok: true, done: false, gameOver: false };
  }

  endPhase3(room: Room, color: PlayerColor) {
    if (room.turn.phase !== 'phase3') return { ok: false, gameOver: false, error: 'Сейчас не фаза минирования' };
    if (room.turn.currentPlayer !== color) return { ok: false, gameOver: false, error: 'Сейчас не ваш ход' };
    const player = room.players.find((p) => p.color === color)!;
    room.logger.event('phase3_ended', {
      player: { color, name: player.name, ip: player.ip },
      minesPlacedThisTurn: room.turn.minesPlacedThisTurn,
    });
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
      room.logger.event('defuses_granted', {
        turnsPlayed,
        defusesPerTurn: nextDefusesPerTurn,
        delta: nextDefusesPerTurn - prevDefusesPerTurn,
      });
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
    room.logger.event('time_out', {
      player: { color: cur.color, name: cur.name, ip: cur.ip },
    });
    return true;
  }

  /** Перебрать все комнаты, вернуть те, где сработал тайм-аут — нужно разослать gameState/gameOver. */
  tickTimeouts(): Room[] {
    const finished: Room[] = [];
    for (const room of this.rooms.values()) {
      if (this.checkTimeout(room)) finished.push(room);
    }
    return finished;
  }

  toggleMark(room: Room, color: PlayerColor, row: number, col: number, mark: CellMark) {
    const cell = room.board[row][col];
    if (cell.owner === color) return { ok: false, error: 'Нельзя ставить метку на свою клетку' };
    room.marks[color][`${row},${col}`] = mark;
    const player = room.players.find((p) => p.color === color)!;
    room.logger.event('mark_toggled', {
      player: { color, name: player.name, ip: player.ip },
      row,
      col,
      mark,
    });
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

  getGameStateForPlayer(room: Room, color: PlayerColor) {
    return {
      board:       this.getBoardForPlayer(room, color),
      players:     room.players.map(({ ip, ...player }) => player),
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
