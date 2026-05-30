import {
  CellState,
  ClientCellState,
  GameConfig,
  PlayerColor,
  TurnState,
  // Shared helpers / constants
  ORTHOGONAL_DIRECTIONS,
  ACTION_ZONE_SIZE,
  DISPLAY_ZONE_SIZE,
  isInBounds,
  cellKey,
  getReachablePlayerCells as sharedGetReachablePlayerCells,
  isPlayerCellReachable as sharedIsPlayerCellReachable,
  getHeadquartersCells as sharedGetHeadquartersCells,
  isHeadquartersCellOf,
  getHeadquartersOwner as sharedGetHeadquartersOwner,
  getDisplayZoneTopLeft as sharedGetDisplayZoneTopLeft,
  getActionZoneTopLeft as sharedGetActionZoneTopLeft,
  BALANCE,
  DEFAULT_TIME_CONTROL as BALANCE_DEFAULT_TIME_CONTROL,
} from '@minesweeper-pvp/shared';

// Реэкспорт значения из shared, чтобы существующие импорты не сломались.
export const DEFAULT_TIME_CONTROL = BALANCE_DEFAULT_TIME_CONTROL;

export const DEFAULT_CONFIG: GameConfig = {
  boardSize:    BALANCE.board.size,
  maxLives:     BALANCE.player.maxLives,
  minesPerTurn: BALANCE.phase3.minesPerTurn,
  initialMines: BALANCE.board.initialMines,
  timeControl:  DEFAULT_TIME_CONTROL,
};

export function createBoard(size: number): CellState[][] {
  return Array.from({ length: size }, () =>
    Array.from({ length: size }, () => ({
      owner: null as PlayerColor | null,
      hasMine: false,
      isRevealed: false,
      number: null,
      mark: 'none' as const,
    }))
  );
}

export function initBoard(board: CellState[][], config: GameConfig): void {
  const size = config.boardSize;
  for (let r = 0; r < size; r++) {
    for (let c = 0; c < size; c++) {
      board[r][c].owner = r < size / 2 ? 'red' : 'blue';
    }
  }
}

// Re-export shared bounds helper для обратной совместимости с остальным backend-кодом.
export { isInBounds };

export function countAdjacentEnemyMines(
  board: CellState[][],
  row: number,
  col: number,
  playerColor: PlayerColor,
  size: number
): number {
  let count = 0;
  for (let dr = -1; dr <= 1; dr++) {
    for (let dc = -1; dc <= 1; dc++) {
      if (dr === 0 && dc === 0) continue;
      const nr = row + dr;
      const nc = col + dc;
      if (isInBounds(nr, nc, size)) {
        const cell = board[nr][nc];
        if (cell.hasMine && cell.owner !== playerColor) {
          count++;
        }
      }
    }
  }
  return count;
}

export function revealNumbersInDisplayZone(
  board: CellState[][],
  displayZoneRow: number,
  displayZoneCol: number,
  playerColor: PlayerColor,
  config: GameConfig
): void {
  for (let dr = 0; dr < DISPLAY_ZONE_SIZE; dr++) {
    for (let dc = 0; dc < DISPLAY_ZONE_SIZE; dc++) {
      const r = displayZoneRow + dr;
      const c = displayZoneCol + dc;
      if (!isInBounds(r, c, config.boardSize)) continue;
      const cell = board[r][c];
      if (cell.owner === playerColor) {
        cell.isRevealed = true;
        cell.number = countAdjacentEnemyMines(
          board, r, c, playerColor, config.boardSize
        );
      }
    }
  }
}

// Пересчитываем цифры для всех уже открытых клеток в зоне 3x3
// Вызывается после любого изменения мин в зоне (захват, разминирование)
export function refreshNumbersInDisplayZone(
  board: CellState[][],
  displayZoneRow: number,
  displayZoneCol: number,
  playerColor: PlayerColor,
  config: GameConfig
): void {
  for (let dr = 0; dr < DISPLAY_ZONE_SIZE; dr++) {
    for (let dc = 0; dc < DISPLAY_ZONE_SIZE; dc++) {
      const r = displayZoneRow + dr;
      const c = displayZoneCol + dc;
      if (!isInBounds(r, c, config.boardSize)) continue;
      const cell = board[r][c];
      // Пересчитываем только уже открытые клетки игрока
      if (cell.owner === playerColor && cell.isRevealed) {
        cell.number = countAdjacentEnemyMines(
          board, r, c, playerColor, config.boardSize
        );
      }
    }
  }
}

export function revealNumberForCell(
  board: CellState[][],
  row: number,
  col: number,
  playerColor: PlayerColor,
  config: GameConfig
): void {
  const cell = board[row][col];
  if (cell.owner === playerColor) {
    cell.isRevealed = true;
    cell.number = countAdjacentEnemyMines(
      board, row, col, playerColor, config.boardSize
    );
  }
}

export function clearRevealedNumbers(board: CellState[][]): void {
  for (const row of board) {
    for (const cell of row) {
      cell.isRevealed = false;
      cell.number = null;
    }
  }
}

export const getDisplayZoneTopLeft = sharedGetDisplayZoneTopLeft;
export const getActionZoneTopLeft = sharedGetActionZoneTopLeft;

export function getReachablePlayerCells(
  board: CellState[][],
  playerColor: PlayerColor,
  config: GameConfig
): Set<string> {
  return sharedGetReachablePlayerCells(board, playerColor, config.boardSize);
}

