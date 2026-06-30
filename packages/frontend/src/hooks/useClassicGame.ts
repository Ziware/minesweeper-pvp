import { useCallback, useEffect, useRef, useState } from 'react';

export interface ClassicCell {
  hasMine: boolean;
  revealed: boolean;
  flagged: boolean;
  questioned: boolean;
  adjacentMines: number;
}

export type ClassicStatus = 'idle' | 'playing' | 'won' | 'lost';

export interface ClassicPreset {
  key: string;
  label: string;
  rows: number;
  cols: number;
  mines: number;
}

export const CLASSIC_PRESETS: ClassicPreset[] = [
  { key: 'beginner',     label: '🟢 Новичок',  rows: 9,  cols: 9,  mines: 10 },
  { key: 'intermediate', label: '🟡 Любитель',  rows: 16, cols: 16, mines: 40 },
  { key: 'expert',       label: '🔴 Эксперт',   rows: 16, cols: 30, mines: 99 },
];

export interface ClassicCustom {
  rows: number;
  cols: number;
  mines: number;
}

const BEST_TIME_KEY = 'minesweeper_classic_best_';

function loadBestTime(presetKey: string): number | null {
  try {
    const v = localStorage.getItem(BEST_TIME_KEY + presetKey);
    return v ? parseInt(v, 10) : null;
  } catch { return null; }
}

function saveBestTime(presetKey: string, ms: number) {
  try { localStorage.setItem(BEST_TIME_KEY + presetKey, String(ms)); } catch { /* ignore */ }
}

function makeEmptyBoard(rows: number, cols: number): ClassicCell[][] {
  return Array.from({ length: rows }, () =>
    Array.from({ length: cols }, (): ClassicCell => ({
      hasMine: false,
      revealed: false,
      flagged: false,
      questioned: false,
      adjacentMines: 0,
    })),
  );
}

function countAdjacentMines(board: ClassicCell[][], r: number, c: number): number {
  const rows = board.length;
  const cols = board[0].length;
  let count = 0;
  for (let dr = -1; dr <= 1; dr++) {
    for (let dc = -1; dc <= 1; dc++) {
      if (dr === 0 && dc === 0) continue;
      const nr = r + dr; const nc = c + dc;
      if (nr >= 0 && nr < rows && nc >= 0 && nc < cols && board[nr][nc].hasMine) count++;
    }
  }
  return count;
}

function placeMines(board: ClassicCell[][], mines: number, safeR: number, safeC: number): void {
  const rows = board.length;
  const cols = board[0].length;
  const safeSet = new Set<number>();
  for (let dr = -1; dr <= 1; dr++) {
    for (let dc = -1; dc <= 1; dc++) {
      const nr = safeR + dr; const nc = safeC + dc;
      if (nr >= 0 && nr < rows && nc >= 0 && nc < cols) {
        safeSet.add(nr * cols + nc);
      }
    }
  }
  const candidates: number[] = [];
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      if (!safeSet.has(r * cols + c)) candidates.push(r * cols + c);
    }
  }
  // Fisher-Yates shuffle and take first N
  for (let i = candidates.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [candidates[i], candidates[j]] = [candidates[j], candidates[i]];
  }
  for (let i = 0; i < Math.min(mines, candidates.length); i++) {
    const idx = candidates[i];
    board[Math.floor(idx / cols)][idx % cols].hasMine = true;
  }
  // Compute adjacency
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      board[r][c].adjacentMines = countAdjacentMines(board, r, c);
    }
  }
}

function floodReveal(board: ClassicCell[][], r: number, c: number): ClassicCell[][] {
  const rows = board.length;
  const cols = board[0].length;
  const next = board.map((row) => row.map((cell) => ({ ...cell })));
  const queue: [number, number][] = [[r, c]];
  const visited = new Set<number>();
  visited.add(r * cols + c);
  while (queue.length > 0) {
    const [cr, cc] = queue.shift()!;
    const cell = next[cr][cc];
    if (cell.hasMine || cell.revealed) continue;
    cell.revealed = true;
    cell.flagged = false;
    cell.questioned = false;
    if (cell.adjacentMines === 0) {
      for (let dr = -1; dr <= 1; dr++) {
        for (let dc = -1; dc <= 1; dc++) {
          if (dr === 0 && dc === 0) continue;
          const nr = cr + dr; const nc = cc + dc;
          if (nr >= 0 && nr < rows && nc >= 0 && nc < cols && !visited.has(nr * cols + nc)) {
            visited.add(nr * cols + nc);
            queue.push([nr, nc]);
          }
        }
      }
    }
  }
  return next;
}

function checkWon(board: ClassicCell[][]): boolean {
  return board.every((row) => row.every((cell) => cell.hasMine || cell.revealed));
}

export interface ClassicGameApi {
  board: ClassicCell[][];
  status: ClassicStatus;
  rows: number;
  cols: number;
  minesTotal: number;
  flagsPlaced: number;
  /** ms elapsed since first click */
  elapsedMs: number;
  /** best time for current preset key (ms), or null */
  bestTimeMs: number | null;
  reveal: (r: number, c: number) => void;
  chord: (r: number, c: number) => void;
  cycleFlag: (r: number, c: number) => void;
  restart: () => void;
}

