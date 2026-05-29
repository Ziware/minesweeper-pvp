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
}

export interface GameConfig {
  boardSize: number;
  totalMines: number;
  maxLives: number;
  minesPerTurn: number;
  initialMines: number;
  turnLimitPerPlayer: number;
}

export interface BoardStats {
  redMines: number;
  blueMines: number;
  redCells: number;
  blueCells: number;
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
  lastActionMessage: string | null;
  // Общий счётчик завершённых ходов обоих игроков (1 ход = одно завершение хода любым игроком)
  turnsPlayed: number;
  // Сколько разминирований доступно текущему игроку в этом ходу
  defusesPerTurn: number;
  // Сколько уже использовано в этом ходу
  defusesUsedThisTurn: number;
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
  reason: 'lives' | 'headquarters' | 'territory';
}

export interface C2S_CreateRoom { playerName: string; }
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
}

export interface ClientToServerEvents {
  createRoom:      (data: C2S_CreateRoom) => void;
  joinRoom:        (data: C2S_JoinRoom) => void;
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
