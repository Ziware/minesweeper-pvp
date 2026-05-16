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

// В dev — явный порт 3001, в prod — тот же хост (nginx проксирует /socket.io/)
const SOCKET_URL =
  import.meta.env.DEV ? 'http://localhost:3001' : window.location.origin;

export function useSocket() {
  const socketRef = useRef<AppSocket | null>(null);
  const [screen, setScreen]       = useState<GameScreen>('lobby');
  const [roomId, setRoomId]       = useState<string>('');
  const [myColor, setMyColor]     = useState<PlayerColor | null>(null);
  const [gameState, setGameState] = useState<S2C_GameState | null>(null);
  const [errorMsg, setErrorMsg]   = useState<string>('');
  const [gameOver, setGameOver]   = useState<GameOverInfo | null>(null);

  useEffect(() => {
    const socket: AppSocket = io(SOCKET_URL, { path: '/socket.io' });
    socketRef.current = socket;

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
      setErrorMsg(message);
      setTimeout(() => setErrorMsg(''), 3000);
    });

    socket.on('gameOver', (info) => {
      setGameOver(info);
      setScreen('finished');
    });

    return () => { socket.disconnect(); };
  }, []);

  const createRoom      = (name: string)                          => socketRef.current?.emit('createRoom',      { playerName: name });
  const joinRoom        = (id: string, name: string)              => socketRef.current?.emit('joinRoom',        { roomId: id, playerName: name });
  const placeMineSetup  = (row: number, col: number)              => socketRef.current?.emit('placeMineSetup',  { row, col });
  const confirmSetup    = ()                                       => socketRef.current?.emit('confirmSetup');
  const selectZone      = (row: number, col: number)              => socketRef.current?.emit('selectZone',      { row, col });
  const captureCell     = (row: number, col: number)              => socketRef.current?.emit('captureCell',     { row, col });
  const defuseCell      = (row: number, col: number)              => socketRef.current?.emit('defuseCell',      { row, col });
  const endPhase2       = ()                                       => socketRef.current?.emit('endPhase2');
  const placeMinePhase3 = (row: number, col: number)              => socketRef.current?.emit('placeMinePhase3', { row, col });
  const toggleMark      = (row: number, col: number, mark: CellMark) => socketRef.current?.emit('toggleMark',  { row, col, mark });

  return {
    screen, roomId, myColor, gameState, errorMsg, gameOver,
    createRoom, joinRoom, placeMineSetup, confirmSetup,
    selectZone, captureCell, defuseCell, endPhase2, placeMinePhase3, toggleMark,
  };
}