export function useClassicGame(
  rows: number,
  cols: number,
  mines: number,
  presetKey: string,
): ClassicGameApi {
  const [board, setBoard]   = useState<ClassicCell[][]>(() => makeEmptyBoard(rows, cols));
  const [status, setStatus] = useState<ClassicStatus>('idle');
  const [elapsedMs, setElapsed] = useState(0);
  const [bestTimeMs, setBestTime] = useState<number | null>(() => loadBestTime(presetKey));

  const startTimeRef = useRef<number | null>(null);
  const timerRef     = useRef<ReturnType<typeof setInterval> | null>(null);
  const boardRef     = useRef(board);
  boardRef.current = board;

  // Reset when params change
  useEffect(() => {
    restart();
    setBestTime(loadBestTime(presetKey));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows, cols, mines, presetKey]);

  function startTimer() {
    startTimeRef.current = Date.now();
    timerRef.current = setInterval(() => {
      setElapsed(Date.now() - startTimeRef.current!);
    }, 100);
  }

  function stopTimer() {
    if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null; }
  }

  function restart() {
    stopTimer();
    setBoard(makeEmptyBoard(rows, cols));
    setStatus('idle');
    setElapsed(0);
    startTimeRef.current = null;
  }

  useEffect(() => () => stopTimer(), []);

  const reveal = useCallback((r: number, c: number) => {
    const cur = boardRef.current;
    if (status === 'won' || status === 'lost') return;
    const cell = cur[r][c];
    if (cell.revealed || cell.flagged) return;

    let workBoard = cur;

    // First click — place mines, start timer
    if (status === 'idle') {
      workBoard = makeEmptyBoard(rows, cols);
      placeMines(workBoard, mines, r, c);
      startTimer();
      setStatus('playing');
    }

    const target = workBoard[r][c];

    if (target.hasMine) {
      // Reveal all mines on loss
      const lost = workBoard.map((row) => row.map((cell) => ({
        ...cell,
        revealed: cell.hasMine ? true : cell.revealed,
      })));
      stopTimer();
      setBoard(lost);
      setStatus('lost');
      return;
    }

    const revealed = floodReveal(workBoard, r, c);
    if (checkWon(revealed)) {
      stopTimer();
      const elapsed = startTimeRef.current ? Date.now() - startTimeRef.current : 0;
      const best = loadBestTime(presetKey);
      if (!best || elapsed < best) {
        saveBestTime(presetKey, elapsed);
        setBestTime(elapsed);
      }
      setBoard(revealed);
      setStatus('won');
      return;
    }

    setBoard(revealed);
  }, [status, rows, cols, mines, presetKey]);

  const cycleFlag = useCallback((r: number, c: number) => {
    if (status !== 'playing' && status !== 'idle') return;
    const cur = boardRef.current;
    const cell = cur[r][c];
    if (cell.revealed) return;
    const next = cur.map((row, ri) =>
      row.map((c2, ci) => {
        if (ri !== r || ci !== c) return c2;
        if (!c2.flagged && !c2.questioned) return { ...c2, flagged: true };
        if (c2.flagged) return { ...c2, flagged: false, questioned: true };
        return { ...c2, questioned: false };
      }),
    );
    setBoard(next);
  }, [status]);

  const chord = useCallback((r: number, c: number) => {
    if (status !== 'playing') return;
    const cur = boardRef.current;
    const cell = cur[r][c];
    if (!cell.revealed || cell.adjacentMines === 0) return;
    const rows2 = cur.length;
    const cols2 = cur[0].length;
    let flagCount = 0;
    const neighbors: [number, number][] = [];
    for (let dr = -1; dr <= 1; dr++) {
      for (let dc = -1; dc <= 1; dc++) {
        if (dr === 0 && dc === 0) continue;
        const nr = r + dr; const nc = c + dc;
        if (nr >= 0 && nr < rows2 && nc >= 0 && nc < cols2) {
          if (cur[nr][nc].flagged) flagCount++;
          else if (!cur[nr][nc].revealed) neighbors.push([nr, nc]);
        }
      }
    }
    if (flagCount !== cell.adjacentMines) return;
    // Reveal all unflagged neighbors
    let workBoard = cur;
    for (const [nr, nc] of neighbors) {
      if (workBoard[nr][nc].hasMine) {
        const lost = workBoard.map((row) => row.map((c2) => ({
          ...c2,
          revealed: c2.hasMine ? true : c2.revealed,
        })));
        stopTimer();
        setBoard(lost);
        setStatus('lost');
        return;
      }
      workBoard = floodReveal(workBoard, nr, nc);
    }
    if (checkWon(workBoard)) {
      stopTimer();
      const elapsed = startTimeRef.current ? Date.now() - startTimeRef.current : 0;
      const best = loadBestTime(presetKey);
      if (!best || elapsed < best) {
        saveBestTime(presetKey, elapsed);
        setBestTime(elapsed);
      }
      setBoard(workBoard);
      setStatus('won');
      return;
    }
    setBoard(workBoard);
  }, [status, presetKey]);

  const flagsPlaced = board.reduce((sum, row) => sum + row.filter((c) => c.flagged).length, 0);

  return {
    board,
    status,
    rows,
    cols,
    minesTotal: mines,
    flagsPlaced,
    elapsedMs,
    bestTimeMs,
    reveal,
    chord,
    cycleFlag,
    restart,
  };
}
