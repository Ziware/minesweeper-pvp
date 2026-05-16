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

export function isValidZoneSelection(
  board: CellState[][],
  displayZoneRow: number,
  displayZoneCol: number,
  playerColor: PlayerColor,
  config: GameConfig
): boolean {
  for (let dr = 0; dr < 3; dr++) {
    for (let dc = 0; dc < 3; dc++) {
      const r = displayZoneRow + dr;
      const c = displayZoneCol + dc;
      if (!isInBounds(r, c, config.boardSize)) continue;
      if (board[r][c].owner === playerColor) {
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
  capturedThisTurn: Set<string>,
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

  for (let dr = -1; dr <= 1; dr++) {
    for (let dc = -1; dc <= 1; dc++) {
      if (dr === 0 && dc === 0) continue;
      const nr = row + dr;
      const nc = col + dc;
      if (!isInBounds(nr, nc, config.boardSize)) continue;
      if (
        board[nr][nc].owner === playerColor ||
        capturedThisTurn.has(`${nr},${nc}`)
      ) {
        return true;
      }
    }
  }
  return false;
}

export function countFreePlayerCells(
  board: CellState[][],
  playerColor: PlayerColor
): number {
  let count = 0;
  for (const row of board) {
    for (const cell of row) {
      if (cell.owner === playerColor && !cell.hasMine) count++;
    }
  }
  return count;
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

export function createInitialTurnState(currentPlayer: PlayerColor): TurnState {
  return {
    phase: 'phase1',
    currentPlayer,
    selectedZone: null,
    actionZone: null,
    canDefuse: true,
    minesPlacedThisTurn: 0,
    capturedThisTurn: new Set<string>(),
    lastActionMessage: null,
  };
}
