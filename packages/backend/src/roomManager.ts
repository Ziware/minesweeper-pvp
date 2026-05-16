import {
  CellState,
  GameConfig,
  GamePhase,
  PlayerColor,
  TurnState,
  CellMark,
} from '@minesweeper-pvp/shared';
import {
  DEFAULT_CONFIG,
  createBoard,
  initBoard,
  revealNumbersInDisplayZone,
  refreshNumbersInDisplayZone,
  revealNumberForCell,
  clearRevealedNumbers,
  isValidZoneSelection,
  canCaptureCell,
  countFreePlayerCells,
  getBoardForPlayer,
  createInitialTurnState,
  getDisplayZoneTopLeft,
  getActionZoneTopLeft,
  isInBounds,
  computeBoardStats,
} from './gameLogic';

export interface PlayerState {
  id: string;
  color: PlayerColor;
  lives: number;
  minesPlaced: number;
  connected: boolean;
  setupConfirmed: boolean;
}

export interface Room {
  id: string;
  config: GameConfig;
  board: CellState[][];
  players: PlayerState[];
  phase: GamePhase;
  turn: TurnState;
  setupConfirmed: Set<PlayerColor>;
  winner?: PlayerColor;
  winReason?: 'lives' | 'no_mines_space';
  marks: Record<PlayerColor, Record<string, CellMark>>;
}

export class RoomManager {
  private rooms: Map<string, Room> = new Map();
  private socketToRoom: Map<string, string> = new Map();
  private socketToPlayer: Map<string, PlayerColor> = new Map();

  generateRoomId(): string {
    return Math.random().toString(36).substring(2, 8).toUpperCase();
  }

  createRoom(socketId: string, config: Partial<GameConfig> = {}): Room {
    const roomId = this.generateRoomId();
    const fullConfig: GameConfig = { ...DEFAULT_CONFIG, ...config };
    const board = createBoard(fullConfig.boardSize);
    initBoard(board, fullConfig);

    const room: Room = {
      id: roomId,
      config: fullConfig,
      board,
      players: [{
        id: socketId,
        color: 'red',
        lives: fullConfig.maxLives,
        minesPlaced: 0,
        connected: true,
        setupConfirmed: false,
      }],
      phase: 'waiting',
      turn: {
        phase: 'waiting',
        currentPlayer: 'red',
        selectedZone: null,
        actionZone: null,
        canDefuse: true,
        minesPlacedThisTurn: 0,
        capturedThisTurn: new Set(),
        lastActionMessage: null,
      },
      setupConfirmed: new Set(),
      marks: { red: {}, blue: {} },
    };

    this.rooms.set(roomId, room);
    this.socketToRoom.set(socketId, roomId);
    this.socketToPlayer.set(socketId, 'red');
    return room;
  }

