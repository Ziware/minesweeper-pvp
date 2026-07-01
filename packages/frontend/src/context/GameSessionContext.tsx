/**
 * GameSessionContext — lifts socket + local-game state outside App so that
 * navigation away from "/" does NOT destroy the active game.
 *
 * All pages consume this context to read/modify game state.
 */
import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import type { CellMark, PlayerColor, S2C_GameState, S2C_GameOver, TimeControl } from '@minesweeper-pvp/shared';
import type { SoloLogPayload } from '@minesweeper-pvp/shared';
import { useSocket } from '../hooks/useSocket';
import { useLocalGame } from '../ai/driver/useLocalGame';
import type { Difficulty, EngineState } from '../ai/types';
import type { GameScreen } from '../ai/driver/useLocalGame';
import { DIFFICULTY_LABELS } from '../ai/difficulty';

// ─── ActiveRoom registry (persisted to localStorage) ─────────────────────────

export interface ActiveRoom {
  roomId: string;
  mode: 'pvp' | 'solo';
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

// ─── Solo snapshot restore ────────────────────────────────────────────────────

interface SoloSnapshot {
  savedAt: number;
  humanColor: PlayerColor;
  difficulty: Difficulty;
  state: EngineState;
}

function loadSoloSnapshot(soloRoomId: string): SoloSnapshot | null {
  try {
    const raw = localStorage.getItem(`minesweeper_solo_state_${soloRoomId}`);
    if (!raw) return null;
    const snap: SoloSnapshot = JSON.parse(raw);
    if (Date.now() - snap.savedAt > ACTIVE_ROOM_TTL_MS) return null;
    return snap;
  } catch { return null; }
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
  gameMode: 'pvp' | 'solo';
  restoring: boolean;
  // active rooms registry
  activeRooms: ActiveRoom[];
  // actions
  createRoom: (name: string, tc: TimeControl) => void;
  joinRoom: (id: string, name: string) => void;
  startSolo: (difficulty: Difficulty, humanColor: PlayerColor, soloRoomId: string) => void;
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
  logSoloEvent: (data: SoloLogPayload) => void;
}

const GameSessionContext = createContext<GameSessionContextValue | null>(null);

// ─── Provider ─────────────────────────────────────────────────────────────────

interface ProviderProps { children: React.ReactNode; }

export function GameSessionProvider({ children }: ProviderProps) {
  const [gameMode, setGameMode] = useState<'pvp' | 'solo'>('pvp');
  const [soloEnabled, setSoloEnabled] = useState(false);
  const [soloHumanColor, setSoloHumanColor] = useState<PlayerColor>('red');
  const [soloDifficulty, setSoloDifficulty] = useState<Difficulty>('normal');
  const [soloNonce, setSoloNonce] = useState(0);
  const [soloRoomId, setSoloRoomId] = useState('');
  const [soloInitialState, setSoloInitialState] = useState<EngineState | undefined>(undefined);
  const soloSessionIdRef = useRef<string>('');

  const [activeRooms, setActiveRooms] = useState<ActiveRoom[]>(loadActiveRooms);

  // ── PvP socket session ──────────────────────────────────────────────────────
  const pvpSession = useSocket();
  const logSoloEvent = pvpSession.logSoloEvent;
  const playerName = pvpSession.myName || 'Гость';

  // ── Solo local game session ─────────────────────────────────────────────────
  const soloSession = useLocalGame({
    enabled: soloEnabled,
    humanColor: soloHumanColor,
    humanName: playerName,
    difficulty: soloDifficulty,
    gameNonce: soloNonce,
    soloRoomId,
    initialState: soloInitialState,
    onSession: (kind, meta) => {
      const sid = soloSessionIdRef.current;
      if (!sid) return;
      if (kind === 'session_start') {
        logSoloEvent({
          kind: 'session_start',
          sessionId: sid,
          playerName: meta.humanName,
          humanColor: meta.humanColor,
          difficulty: meta.difficulty as string,
          config: meta.config,
          botName: `Бот (${DIFFICULTY_LABELS[meta.difficulty as Difficulty]})`,
        } as any);
      }
    },
    onSoloEvent: (event) => {
      const sid = soloSessionIdRef.current;
      if (!sid) return;
      logSoloEvent({ ...event, sessionId: sid } as any);
    },
    onLogAux: (auxKind, details) => {
      const sid = soloSessionIdRef.current;
      if (!sid) return;
      logSoloEvent({ kind: 'session_aux', sessionId: sid, auxKind, details } as any);
    },
  });

  // ── Active session ──────────────────────────────────────────────────────────
  const session = gameMode === 'solo' ? soloSession : pvpSession;
  const {
    screen, roomId, myColor, myName, gameState, errorMsg, gameOver, serverReachable,
    restoring,
    placeMineSetup, confirmSetup,
    selectZone, captureCell, defuseCell, chord, endPhase2, endPhase3, placeMinePhase3, toggleMark,
    showLocalError,
    returnToMenu: sessionReturnToMenu,
    leaveRoom: sessionLeaveRoom,
  } = session;

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
      upsertActiveRoom({ roomId, mode: gameMode, myColor: myColor ?? 'red', opponentName });
    }
  }, [gameState, roomId, myColor, gameMode, upsertActiveRoom]);

  // Remove on game over
  useEffect(() => {
    if (gameOver && roomId) {
      removeActiveRoom(roomId);
    }
  }, [gameOver, roomId, removeActiveRoom]);

  // ── Public actions ──────────────────────────────────────────────────────────

  const createRoom = useCallback((name: string, tc: TimeControl) => {
    setGameMode('pvp');
    pvpSession.createRoom(name, tc);
  }, [pvpSession]);

  const joinRoom = useCallback((id: string, name: string) => {
    setGameMode('pvp');
    pvpSession.joinRoom(id, name);
  }, [pvpSession]);

  const startSolo = useCallback((difficulty: Difficulty, humanColor: PlayerColor, srId: string) => {
    const snapshot = loadSoloSnapshot(srId);
    setSoloDifficulty(snapshot?.difficulty ?? difficulty);
    setSoloHumanColor(snapshot?.humanColor ?? humanColor);
    setSoloRoomId(srId);
    setSoloInitialState(snapshot?.state);
    soloSessionIdRef.current = srId;
    setGameMode('solo');
    setSoloEnabled(true);
    setSoloNonce((n) => n + 1);

    // Register in active rooms
    upsertActiveRoom({ roomId: srId, mode: 'solo', myColor: humanColor, opponentName: 'Бот', startedAt: Date.now(), lastSeenAt: Date.now() });
  }, [upsertActiveRoom]);

  const returnToMenu = useCallback(() => {
    sessionReturnToMenu();
    if (roomId) removeActiveRoom(roomId);
    setSoloEnabled(false);
    setGameMode('pvp');
  }, [sessionReturnToMenu, roomId, removeActiveRoom]);

  const leaveRoom = useCallback(() => {
    sessionLeaveRoom();
    if (roomId) removeActiveRoom(roomId);
    setSoloEnabled(false);
    setGameMode('pvp');
  }, [sessionLeaveRoom, roomId, removeActiveRoom]);

  const surrender = useCallback(() => {
    if (gameMode === 'solo') {
      soloSession.surrender?.();
    } else {
      pvpSession.surrender();
    }
  }, [gameMode, soloSession, pvpSession]);

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
    gameMode,
    restoring,
    activeRooms,
    createRoom,
    joinRoom,
    startSolo,
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
    logSoloEvent,
  }), [
    screen, roomId, myColor, myName, gameState, gameOver, errorMsg,
    serverReachable, gameMode, restoring, activeRooms,
    createRoom, joinRoom, startSolo, returnToMenu, leaveRoom, surrender,
    placeMineSetup, confirmSetup, selectZone, captureCell, defuseCell,
    chord, endPhase2, endPhase3, placeMinePhase3, toggleMark,
    showLocalError, logSoloEvent,
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
