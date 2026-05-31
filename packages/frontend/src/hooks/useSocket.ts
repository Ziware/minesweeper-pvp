import { useEffect, useRef, useState } from 'react';
import { io, Socket } from 'socket.io-client';
import {
  ServerToClientEvents,
  ClientToServerEvents,
  S2C_GameState,
  S2C_GameOver,
  PlayerColor,
  CellMark,
  TimeControl,
} from '@minesweeper-pvp/shared';

type AppSocket = Socket<ServerToClientEvents, ClientToServerEvents>;
export type GameScreen = 'lobby' | 'waiting' | 'setup' | 'game' | 'finished';

// Алиас, чтобы не плодить одинаковые интерфейсы — единственный источник
// правды лежит в @minesweeper-pvp/shared.
export type GameOverInfo = S2C_GameOver;

const SOCKET_URL =
  import.meta.env.DEV ? 'http://localhost:3001' : window.location.origin;

// ─── Tab-изолированная сессия ─────────────────────────────────────────────────

// tabId живёт в sessionStorage — уникален для каждой вкладки,
// выживает перезагрузку, но не переживает закрытие вкладки
function getTabId(): string {
  let tabId = sessionStorage.getItem('minesweeper_tab_id');
  if (!tabId) {
    tabId = `tab_${Date.now()}_${Math.random().toString(36).slice(2)}`;
    sessionStorage.setItem('minesweeper_tab_id', tabId);
  }
  return tabId;
}

const TAB_ID = getTabId();
// Ключ сессии уникален для каждой вкладки
const SESSION_KEY = `minesweeper_session_${TAB_ID}`;

interface SavedSession {
  roomId: string;
  playerColor: PlayerColor;
  playerName: string;
  tabId: string;
}

function saveSession(data: Omit<SavedSession, 'tabId'>) {
  sessionStorage.setItem(SESSION_KEY, JSON.stringify({ ...data, tabId: TAB_ID }));
}