  joinRoom(socketId: string, roomId: string): Room | null {
    const room = this.rooms.get(roomId);
    if (!room || room.players.length >= 2) return null;

    room.players.push({
      id: socketId,
      color: 'blue',
      lives: room.config.maxLives,
      minesPlaced: 0,
      connected: true,
      setupConfirmed: false,
    });
    room.phase = 'setup';
    room.turn.phase = 'setup';

    this.socketToRoom.set(socketId, roomId);
    this.socketToPlayer.set(socketId, 'blue');
    return room;
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

  removePlayer(socketId: string): { room: Room | null; color: PlayerColor | null } {
    const room = this.getRoom(socketId);
    const color = this.getPlayerColor(socketId);
    if (room) {
      const player = room.players.find((p) => p.id === socketId);
      if (player) player.connected = false;
    }
    this.socketToRoom.delete(socketId);
    this.socketToPlayer.delete(socketId);
    return { room, color };
  }

  getOpponentSocketId(room: Room, color: PlayerColor): string | null {
    return room.players.find((p) => p.color !== color)?.id || null;
  }

  placeMineSetup(
    room: Room, color: PlayerColor, row: number, col: number
  ): { ok: boolean; error?: string } {
    if (room.phase !== 'setup') return { ok: false, error: 'Not setup phase' };
    const player = room.players.find((p) => p.color === color)!;
    if (player.setupConfirmed) return { ok: false, error: 'Already confirmed' };

    const cell = room.board[row][col];
    if (cell.owner !== color) return { ok: false, error: 'Not your cell' };

    if (cell.hasMine) {
      cell.hasMine = false;
      player.minesPlaced--;
      return { ok: true };
    }
    if (player.minesPlaced >= room.config.initialMines) {
      return { ok: false, error: 'Max mines placed' };
    }
    cell.hasMine = true;
    player.minesPlaced++;
    return { ok: true };
  }

  confirmSetup(
    room: Room, color: PlayerColor
  ): { ok: boolean; bothConfirmed: boolean; error?: string } {
    if (room.phase !== 'setup') {
      return { ok: false, bothConfirmed: false, error: 'Not setup phase' };
    }
    const player = room.players.find((p) => p.color === color)!;
    if (player.minesPlaced !== room.config.initialMines) {
      return { ok: false, bothConfirmed: false, error: `Place exactly ${room.config.initialMines} mines` };
    }
    player.setupConfirmed = true;
    room.setupConfirmed.add(color);

    const bothConfirmed = room.setupConfirmed.size === 2;
    if (bothConfirmed) {
      room.phase = 'phase1';
      room.turn = createInitialTurnState('red');
    }
    return { ok: true, bothConfirmed };
  }

  selectZone(
    room: Room, color: PlayerColor, clickedRow: number, clickedCol: number
  ): { ok: boolean; error?: string } {
    if (room.turn.phase !== 'phase1') return { ok: false, error: 'Not phase 1' };
    if (room.turn.currentPlayer !== color) return { ok: false, error: 'Not your turn' };

    const displayZone = getDisplayZoneTopLeft(clickedRow, clickedCol);
    const actionZone  = getActionZoneTopLeft(clickedRow, clickedCol);

    if (!isValidZoneSelection(room.board, displayZone.row, displayZone.col, color, room.config)) {
      return { ok: false, error: 'В зоне 3×3 нет ваших свободных клеток' };
    }

    room.turn.selectedZone = displayZone;
    room.turn.actionZone   = actionZone;

    revealNumbersInDisplayZone(
      room.board, displayZone.row, displayZone.col, color, room.config
    );

    room.turn.phase = 'phase2';
    room.phase = 'phase2';
    room.turn.lastActionMessage = null;
    return { ok: true };
  }

  captureCell(
    room: Room, color: PlayerColor, row: number, col: number
  ): { ok: boolean; hitMine: boolean; gameOver: boolean; error?: string } {
    if (room.turn.phase !== 'phase2') {
      return { ok: false, hitMine: false, gameOver: false, error: 'Not phase 2' };
    }
    if (room.turn.currentPlayer !== color) {
      return { ok: false, hitMine: false, gameOver: false, error: 'Not your turn' };
    }

    const actionZone  = room.turn.actionZone!;
    const displayZone = room.turn.selectedZone!;
    const captured    = room.turn.capturedThisTurn as Set<string>;

    if (!canCaptureCell(room.board, row, col, color, captured, actionZone.row, actionZone.col, room.config)) {
      return { ok: false, hitMine: false, gameOver: false, error: 'Cannot capture this cell' };
    }

    const cell    = room.board[row][col];
    const hitMine = cell.hasMine;

    if (hitMine) {
      cell.hasMine = false;
      const player = room.players.find((p) => p.color === color)!;
      player.lives--;

      // Пересчитываем цифры после удаления мины
      refreshNumbersInDisplayZone(
        room.board, displayZone.row, displayZone.col, color, room.config
      );

      // Проверяем смерть сразу после взрыва
      if (player.lives <= 0) {
        const opponent = room.players.find((p) => p.color !== color)!;
        room.winner    = opponent.color;
        room.winReason = 'lives';
        room.phase     = 'finished';
        clearRevealedNumbers(room.board);
        return { ok: true, hitMine: true, gameOver: true };
      }

      room.turn.lastActionMessage = '💥 Вы наступили на мину! Потеряна жизнь.';
      this.startPhase3(room);
    } else {
      this.clearMarkOnCell(room, row, col);
      cell.owner = color;
      captured.add(`${row},${col}`);

      const inDisplayZone =
        row >= displayZone.row && row < displayZone.row + 3 &&
        col >= displayZone.col && col < displayZone.col + 3 &&
        isInBounds(row, col, room.config.boardSize);

      if (inDisplayZone) {
        revealNumberForCell(room.board, row, col, color, room.config);
        // Пересчитываем соседние клетки в зоне — их числа могли измениться
        refreshNumbersInDisplayZone(
          room.board, displayZone.row, displayZone.col, color, room.config
        );
      }
      room.turn.lastActionMessage = null;
    }

    return { ok: true, hitMine, gameOver: false };
  }

  defuseCell(
    room: Room, color: PlayerColor, row: number, col: number
  ): { ok: boolean; hadMine: boolean; gameOver: boolean; error?: string } {
    if (room.turn.phase !== 'phase2') {
      return { ok: false, hadMine: false, gameOver: false, error: 'Not phase 2' };
    }
    if (room.turn.currentPlayer !== color) {
      return { ok: false, hadMine: false, gameOver: false, error: 'Not your turn' };
    }
    if (!room.turn.canDefuse) {
      return { ok: false, hadMine: false, gameOver: false, error: 'Already defused this turn' };
    }

    const actionZone  = room.turn.actionZone!;
    const displayZone = room.turn.selectedZone!;

    const inActionZone =
      row >= actionZone.row && row < actionZone.row + 5 &&
      col >= actionZone.col && col < actionZone.col + 5 &&
      isInBounds(row, col, room.config.boardSize);

    if (!inActionZone) {
      return { ok: false, hadMine: false, gameOver: false, error: 'Cell not in action zone' };
    }

    const cell = room.board[row][col];
    if (cell.owner === color) {
      return { ok: false, hadMine: false, gameOver: false, error: 'Cannot defuse own cell' };
    }

    room.turn.canDefuse = false;
    const hadMine = cell.hasMine;

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

      // Пересчитываем все числа в зоне 3x3 после разминирования
      refreshNumbersInDisplayZone(
        room.board, displayZone.row, displayZone.col, color, room.config
      );

      room.turn.lastActionMessage = '✅ Разминирование успешно! Клетка захвачена. Ход продолжается.';
    } else {
      this.clearMarkOnCell(room, row, col);
      cell.owner   = color;
      (room.turn.capturedThisTurn as Set<string>).add(`${row},${col}`);
      room.turn.lastActionMessage = '⚠️ Мины не оказалось. Ход переходит к фазе 3.';
      this.startPhase3(room, room.turn.lastActionMessage);
    }

    return { ok: true, hadMine, gameOver: false };
  }

