/**
 * GameSessionContext — lifts socket state outside App so that
 * navigation away from "/" does NOT destroy the active game.
 *
 * All pages consume this context to read/modify game state.
 */
import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import type { CellMark, PlayerColor, S2C_GameState, S2C_GameOver, TimeControl } from '@minesweeper-pvp/shared';
import { useSocket } from '../hooks/useSocket';
import { useBotPlayer } from '../hooks/useBotPlayer';
import type { Difficulty } from '../ai/types';
import type { GameScreen } from '../hooks/useSocket';

// ─── ActiveRoom registry (persisted to localStorage) ─────────────────────────

export interface ActiveRoom {
  roomId: string;
  mode: 'pvp' | 'bot';
  myColor: PlayerColor;
  opponentName: string;
  startedAt: number;
  lastSeenAt: number;
}

const ACTIVE_ROOMS_KEY = 'minesweeper_active_rooms';
const ACTIVE_ROOM_TTL_MS = 24 * 60 * 60 * 1000; // 24h

function loadActiveRooms(): ActiveRoom[] {
  try {
    const raw = localStorage.getItem(ACTIVE_ROOMS_KEY);
    if (!raw) return [];
    const rooms: ActiveRoom[] = JSON.parse(raw);
    const cutoff = Date.now() - ACTIVE_ROOM_TTL_MS;
    return rooms.filter((r) => r.lastSeenAt > cutoff);
  } catch { return []; }
}

function saveActiveRooms(rooms: ActiveRoom[]) {
  try { localStorage.setItem(ACTIVE_ROOMS_KEY, JSON.stringify(rooms)); } catch { /* ignore */ }
}

// ─── Context shape ────────────────────────────────────────────────────────────

export interface GameSessionContextValue {
  // state
  screen: GameScreen;
  roomId: string;
  myColor: PlayerColor | null;
  myName: string;
  gameState: S2C_GameState | null;
  gameOver: S2C_GameOver | null;
  errorMsg: string;
  serverReachable: boolean;
  isBotGame: boolean;
  restoring: boolean;
  // active rooms registry
  activeRooms: ActiveRoom[];
  // actions
  createRoom: (name: string, tc: TimeControl, preferredColor?: PlayerColor) => void;
  joinRoom: (id: string, name: string) => void;
  startBotGame: (name: string, difficulty: Difficulty, humanColor: PlayerColor, userId?: string) => void;
  returnToMenu: () => void;
  leaveRoom: () => void;
  surrender: () => void;
  // game actions
  placeMineSetup: (row: number, col: number) => void;
  confirmSetup: () => void;
  selectZone: (row: number, col: number) => void;
  captureCell: (row: number, col: number) => void;
  defuseCell: (row: number, col: number) => void;
  chord: (row: number, col: number) => void;
  endPhase2: () => void;
  endPhase3: () => void;
  placeMinePhase3: (row: number, col: number) => void;
  toggleMark: (row: number, col: number, mark: CellMark) => void;
  showLocalError: (message: string) => void;
}

const GameSessionContext = createContext<GameSessionContextValue | null>(null);

// ─── Provider ─────────────────────────────────────────────────────────────────

interface ProviderProps { children: React.ReactNode; }

