export type PlayerColor = 'red' | 'blue';
export type CellMark = 'none' | 'flag' | 'question';
export type GamePhase =
  | 'waiting'
  | 'setup'
  | 'phase1'
  | 'phase2'
  | 'phase3'
  | 'finished';

export interface CellState {
  owner: PlayerColor | null;
  hasMine: boolean;
  isRevealed: boolean;
  number: number | null;
  mark: CellMark;
}

export interface ClientCellState {
  owner: PlayerColor | null;
  hasMine: boolean | null;
  isRevealed: boolean;
  number: number | null;
  mark: CellMark;
}

export interface PlayerState {
  id: string;
  color: PlayerColor;
  name: string;
  lives: number;
  minesPlaced: number;
  connected: boolean;
  setupConfirmed: boolean;
  /** Оставшееся время на партию в миллисекундах. */
  timeMs: number;
}

/** Шахматные настройки времени: базовое время + инкремент за ход. */
export interface TimeControl {
  /** Базовое время на всю партию, миллисекунды. */
  baseMs: number;
  /** Прибавка за каждый завершённый ход, миллисекунды. */
  incrementMs: number;
}

export interface GameConfig {
  boardSize: number;
  maxLives: number;
  minesPerTurn: number;
  initialMinesRed: number;
  initialMinesBlue: number;
  /** Настройки шахматных часов. */
  timeControl: TimeControl;
}

export interface BoardStats {
  redMines: number;
  blueMines: number;
  redCells: number;
  blueCells: number;
}

/**
 * Тип события «последнее действие». Текст для UI собирается на клиенте,
 * чтобы для каждого игрока было видно от первого лица: «Вы…» / «Противник…».
 */
export type LastActionType =
  | 'mine_exploded'   // взрыв на мине в фазе 2
  | 'defuse_success'  // успешное разминирование с миной
  | 'defuse_no_mine'; // разминирование клетки без мины

export interface LastAction {
  type: LastActionType;
  /** Цвет игрока, который выполнил действие. */
  actorColor: PlayerColor;
}

export interface TurnState {
  phase: GamePhase;
  currentPlayer: PlayerColor;
  selectedZone: { row: number; col: number } | null;
  actionZone: { row: number; col: number } | null;
  canDefuse: boolean;
  minesPlacedThisTurn: number;
  // Лимит мин на 3-ю фазу для текущего игрока (база + бонус за зону над штабом)
  minesAllowedThisTurn: number;
  capturedThisTurn: Set<string> | string[];
  /** Последнее «громкое» действие хода (взрыв/разминирование). Сообщения собираются на клиенте. */
  lastAction: LastAction | null;
  // Общий счётчик завершённых ходов обоих игроков (1 ход = одно завершение хода любым игроком)
  turnsPlayed: number;
  // Сколько разминирований доступно текущему игроку в этом ходу
  defusesPerTurn: number;
  // Сколько уже использовано в этом ходу
  defusesUsedThisTurn: number;
  /** Время сервера (ms), когда стартовал отсчёт текущего хода. null — часы не идут (фаза setup). */
  currentTurnStartedAtMs: number | null;
  /** Текущее серверное время на момент рассылки gameState — для синхронизации часов на клиенте. */
  serverNowMs: number;
}

export interface S2C_RoomCreated { roomId: string; playerColor: PlayerColor; }
export interface S2C_RoomJoined  { roomId: string; playerColor: PlayerColor; }

export interface S2C_GameState {
  board: ClientCellState[][];
  players: PlayerState[];
  turn: Omit<TurnState, 'capturedThisTurn'> & { capturedThisTurn: string[] };
  config: GameConfig;
  stats: BoardStats;
  winnerColor?: PlayerColor;
}

export interface S2C_Error   { message: string; }
export interface S2C_GameOver {
  winnerColor: PlayerColor;
  reason: 'lives' | 'headquarters' | 'time';
}

export interface C2S_CreateRoom { playerName: string; timeControl: TimeControl; }
export interface C2S_JoinRoom   { roomId: string; playerName: string; }
export interface C2S_PlaceMine  { row: number; col: number; }
export interface C2S_SelectZone { row: number; col: number; }
export interface C2S_CaptureCell     { row: number; col: number; }
export interface C2S_DefuseCell      { row: number; col: number; }
export interface C2S_PlaceMinePhase3 { row: number; col: number; }
export interface C2S_ToggleMark { row: number; col: number; mark: CellMark; }

export interface ServerToClientEvents {
  roomCreated:        (data: S2C_RoomCreated) => void;
  roomJoined:         (data: S2C_RoomJoined) => void;
  gameState:          (data: S2C_GameState) => void;
  error:              (data: S2C_Error) => void;
  gameOver:           (data: S2C_GameOver) => void;
  waitingForOpponent: () => void;
  sessionRestored:    (data: { playerColor: PlayerColor; roomId: string }) => void;
  // Сессия больше невалидна (комната исчезла / игрок не найден / другая вкладка),
  // клиент должен очистить сохранённое состояние и вернуться в лобби без тоста.
  sessionInvalid:     (data: S2C_Error) => void;
}

export interface ClientToServerEvents {
  createRoom:      (data: C2S_CreateRoom) => void;
  joinRoom:        (data: C2S_JoinRoom) => void;
  /** Добровольный выход из комнаты (например, с экрана ожидания соперника).
   *  Если игрок уходит ОДИН — комната удаляется немедленно, без TTL. */
  leaveRoom:       () => void;
  placeMineSetup:  (data: C2S_PlaceMine) => void;
  confirmSetup:    () => void;
  selectZone:      (data: C2S_SelectZone) => void;
  captureCell:     (data: C2S_CaptureCell) => void;
  defuseCell:      (data: C2S_DefuseCell) => void;
  placeMinePhase3: (data: C2S_PlaceMinePhase3) => void;
  endPhase2:       () => void;
  endPhase3:       () => void;
  toggleMark:      (data: C2S_ToggleMark) => void;
  // tabId позволяет серверу различать вкладки одного устройства
  restoreSession:  (data: { roomId: string; playerColor: PlayerColor; tabId: string }) => void;
}
