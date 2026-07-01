import express from 'express';
import { createServer } from 'http';
import { Server } from 'socket.io';
import cors from 'cors';
import jwt from 'jsonwebtoken';
import {
  ServerToClientEvents,
  ClientToServerEvents,
  PlayerColor,
  SoloLogPayload,
} from '@minesweeper-pvp/shared';
import { RoomManager } from './roomManager';
import { createGameRecorder, getClientIp, type GameRecorder } from './gameRecorder';

const JWT_SECRET = process.env.JWT_SECRET || '';

// Per-socket map of active solo recorders (one socket = at most one solo session
// in flight; if a new session_start arrives we close the previous one).
const soloRecorders = new Map<string, GameRecorder>();

// Per-socket userId (populated via 'authenticate' event or createRoom/joinRoom data).
const socketToUserId = new Map<string, string>();

function extractUserId(token: string | undefined): string | undefined {
  if (!token || !JWT_SECRET) return undefined;
  try {
    const payload = jwt.verify(token, JWT_SECRET) as { sub?: string };
    return typeof payload.sub === 'string' ? payload.sub : undefined;
  } catch {
    return undefined;
  }
}

const app = express();
app.use(cors());
app.use(express.json());

const httpServer = createServer(app);
const io = new Server<ClientToServerEvents, ServerToClientEvents>(httpServer, {
  cors: { origin: '*', methods: ['GET', 'POST'] },
});

const roomManager = new RoomManager();

// ─── Solo-session handler ───────────────────────────────────────────────────
//
// Solo логи приходят с фронтенда (нет сервера-исполнителя — движок крутится
// в браузере). Backend здесь — лишь «писатель»: переводит каждое сообщение
// SoloLogPayload в соответствующий вызов GameRecorder, чтобы файлы на диске
// выглядели идентично с PvP-играми (одна директория, meta.json + game.log.jsonl).
function handleSoloLog(
  socketId: string,
  handshake: { address?: string; headers: Record<string, unknown> },
  payload: SoloLogPayload,
): void {
  if (payload.kind === 'session_start') {
    // Если уже была активная сессия (новая игра подряд без disconnect),
    // закрываем её корректным aborted-финишем.
    const prev = soloRecorders.get(socketId);
    if (prev && !prev.meta.endedAt) prev.gameFinished(null, 'aborted');

    const ip = getClientIp(handshake.address, handshake.headers['x-forwarded-for'] as string | string[] | undefined);
    const humanColor: PlayerColor = payload.humanColor;
    const botColor: PlayerColor = humanColor === 'red' ? 'blue' : 'red';
    const userId = payload.userId || socketToUserId.get(socketId);
    const rec = createGameRecorder({
      sessionId: payload.sessionId,
      mode: 'solo',
      initialPlayer: {
        color: humanColor,
        name: payload.playerName,
        ip,
        userId,
      },
    });
    rec.setConfig(payload.config);
    rec.setPlayer({
      color: botColor,
      name: payload.botName || `Бот (${payload.difficulty})`,
      difficulty: payload.difficulty,
      isBot: true,
    });
    soloRecorders.set(socketId, rec);
    return;
  }

  const rec = soloRecorders.get(socketId);
  if (!rec) {
    console.warn('[soloLog] event without active session', payload.kind);
    return;
  }

  switch (payload.kind) {
    case 'setup_mine':
      rec.setupMine(payload.actor, payload.row, payload.col, payload.hasMine, payload.minesPlaced);
      break;
    case 'setup_confirmed':
      rec.setupConfirmed(payload.actor, payload.minesPlaced);
      break;
    case 'game_started':
      rec.gameStarted(payload.firstPlayer);
      break;
    case 'zone_select':
      rec.zoneSelect(payload.actor, payload.clicked, payload.displayZone, payload.actionZone);
      break;
    case 'cell_open':
      rec.cellOpen(payload.actor, payload.row, payload.col, {
        viaChord: payload.viaChord,
        viaDefuse: payload.viaDefuse,
      });
      break;
    case 'mine_hit':
      rec.mineHit(payload.actor, payload.row, payload.col, payload.livesLeft, {
        viaChord: payload.viaChord,
      });
      break;
    case 'mine_defused':
      rec.mineDefused(payload.actor, payload.row, payload.col, payload.hadMine);
      break;
    case 'phase3_mine':
      rec.phase3Mine(payload.actor, payload.row, payload.col);
      break;
    case 'turn_end':
      rec.turnEnd(payload.actor, { turnsPlayed: payload.turnsPlayed });
      break;
    case 'game_finished':
      rec.gameFinished(payload.winner, payload.reason);
      soloRecorders.delete(socketId);
      break;
    case 'session_aux':
      rec.appendAux(payload.auxKind, payload.details);
      break;
  }
}