export function GameSessionProvider({ children }: ProviderProps) {
  const [isBotGame, setIsBotGame] = useState(false);

  const [activeRooms, setActiveRooms] = useState<ActiveRoom[]>(loadActiveRooms);

  // ── Socket session ──────────────────────────────────────────────────────────
  const {
    socketRef,
    screen, roomId, myColor, myName, gameState, errorMsg, gameOver, serverReachable,
    restoring,
    createRoom: socketCreateRoom,
    joinRoom: socketJoinRoom,
    createBotGame: socketCreateBotGame,
    placeMineSetup, confirmSetup,
    selectZone, captureCell, defuseCell, chord, endPhase2, endPhase3, placeMinePhase3, toggleMark,
    showLocalError,
    surrender: socketSurrender,
    returnToMenu: socketReturnToMenu,
    leaveRoom: socketLeaveRoom,
  } = useSocket();

  // ── Bot player (runs MCTS via Web Worker on botTurn events) ─────────────────
  useBotPlayer(socketRef, isBotGame);

  // ── Active rooms: persist/update ────────────────────────────────────────────

  const upsertActiveRoom = useCallback((room: Partial<ActiveRoom> & { roomId: string }) => {
    setActiveRooms((prev) => {
      const existing = prev.find((r) => r.roomId === room.roomId);
      const updated = existing
        ? prev.map((r) => r.roomId === room.roomId ? { ...r, ...room, lastSeenAt: Date.now() } : r)
        : [...prev, { mode: 'pvp' as const, myColor: 'red' as PlayerColor, opponentName: '...', startedAt: Date.now(), lastSeenAt: Date.now(), ...room }];
      saveActiveRooms(updated);
      return updated;
    });
  }, []);

  const removeActiveRoom = useCallback((rid: string) => {
    setActiveRooms((prev) => {
      const next = prev.filter((r) => r.roomId !== rid);
      saveActiveRooms(next);
      return next;
    });
  }, []);

  // Update lastSeenAt on each gameState change
  useEffect(() => {
    if (gameState && roomId) {
      const opponentName = gameState.players.find((p) => p.color !== myColor)?.name ?? '...';
      upsertActiveRoom({ roomId, mode: isBotGame ? 'bot' : 'pvp', myColor: myColor ?? 'red', opponentName });
    }
  }, [gameState, roomId, myColor, isBotGame, upsertActiveRoom]);

  // Remove on game over
  useEffect(() => {
    if (gameOver && roomId) {
      removeActiveRoom(roomId);
    }
  }, [gameOver, roomId, removeActiveRoom]);

  // ── Public actions ──────────────────────────────────────────────────────────

  const createRoom = useCallback((name: string, tc: TimeControl, preferredColor?: PlayerColor) => {
    setIsBotGame(false);
    socketCreateRoom(name, tc, preferredColor);
  }, [socketCreateRoom]);

  const joinRoom = useCallback((id: string, name: string) => {
    setIsBotGame(false);
    socketJoinRoom(id, name);
  }, [socketJoinRoom]);

  const startBotGame = useCallback((
    name: string,
    difficulty: Difficulty,
    humanColor: PlayerColor,
    userId?: string,
  ) => {
    setIsBotGame(true);
    socketCreateBotGame(name, difficulty, humanColor, userId);
  }, [socketCreateBotGame]);

  const returnToMenu = useCallback(() => {
    socketReturnToMenu();
    if (roomId) removeActiveRoom(roomId);
    setIsBotGame(false);
  }, [socketReturnToMenu, roomId, removeActiveRoom]);

  const leaveRoom = useCallback(() => {
    socketLeaveRoom();
    if (roomId) removeActiveRoom(roomId);
    setIsBotGame(false);
  }, [socketLeaveRoom, roomId, removeActiveRoom]);

  const surrender = useCallback(() => {
    socketSurrender();
  }, [socketSurrender]);

  // ── Context value ───────────────────────────────────────────────────────────
  const value = useMemo<GameSessionContextValue>(() => ({
    screen,
    roomId,
    myColor,
    myName,
    gameState,
    gameOver,
    errorMsg,
    serverReachable,
    isBotGame,
    restoring,
    activeRooms,
    createRoom,
    joinRoom,
    startBotGame,
    returnToMenu,
    leaveRoom,
    surrender,
    placeMineSetup,
    confirmSetup,
    selectZone,
    captureCell,
    defuseCell,
    chord,
    endPhase2,
    endPhase3,
    placeMinePhase3,
    toggleMark,
    showLocalError,
  }), [
    screen, roomId, myColor, myName, gameState, gameOver, errorMsg,
    serverReachable, isBotGame, restoring, activeRooms,
    createRoom, joinRoom, startBotGame, returnToMenu, leaveRoom, surrender,
    placeMineSetup, confirmSetup, selectZone, captureCell, defuseCell,
    chord, endPhase2, endPhase3, placeMinePhase3, toggleMark,
    showLocalError,
  ]);

  return (
    <GameSessionContext.Provider value={value}>
      {children}
    </GameSessionContext.Provider>
  );
}

// ─── Hook ─────────────────────────────────────────────────────────────────────

export function useGameSession(): GameSessionContextValue {
  const ctx = useContext(GameSessionContext);
  if (!ctx) throw new Error('useGameSession must be used within GameSessionProvider');
  return ctx;
}

export { GameSessionContext };
