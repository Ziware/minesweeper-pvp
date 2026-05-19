import {
  CellState,
  ClientCellState,
  GameConfig,
  PlayerColor,
  TurnState,
} from '@minesweeper-pvp/shared';

export const DEFAULT_CONFIG: GameConfig = {
  boardSize: 10,
  totalMines: 7,
  maxLives: 3,
  minesPerTurn: 3,
  initialMines: 7,
  turnLimitPerPlayer: 15,
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

export function isInBounds(row: number, col: number, size: number): boolean {
  return row >= 0 && row < size && col >= 0 && col < size;
}

const ORTHOGONAL_DIRECTIONS = [
  [-1, 0],
  [1, 0],
  [0, -1],
  [0, 1],
] as const;

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
  for (let dr = 0; dr < 3; dr++) {
    for (let dc = 0; dc < 3; dc++) {
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
  for (let dr = 0; dr < 3; dr++) {
    for (let dc = 0; dc < 3; dc++) {
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

export function getDisplayZoneTopLeft(
  clickedRow: number,
  clickedCol: number,
): { row: number; col: number } {
  return { row: clickedRow - 1, col: clickedCol - 1 };
}

export function getActionZoneTopLeft(
  clickedRow: number,
  clickedCol: number,
): { row: number; col: number } {
  return { row: clickedRow - 2, col: clickedCol - 2 };
}

export function getReachablePlayerCells(
  board: CellState[][],
  playerColor: PlayerColor,
  config: GameConfig
): Set<string> {
  const reachable = new Set<string>();
  const queue: Array<{ row: number; col: number }> = [];

  for (const headquartersCell of getHeadquartersCells(playerColor, config)) {
    const { row, col } = headquartersCell;
    if (!isInBounds(row, col, config.boardSize)) continue;
    if (board[row][col].owner !== playerColor) continue;

    const key = `${row},${col}`;
    reachable.add(key);
    queue.push(headquartersCell);
  }

  for (let index = 0; index < queue.length; index++) {
    const current = queue[index];
    for (const [dr, dc] of ORTHOGONAL_DIRECTIONS) {
      const nr = current.row + dr;
      const nc = current.col + dc;
      if (!isInBounds(nr, nc, config.boardSize)) continue;
      if (board[nr][nc].owner !== playerColor) continue;

      const key = `${nr},${nc}`;
      if (reachable.has(key)) continue;

      reachable.add(key);
      queue.push({ row: nr, col: nc });
    }
  }

  return reachable;
}

export function isPlayerCellReachable(
  board: CellState[][],
  row: number,
  col: number,
  playerColor: PlayerColor,
  config: GameConfig
): boolean {
  return getReachablePlayerCells(board, playerColor, config).has(`${row},${col}`);
}

export function isValidZoneSelection(
  board: CellState[][],
  displayZoneRow: number,
  displayZoneCol: number,
  playerColor: PlayerColor,
  config: GameConfig
): boolean {
  const reachableCells = getReachablePlayerCells(board, playerColor, config);

  for (let dr = 0; dr < 3; dr++) {
    for (let dc = 0; dc < 3; dc++) {
      const r = displayZoneRow + dr;
      const c = displayZoneCol + dc;
      if (!isInBounds(r, c, config.boardSize)) continue;
      if (reachableCells.has(`${r},${c}`)) {
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
    row >= actionZoneRow && row < actionZoneRow + 5 &&
    col >= actionZoneCol && col < actionZoneCol + 5 &&
    isInBounds(row, col, config.boardSize);
  if (!inActionZone) return false;

  const reachableCells = getReachablePlayerCells(board, playerColor, config);

  for (const [dr, dc] of ORTHOGONAL_DIRECTIONS) {
    const nr = row + dr;
    const nc = col + dc;
    if (!isInBounds(nr, nc, config.boardSize)) continue;
    if (reachableCells.has(`${nr},${nc}`)) {
      return true;
    }
  }
  return false;
}

export function getHeadquartersCells(
  playerColor: PlayerColor,
  config: GameConfig
): Array<{ row: number; col: number }> {
  const firstCol = Math.floor((config.boardSize - 2) / 2);
  const row = playerColor === 'red' ? 0 : config.boardSize - 1;
  return [
    { row, col: firstCol },
    { row, col: firstCol + 1 },
  ];
}

export function isHeadquartersCell(
  row: number,
  col: number,
  playerColor: PlayerColor,
  config: GameConfig
): boolean {
  return getHeadquartersCells(playerColor, config).some(
    (cell) => cell.row === row && cell.col === col
  );
}

export function getHeadquartersOwner(
  row: number,
  col: number,
  config: GameConfig
): PlayerColor | null {
  if (isHeadquartersCell(row, col, 'red', config)) return 'red';
  if (isHeadquartersCell(row, col, 'blue', config)) return 'blue';
  return null;
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

export function actionZoneContainsHeadquarters(
  actionZoneRow: number,
  actionZoneCol: number,
  playerColor: PlayerColor,
  config: GameConfig,
): boolean {
  return getHeadquartersCells(playerColor, config).some(({ row, col }) => (
    row >= actionZoneRow && row < actionZoneRow + 5 &&
    col >= actionZoneCol && col < actionZoneCol + 5 &&
    isInBounds(row, col, config.boardSize)
  ));
}

export function createInitialTurnState(
  currentPlayer: PlayerColor,
  turnsPlayed: Record<PlayerColor, number> = { red: 0, blue: 0 },
): TurnState {
  return {
    phase: 'phase1',
    currentPlayer,
    selectedZone: null,
    actionZone: null,
    canDefuse: true,
    defusesUsedThisTurn: 0,
    defusesAllowedThisTurn: 1,
    minesPlacedThisTurn: 0,
    capturedThisTurn: new Set<string>(),
    lastActionMessage: null,
    turnsPlayed: { ...turnsPlayed },
  };
}
