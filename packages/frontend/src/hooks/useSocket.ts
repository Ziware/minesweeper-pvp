import { useEffect, useRef, useState } from 'react';
import { io, Socket } from 'socket.io-client';
import {
  ServerToClientEvents,
  ClientToServerEvents,
  S2C_GameState,
  PlayerColor,
  CellMark,
} from '@minesweeper-pvp/shared';

type AppSocket = Socket<ServerToClientEvents, ClientToServerEvents>;
export type GameScreen = 'lobby' | 'waiting' | 'setup' | 'game' | 'finished';

export interface GameOverInfo {
  winnerColor: PlayerColor;
  reason: 'no_mines_space' | 'lives';
}

const SOCKET_URL =
  import.meta.env.DEV ? 'http://localhost:3001' : window.location.origin;

const SESSION_KEY = 'minesweeper_session';

interface SavedSession {
  roomId: string;
  playerColor: PlayerColor;
  playerName: string;
}

function saveSession(data: SavedSession) {
  localStorage.setItem(SESSION_KEY, JSON.stringify(data));
}

function loadSession(): SavedSession | null {
  try {
    const raw = localStorage.getItem(SESSION_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function clearSession() {
  localStorage.removeItem(SESSION_KEY);
}

export function useSocket() {
  const socketRef = useRef<AppSocket | null>(null);

  const [screen,    setScreen]    = useState<GameScreen>('lobby');
  const [roomId,    setRoomId]    = useState('');
  const [myColor,   setMyColor]   = useState<PlayerColor | null>(null);
  const [myName,    setMyName]    = useState('');
  const [gameState, setGameState] = useState<S2C_GameState | null>(null);
  const [errorMsg,  setErrorMsg]  = useState('');
  const [gameOver,  setGameOver]  = useState<GameOverInfo | null>(null);

  useEffect(() => {
    const socket: AppSocket = io(SOCKET_URL, {
      path: '/socket.io',
      // Автоматически переподключается при обрыве
      reconnection: true,
      reconnectionAttempts: Infinity,
      reconnectionDelay: 1000,
      reconnectionDelayMax: 5000,
    });
    socketRef.current = socket;

    // При подключении пробуем восстановить сессию
    socket.on('connect', () => {
      const session = loadSession();
      if (session) {
        socket.emit('restoreSession', {
          roomId:      session.roomId,
          playerColor: session.playerColor,
        });
        setMyName(session.playerName);
      }
    });

    socket.on('sessionRestored', ({ playerColor, roomId }) => {
      const session = loadSession();
      setMyColor(playerColor);
      setRoomId(roomId);
      if (session) setMyName(session.playerName);
    });

    socket.on('roomCreated', ({ roomId, playerColor }) => {
      setRoomId(roomId);
      setMyColor(playerColor);
    });

    socket.on('waitingForOpponent', () => setScreen('waiting'));

    socket.on('roomJoined', ({ roomId, playerColor }) => {
      setRoomId(roomId);
      setMyColor(playerColor);
    });

    socket.on('gameState', (state) => {
      setGameState(state);
      const phase = state.turn.phase;
      if      (phase === 'setup')    setScreen('setup');
      else if (phase === 'finished') setScreen('finished');
      else if (['phase1','phase2','phase3'].includes(phase)) setScreen('game');
    });

    socket.on('error', ({ message }) => {
      // Если сессия не найдена — чистим localStorage и идём в лобби
      if (message.includes('Session expired')) {
        clearSession();
        setScreen('lobby');
        return;
      }
      setErrorMsg(message);
      setTimeout(() => setErrorMsg(''), 3000);
    });

    socket.on('gameOver', (info) => {
      setGameOver(info);
      setScreen('finished');
      clearSession();
    });

    return () => { socket.disconnect(); };
  }, []);

  const createRoom = (name: string) => {
    setMyName(name);
    socketRef.current?.emit('createRoom', { playerName: name });
    // Сессию сохраним когда придёт roomCreated + узнаем roomId
  };

  const joinRoom = (id: string, name: string) => {
    setMyName(name);
    socketRef.current?.emit('joinRoom', { roomId: id, playerName: name });
  };

  // Сохраняем сессию когда знаем и roomId и color
  useEffect(() => {
    if (roomId && myColor && myName) {
      saveSession({ roomId, playerColor: myColor, playerName: myName });
    }
  }, [roomId, myColor, myName]);

  const placeMineSetup  = (row: number, col: number) => socketRef.current?.emit('placeMineSetup',  { row, col });
  const confirmSetup    = ()                          => socketRef.current?.emit('confirmSetup');
  const selectZone      = (row: number, col: number) => socketRef.current?.emit('selectZone',      { row, col });
  const captureCell     = (row: number, col: number) => socketRef.current?.emit('captureCell',     { row, col });
  const defuseCell      = (row: number, col: number) => socketRef.current?.emit('defuseCell',      { row, col });
  const endPhase2       = ()                          => socketRef.current?.emit('endPhase2');
  const placeMinePhase3 = (row: number, col: number) => socketRef.current?.emit('placeMinePhase3', { row, col });
  const toggleMark = (row: number, col: number, mark: CellMark) =>
    socketRef.current?.emit('toggleMark', { row, col, mark });

  return {
    screen, roomId, myColor, myName, gameState, errorMsg, gameOver,
    createRoom, joinRoom,
    placeMineSetup, confirmSetup,
    selectZone, captureCell, defuseCell, endPhase2, placeMinePhase3, toggleMark,
  };
}