export function isPlayerCellReachable(
  board: CellState[][],
  row: number,
  col: number,
  playerColor: PlayerColor,
  config: GameConfig
): boolean {
  return sharedIsPlayerCellReachable(board, row, col, playerColor, config.boardSize);
}

export function isValidZoneSelection(
  board: CellState[][],
  displayZoneRow: number,
  displayZoneCol: number,
  playerColor: PlayerColor,
  config: GameConfig
): boolean {
  const reachableCells = getReachablePlayerCells(board, playerColor, config);

  for (let dr = 0; dr < DISPLAY_ZONE_SIZE; dr++) {
    for (let dc = 0; dc < DISPLAY_ZONE_SIZE; dc++) {
      const r = displayZoneRow + dr;
      const c = displayZoneCol + dc;
      if (!isInBounds(r, c, config.boardSize)) continue;
      if (reachableCells.has(cellKey(r, c))) {
        return true;
      }
    }
  }
  return false;
}

export function canCaptureCell(
  board: CellState[][],
  row: number,
  col: number,
  playerColor: PlayerColor,
  actionZoneRow: number,
  actionZoneCol: number,
  config: GameConfig
): boolean {
  const cell = board[row][col];
  if (cell.owner === playerColor) return false;

  const inActionZone =
    row >= actionZoneRow && row < actionZoneRow + ACTION_ZONE_SIZE &&
    col >= actionZoneCol && col < actionZoneCol + ACTION_ZONE_SIZE &&
    isInBounds(row, col, config.boardSize);
  if (!inActionZone) return false;

  const reachableCells = getReachablePlayerCells(board, playerColor, config);

  for (const [dr, dc] of ORTHOGONAL_DIRECTIONS) {
    const nr = row + dr;
    const nc = col + dc;
    if (!isInBounds(nr, nc, config.boardSize)) continue;
    if (reachableCells.has(cellKey(nr, nc))) {
      return true;
    }
  }
  return false;
}

export function getHeadquartersCells(
  playerColor: PlayerColor,
  config: GameConfig
): Array<{ row: number; col: number }> {
  return sharedGetHeadquartersCells(playerColor, config.boardSize);
}

export function isHeadquartersCell(
  row: number,
  col: number,
  playerColor: PlayerColor,
  config: GameConfig
): boolean {
  return isHeadquartersCellOf(row, col, playerColor, config.boardSize);
}

export function getHeadquartersOwner(
  row: number,
  col: number,
  config: GameConfig
): PlayerColor | null {
  return sharedGetHeadquartersOwner(row, col, config.boardSize);
}

export interface BoardStats {
  redMines: number;
  blueMines: number;
  redCells: number;
  blueCells: number;
}

export function computeBoardStats(board: CellState[][]): BoardStats {
  let redMines = 0, blueMines = 0, redCells = 0, blueCells = 0;
  for (const row of board) {
    for (const cell of row) {
      if (cell.owner === 'red') {
        redCells++;
        if (cell.hasMine) redMines++;
      } else if (cell.owner === 'blue') {
        blueCells++;
        if (cell.hasMine) blueMines++;
      }
    }
  }
  return { redMines, blueMines, redCells, blueCells };
}

export function getBoardForPlayer(
  board: CellState[][],
  playerColor: PlayerColor
): ClientCellState[][] {
  return board.map((row) =>
    row.map((cell) => {
      const isOwn = cell.owner === playerColor;
      return {
        owner: cell.owner,
        hasMine: isOwn ? cell.hasMine : null,
        isRevealed: cell.isRevealed,
        number: cell.number,
        mark: cell.mark,
      };
    })
  );
}

export const INITIAL_DEFUSES_PER_TURN = BALANCE.defuse.initialPerTurn;
export const DEFUSE_GRANT_INTERVAL    = BALANCE.defuse.grantInterval;
export const HQ_ACTION_ZONE_BONUS_MINES = BALANCE.phase3.hqInActionZoneBonusMines;

// Каждые DEFUSE_GRANT_INTERVAL завершённых совместных ходов лимит разминирований
// на ход увеличивается на 1. Начальное значение — INITIAL_DEFUSES_PER_TURN.
export function defusesPerTurnFor(turnsPlayed: number): number {
  return INITIAL_DEFUSES_PER_TURN + Math.floor(turnsPlayed / DEFUSE_GRANT_INTERVAL);
}

export function actionZoneContainsHeadquarters(
  actionZoneRow: number,
  actionZoneCol: number,
  playerColor: PlayerColor,
  config: GameConfig,
): boolean {
  return sharedGetHeadquartersCells(playerColor, config.boardSize).some(({ row, col }) => (
    row >= actionZoneRow && row < actionZoneRow + ACTION_ZONE_SIZE &&
    col >= actionZoneCol && col < actionZoneCol + ACTION_ZONE_SIZE &&
    isInBounds(row, col, config.boardSize)
  ));
}

export function createInitialTurnState(
  currentPlayer: PlayerColor,
  turnsPlayed: number = 0,
  minesAllowedThisTurn: number = 0,
): TurnState {
  const defusesPerTurn = defusesPerTurnFor(turnsPlayed);
  return {
    phase: 'phase1',
    currentPlayer,
    selectedZone: null,
    actionZone: null,
    canDefuse: defusesPerTurn > 0,
    minesPlacedThisTurn: 0,
    minesAllowedThisTurn,
    capturedThisTurn: new Set<string>(),
    lastActionMessage: null,
    turnsPlayed,
    defusesPerTurn,
    defusesUsedThisTurn: 0,
    currentTurnStartedAtMs: null,
    serverNowMs: Date.now(),
  };
}