  private clearMarkOnCell(room: Room, row: number, col: number): void {
    const key = `${row},${col}`;
    room.marks['red'][key]  = 'none';
    room.marks['blue'][key] = 'none';
  }

  endPhase2(room: Room, color: PlayerColor): { ok: boolean; error?: string } {
    if (room.turn.phase !== 'phase2') return { ok: false, error: 'Not phase 2' };
    if (room.turn.currentPlayer !== color) return { ok: false, error: 'Not your turn' };
    this.startPhase3(room);
    return { ok: true };
  }

  private startPhase3(room: Room, message?: string): void {
    // Убираем зоны и цифры при переходе в фазу 3
    clearRevealedNumbers(room.board);
    room.turn.selectedZone = null;
    room.turn.actionZone   = null;
    room.turn.phase        = 'phase3';
    room.phase             = 'phase3';
    room.turn.minesPlacedThisTurn = 0;
    if (message) room.turn.lastActionMessage = message;
  }

  placeMinePhase3(
    room: Room, color: PlayerColor, row: number, col: number
  ): { ok: boolean; done: boolean; gameOver: boolean; error?: string } {
    if (room.turn.phase !== 'phase3') {
      return { ok: false, done: false, gameOver: false, error: 'Not phase 3' };
    }
    if (room.turn.currentPlayer !== color) {
      return { ok: false, done: false, gameOver: false, error: 'Not your turn' };
    }

    const cell = room.board[row][col];
    if (cell.owner !== color) {
      return { ok: false, done: false, gameOver: false, error: 'Not your cell' };
    }
    if (cell.hasMine) {
      return { ok: false, done: false, gameOver: false, error: 'Already has mine' };
    }

    cell.hasMine = true;
    room.turn.minesPlacedThisTurn++;

    const done = room.turn.minesPlacedThisTurn >= room.config.minesPerTurn;
    if (done) {
      const gameOver = this.checkAndFinishTurn(room);
      return { ok: true, done: true, gameOver };
    }
    return { ok: true, done: false, gameOver: false };
  }

  private checkAndFinishTurn(room: Room): boolean {
    // Проверяем жизни текущего игрока (мог умереть раньше, но это доп. проверка)
    const cur = room.players.find((p) => p.color === room.turn.currentPlayer)!;
    if (cur.lives <= 0) {
      const opp  = room.players.find((p) => p.color !== room.turn.currentPlayer)!;
      room.winner    = opp.color;
      room.winReason = 'lives';
      room.phase     = 'finished';
      return true;
    }

    const nextColor: PlayerColor = room.turn.currentPlayer === 'red' ? 'blue' : 'red';
    if (countFreePlayerCells(room.board, nextColor) < room.config.minesPerTurn) {
      room.winner    = room.turn.currentPlayer;
      room.winReason = 'no_mines_space';
      room.phase     = 'finished';
      return true;
    }

    room.turn  = createInitialTurnState(nextColor);
    room.phase = 'phase1';
    return false;
  }

  toggleMark(
    room: Room, color: PlayerColor, row: number, col: number, mark: CellMark
  ): { ok: boolean; error?: string } {
    const cell = room.board[row][col];
    if (cell.owner === color) return { ok: false, error: 'Cannot mark own cell' };
    room.marks[color][`${row},${col}`] = mark;
    return { ok: true };
  }

  getBoardForPlayer(room: Room, color: PlayerColor) {
    const board = getBoardForPlayer(room.board, color);
    const myMarks = room.marks[color];
    for (const [key, mark] of Object.entries(myMarks)) {
      const [r, c] = key.split(',').map(Number);
      if (isInBounds(r, c, room.config.boardSize)) {
        board[r][c].mark = mark;
      }
    }
    return board;
  }

  getGameStateForPlayer(room: Room, color: PlayerColor) {
    return {
      board: this.getBoardForPlayer(room, color),
      players: room.players,
      turn: {
        ...room.turn,
        capturedThisTurn: Array.from(room.turn.capturedThisTurn as Set<string>),
      },
      config:      room.config,
      stats:       computeBoardStats(room.board),
      winnerColor: room.winner,
    };
  }
}