function broadcastGameState(roomId: string) {
  const room = roomManager.getRoomById(roomId);
  if (!room) return;
  for (const player of room.players) {
    const state = roomManager.getGameStateForPlayer(room, player.color);
    io.to(player.id).emit('gameState', state as any);
  }
  if (room.winner) {
    roomManager.logGameFinishedIfNeeded(room);
    const sessionId = room.recorder.sessionId;
    for (const player of room.players) {
      io.to(player.id).emit('gameOver', {
        winnerColor: room.winner!,
        reason: room.winReason || 'lives',
        sessionId,
      });
    }
  }
}

io.on('connection', (socket) => {
  console.log('[connect]', socket.id);

  // Try to authenticate from handshake auth token immediately on connect
  const handshakeToken = socket.handshake.auth?.token as string | undefined;
  const initialUserId = extractUserId(handshakeToken);
  if (initialUserId) socketToUserId.set(socket.id, initialUserId);

  socket.on('authenticate', ({ token }) => {
    const userId = extractUserId(token);
    if (userId) {
      socketToUserId.set(socket.id, userId);
    }
  });

  socket.on('restoreSession', ({ roomId, playerColor, tabId }) => {
    const result = roomManager.restoreSession(socket.id, roomId, playerColor, tabId);
    if (!result.room) {
      // Отдельное событие — клиент молча очистит сессию и вернётся в лобби
      socket.emit('sessionInvalid', { message: result.error || 'Сессия истекла' });
      return;
    }
    socket.join(result.room.id);
    socket.emit('sessionRestored', { playerColor, roomId });
    const state = roomManager.getGameStateForPlayer(result.room, playerColor);
    socket.emit('gameState', state as any);
    console.log(`[restore] ${playerColor} tab=${tabId} room=${roomId}`);
  });

  socket.on('createRoom', ({ playerName, timeControl, userId: userIdFromEvent }) => {
    const tabId = (socket.handshake.query.tabId as string) || socket.id;
    const ip = getClientIp(socket.handshake.address, socket.handshake.headers['x-forwarded-for']);
    const userId = userIdFromEvent || socketToUserId.get(socket.id);
    const room  = roomManager.createRoom(socket.id, tabId, playerName, ip, timeControl, userId);
    socket.join(room.id);
    socket.emit('roomCreated', { roomId: room.id, playerColor: 'red' });
    socket.emit('waitingForOpponent');
  });

  socket.on('joinRoom', ({ roomId, playerName, userId: userIdFromEvent }) => {
    const tabId = (socket.handshake.query.tabId as string) || socket.id;
    const ip = getClientIp(socket.handshake.address, socket.handshake.headers['x-forwarded-for']);
    const userId = userIdFromEvent || socketToUserId.get(socket.id);
    const room  = roomManager.joinRoom(socket.id, tabId, roomId, playerName, ip, userId);
    if (!room) {
      socket.emit('error', { message: 'Комната не найдена или заполнена' });
      return;
    }
    socket.join(room.id);
    socket.emit('roomJoined', { roomId: room.id, playerColor: 'blue' });
    broadcastGameState(room.id);
  });

  socket.on('placeMineSetup', ({ row, col }) => {
    const room  = roomManager.getRoom(socket.id);
    const color = roomManager.getPlayerColor(socket.id);
    if (!room || !color) return;
    const r = roomManager.placeMineSetup(room, color, row, col);
    if (!r.ok) { socket.emit('error', { message: r.error! }); return; }
    broadcastGameState(room.id);
  });

  socket.on('confirmSetup', () => {
    const room  = roomManager.getRoom(socket.id);
    const color = roomManager.getPlayerColor(socket.id);
    if (!room || !color) return;
    const r = roomManager.confirmSetup(room, color);
    if (!r.ok) { socket.emit('error', { message: r.error! }); return; }
    broadcastGameState(room.id);
  });

  socket.on('selectZone', ({ row, col }) => {
    const room  = roomManager.getRoom(socket.id);
    const color = roomManager.getPlayerColor(socket.id);
    if (!room || !color) return;
    const r = roomManager.selectZone(room, color, row, col);
    if (!r.ok) { socket.emit('error', { message: r.error! }); return; }
    broadcastGameState(room.id);
  });

  socket.on('captureCell', ({ row, col }) => {
    const room  = roomManager.getRoom(socket.id);
    const color = roomManager.getPlayerColor(socket.id);
    if (!room || !color) return;
    const r = roomManager.captureCell(room, color, row, col);
    if (!r.ok) { socket.emit('error', { message: r.error! }); return; }
    broadcastGameState(room.id);
  });

  socket.on('defuseCell', ({ row, col }) => {
    const room  = roomManager.getRoom(socket.id);
    const color = roomManager.getPlayerColor(socket.id);
    if (!room || !color) return;
    const r = roomManager.defuseCell(room, color, row, col);
    if (!r.ok) { socket.emit('error', { message: r.error! }); return; }
    broadcastGameState(room.id);
  });

  socket.on('chord', ({ row, col }) => {
    const room  = roomManager.getRoom(socket.id);
    const color = roomManager.getPlayerColor(socket.id);
    if (!room || !color) return;
    const r = roomManager.chordCapture(room, color, row, col);
    if (!r.ok) { socket.emit('error', { message: r.error! }); return; }
    broadcastGameState(room.id);
  });

  socket.on('endPhase2', () => {
    const room  = roomManager.getRoom(socket.id);
    const color = roomManager.getPlayerColor(socket.id);
    if (!room || !color) return;
    const r = roomManager.endPhase2(room, color);
    if (!r.ok) { socket.emit('error', { message: r.error! }); return; }
    broadcastGameState(room.id);
  });

  socket.on('endPhase3', () => {
    const room  = roomManager.getRoom(socket.id);
    const color = roomManager.getPlayerColor(socket.id);
    if (!room || !color) return;
    const r = roomManager.endPhase3(room, color);
    if (!r.ok) { socket.emit('error', { message: r.error! }); return; }
    broadcastGameState(room.id);
  });

  socket.on('placeMinePhase3', ({ row, col }) => {
    const room  = roomManager.getRoom(socket.id);
    const color = roomManager.getPlayerColor(socket.id);
    if (!room || !color) return;
    const r = roomManager.placeMinePhase3(room, color, row, col);
    if (!r.ok) { socket.emit('error', { message: r.error! }); return; }
    broadcastGameState(room.id);
  });

  socket.on('toggleMark', ({ row, col, mark }) => {
    const room  = roomManager.getRoom(socket.id);
    const color = roomManager.getPlayerColor(socket.id);
    if (!room || !color) return;
    roomManager.toggleMark(room, color, row, col, mark);
    const state = roomManager.getGameStateForPlayer(room, color);
    socket.emit('gameState', state as any);
  });

  socket.on('surrender', () => {
    const room  = roomManager.getRoom(socket.id);
    const color = roomManager.getPlayerColor(socket.id);
    if (!room || !color) return;
    if (room.turn.phase === 'finished') return;
    roomManager.surrender(room, color);
    broadcastGameState(room.id);
  });

  socket.on('leaveRoom', () => {
    const room = roomManager.leaveRoom(socket.id);
    if (room) {
      // Если в комнате ещё кто-то остался — обновить ему состояние / уведомить.
      if (room.players.length > 0) broadcastGameState(room.id);
      console.log(`[leaveRoom] ${socket.id} left room ${room.id}`);
    }
  });

  socket.on('soloLog', (payload: SoloLogPayload) => {
    handleSoloLog(socket.id, socket.handshake, payload);
  });

  socket.on('disconnect', () => {
    const { room } = roomManager.removePlayer(socket.id);
    if (room) console.log(`[disconnect] left room ${room.id}`);
    // Закрыть незакрытую solo-сессию: пишем game_finished='aborted' если игра
    // не дошла до естественного конца. Recorder сам закроет meta.
    const rec = soloRecorders.get(socket.id);
    if (rec) {
      if (!rec.meta.endedAt) rec.gameFinished(null, 'aborted');
      soloRecorders.delete(socket.id);
    }
    socketToUserId.delete(socket.id);
  });
});

app.get('/health', (_, res) => res.json({ ok: true }));

setInterval(() => {
  const finished = roomManager.tickTimeouts();
  for (const room of finished) {
    broadcastGameState(room.id);
  }
}, 1000).unref?.();

const PORT = process.env.PORT || 3001;
httpServer.listen(PORT, () => console.log(`Server on port ${PORT}`));