function loadSession(): SavedSession | null {
  try {
    const raw = sessionStorage.getItem(SESSION_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as SavedSession;
    // Дополнительная проверка — сессия принадлежит этой вкладке
    if (parsed.tabId !== TAB_ID) return null;
    return parsed;
  } catch {
    return null;
  }
}

function clearSession() {
  sessionStorage.removeItem(SESSION_KEY);
}

// ─────────────────────────────────────────────────────────────────────────────

export function useSocket() {
  const socketRef = useRef<AppSocket | null>(null);
  const myNameRef = useRef('');

  const [screen,    setScreen]    = useState<GameScreen>('lobby');
  const [roomId,    setRoomId]    = useState('');
  const [myColor,   setMyColor]   = useState<PlayerColor | null>(null);
  const [myName,    setMyName]    = useState('');
  const [gameState, setGameState] = useState<S2C_GameState | null>(null);
  const [errorMsg,  setErrorMsg]  = useState('');
  const [gameOver,  setGameOver]  = useState<GameOverInfo | null>(null);
  const [restoring, setRestoring] = useState(false);
  const [serverReachable, setServerReachable] = useState(true);

  useEffect(() => {
    const socket: AppSocket = io(SOCKET_URL, {
      path: '/socket.io',
      query: { tabId: TAB_ID },
      reconnection: true,
      reconnectionAttempts: Infinity,
      reconnectionDelay: 1000,
      reconnectionDelayMax: 5000,
    });

    socketRef.current = socket;

    const restoreSavedSession = (reason: string) => {
      if (!socket.connected) return;
      const session = loadSession();
      if (!session) return;

      console.log(`[socket] restoring session (${reason}):`, session);
      setRestoring(true);
      socket.emit('restoreSession', {
        roomId:      session.roomId,
        playerColor: session.playerColor,
        tabId:       TAB_ID,
      });
    };

    // Таймер, который через 3 сек после потери коннекта помечает сервер недоступным
    let unreachableTimer: ReturnType<typeof setTimeout> | null = null;
    const scheduleUnreachable = () => {
      if (unreachableTimer) return;
      unreachableTimer = setTimeout(() => {
        setServerReachable(false);
        unreachableTimer = null;
      }, 3000);
    };
    const cancelUnreachable = () => {
      if (unreachableTimer) {
        clearTimeout(unreachableTimer);
        unreachableTimer = null;
      }
      setServerReachable(true);
    };

    // При каждом (пере)подключении пробуем восстановить сессию этой вкладки
    socket.on('connect', () => {
      console.log('[socket] connected, tabId:', TAB_ID);
      cancelUnreachable();
      restoreSavedSession('connect');
    });

    socket.on('connect_error', (err) => {
      console.warn('[socket] connect_error:', err.message);
      scheduleUnreachable();
    });

    socket.io.on('reconnect_attempt', () => {
      scheduleUnreachable();
    });
    socket.io.on('error', () => {
      scheduleUnreachable();
    });

    const handleFocusResync = () => restoreSavedSession('focus');
    const handleVisibilityResync = () => {
      if (document.visibilityState === 'visible') restoreSavedSession('visible');
    };
    const handlePageShowResync = () => restoreSavedSession('pageshow');

    window.addEventListener('focus', handleFocusResync);
    document.addEventListener('visibilitychange', handleVisibilityResync);
    window.addEventListener('pageshow', handlePageShowResync);

    socket.on('sessionRestored', ({ playerColor, roomId }) => {
      const session = loadSession();
      setMyColor(playerColor);
      setRoomId(roomId);
      if (session) setMyName(session.playerName);
      setRestoring(false);
      console.log('[socket] session restored:', playerColor, roomId);
    });

    socket.on('roomCreated', ({ roomId, playerColor }) => {
      setRoomId(roomId);
      setMyColor(playerColor);
      setGameOver(null);
      if (myNameRef.current) saveSession({ roomId, playerColor, playerName: myNameRef.current });
    });

    socket.on('waitingForOpponent', () => setScreen('waiting'));

    socket.on('roomJoined', ({ roomId, playerColor }) => {
      setRoomId(roomId);
      setMyColor(playerColor);
      setGameOver(null);
      if (myNameRef.current) saveSession({ roomId, playerColor, playerName: myNameRef.current });
    });

    socket.on('gameState', (state) => {
      setGameState(state);
      setRestoring(false);
      const phase = state.turn.phase;
      if      (phase === 'setup')    setScreen('setup');
      else if (phase === 'finished') setScreen('finished');
      else if (['phase1', 'phase2', 'phase3'].includes(phase)) setScreen('game');
    });

    socket.on('error', ({ message }) => {
      setErrorMsg(message);
      setTimeout(() => setErrorMsg(''), 3000);
    });

    socket.on('sessionInvalid', ({ message }) => {
      console.warn('[socket] session invalid, clearing:', message);
      clearSession();
      setRestoring(false);
      setScreen('lobby');
    });

    socket.on('gameOver', (info) => {
      setGameOver(info);
      setScreen('finished');
      clearSession();
    });

    socket.on('disconnect', (reason) => {
      console.log('[socket] disconnected:', reason);
      scheduleUnreachable();
    });

    return () => {
      if (unreachableTimer) clearTimeout(unreachableTimer);
      window.removeEventListener('focus', handleFocusResync);
      document.removeEventListener('visibilitychange', handleVisibilityResync);
      window.removeEventListener('pageshow', handlePageShowResync);
      socket.disconnect();
    };
  }, []);

  // Сохраняем сессию когда все три значения известны
  useEffect(() => {
    myNameRef.current = myName;
    if (roomId && myColor && myName) {
      saveSession({ roomId, playerColor: myColor, playerName: myName });
    }
  }, [roomId, myColor, myName]);

  const createRoom = (name: string, timeControl: TimeControl) => {
    myNameRef.current = name;
    setMyName(name);
    socketRef.current?.emit('createRoom', { playerName: name, timeControl });
  };

  const joinRoom = (id: string, name: string) => {
    myNameRef.current = name;
    setMyName(name);
    socketRef.current?.emit('joinRoom', { roomId: id, playerName: name });
  };

  const placeMineSetup  = (row: number, col: number) =>
    socketRef.current?.emit('placeMineSetup',  { row, col });
  const confirmSetup    = () =>
    socketRef.current?.emit('confirmSetup');
  const selectZone      = (row: number, col: number) =>
    socketRef.current?.emit('selectZone',      { row, col });
  const captureCell     = (row: number, col: number) =>
    socketRef.current?.emit('captureCell',     { row, col });
  const defuseCell      = (row: number, col: number) =>
    socketRef.current?.emit('defuseCell',      { row, col });
  const chord           = (row: number, col: number) =>
    socketRef.current?.emit('chord',           { row, col });
  /** Локальный сетер ошибки — для «инлайн» ошибок UI (например, аккорд
   *  с лишними флажками отслеживается ещё до отправки на сервер). */
  const showLocalError  = (message: string) => {
    setErrorMsg(message);
    setTimeout(() => setErrorMsg(''), 3000);
  };
  const endPhase2       = () =>
    socketRef.current?.emit('endPhase2');
  const endPhase3       = () =>
    socketRef.current?.emit('endPhase3');
  const placeMinePhase3 = (row: number, col: number) =>
    socketRef.current?.emit('placeMinePhase3', { row, col });
  const toggleMark      = (row: number, col: number, mark: CellMark) =>
    socketRef.current?.emit('toggleMark',      { row, col, mark });

  const returnToMenu = () => {
    clearSession();
    setScreen('lobby');
    setRoomId('');
    setMyColor(null);
    setGameState(null);
    setGameOver(null);
    setErrorMsg('');
    setRestoring(false);
  };

  /**
   * Добровольный выход из комнаты с уведомлением сервера, чтобы серверу
   * не приходилось ждать TTL пустой комнаты. Используется, например,
   * на экране ожидания соперника.
   */
  const leaveRoom = () => {
    socketRef.current?.emit('leaveRoom');
    returnToMenu();
  };

  return {
    screen, roomId, myColor, myName, gameState, errorMsg, gameOver, restoring,
    serverReachable,
    createRoom, joinRoom,
    placeMineSetup, confirmSetup,
    selectZone, captureCell, defuseCell, chord, endPhase2, endPhase3, placeMinePhase3, toggleMark,
    showLocalError,
    returnToMenu,
    leaveRoom,
  };
}
