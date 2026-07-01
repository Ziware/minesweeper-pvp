import express from 'express';
import { createServer } from 'http';
import { Server } from 'socket.io';
import cors from 'cors';
import jwt from 'jsonwebtoken';
import {
  ServerToClientEvents,
  ClientToServerEvents,
  PlayerColor,
} from '@minesweeper-pvp/shared';
import { RoomManager, type Room } from './roomManager';
import { getClientIp } from './gameRecorder';

const JWT_SECRET = process.env.JWT_SECRET || '';

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

/**
 * If it's the bot's turn, serialize engine state and emit botTurn to the human
 * player's socket (who is running the bot AI in a Web Worker).
 */
function maybeSendBotTurn(room: Room): void {
  const bot = room.players.find((p) => p.isBot);
  if (!bot || !room.botSocketId || room.phase === 'finished') return;

  // During setup phase: bot sends moves until its setup is confirmed
  const isBotSetupTurn = room.phase === 'setup' && !bot.setupConfirmed;
  // During game: it's bot's turn
  const isBotGameTurn = room.phase !== 'setup' && room.turn.currentPlayer === bot.color;

  if (!isBotSetupTurn && !isBotGameTurn) return;

  const snapshot = roomManager.serializeEngineState(room, bot.color, bot.botDifficulty!);
  io.to(room.botSocketId).emit('botTurn', snapshot);
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
      socket.emit('sessionInvalid', { message: result.error || 'Сессия истекла' });
      return;
    }
    socket.join(result.room.id);
    socket.emit('sessionRestored', { playerColor, roomId });
    const state = roomManager.getGameStateForPlayer(result.room, playerColor);
    socket.emit('gameState', state as any);
    console.log(`[restore] ${playerColor} tab=${tabId} room=${roomId}`);
    // If restored into a bot game and it's the bot's turn, re-emit botTurn
    maybeSendBotTurn(result.room);
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

  socket.on('createBotRoom', ({ playerName, difficulty, humanColor, userId: userIdFromEvent }) => {
    const tabId = (socket.handshake.query.tabId as string) || socket.id;
    const ip = getClientIp(socket.handshake.address, socket.handshake.headers['x-forwarded-for']);
    const userId = userIdFromEvent || socketToUserId.get(socket.id);
    const room = roomManager.createBotRoom(socket.id, tabId, playerName, difficulty, humanColor, ip, userId);
    socket.join(room.id);
    socket.emit('roomCreated', { roomId: room.id, playerColor: humanColor });
    broadcastGameState(room.id);
    // Immediately trigger bot's setup turn
    maybeSendBotTurn(room);
  });

  socket.on('botMove', (move) => {
    const room = roomManager.getRoom(socket.id);
    if (!room) return;
    const bot = room.players.find((p) => p.isBot);
    if (!bot) return;
    const botColor = bot.color;

    // Dispatch the bot's move to the room manager
    switch (move.type) {
      case 'placeMineSetup': {
        const r = roomManager.placeMineSetup(room, botColor, move.row, move.col);
        if (!r.ok) { console.warn('[botMove] placeMineSetup error:', r.error); return; }
        break;
      }
      case 'confirmSetup': {
        const r = roomManager.confirmSetup(room, botColor);
        if (!r.ok) { console.warn('[botMove] confirmSetup error:', r.error); return; }
        break;
      }
      case 'selectZone': {
        const r = roomManager.selectZone(room, botColor, move.row, move.col);
        if (!r.ok) { console.warn('[botMove] selectZone error:', r.error); return; }
        break;
      }
      case 'captureCell': {
        const r = roomManager.captureCell(room, botColor, move.row, move.col);
        if (!r.ok) { console.warn('[botMove] captureCell error:', r.error); return; }
        break;
      }
      case 'defuseCell': {
        const r = roomManager.defuseCell(room, botColor, move.row, move.col);
        if (!r.ok) { console.warn('[botMove] defuseCell error:', r.error); return; }
        break;
      }
      case 'chord': {
        const r = roomManager.chordCapture(room, botColor, move.row, move.col);
        if (!r.ok) { console.warn('[botMove] chord error:', r.error); return; }
        break;
      }
      case 'endPhase2': {
        const r = roomManager.endPhase2(room, botColor);
        if (!r.ok) { console.warn('[botMove] endPhase2 error:', r.error); return; }
        break;
      }
      case 'placeMinePhase3': {
        const r = roomManager.placeMinePhase3(room, botColor, move.row, move.col);
        if (!r.ok) { console.warn('[botMove] placeMinePhase3 error:', r.error); return; }
        break;
      }
      case 'endPhase3': {
        const r = roomManager.endPhase3(room, botColor);
        if (!r.ok) { console.warn('[botMove] endPhase3 error:', r.error); return; }
        break;
      }
      case 'forfeit': {
        roomManager.surrender(room, botColor);
        break;
      }
    }

    broadcastGameState(room.id);
    if (room.phase !== 'finished') {
      maybeSendBotTurn(room);
    }
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
    // If game started and bot goes first, trigger bot's turn
    maybeSendBotTurn(room);
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
    // Turn switched — bot might need to go
    maybeSendBotTurn(room);
  });

  socket.on('placeMinePhase3', ({ row, col }) => {
    const room  = roomManager.getRoom(socket.id);
    const color = roomManager.getPlayerColor(socket.id);
    if (!room || !color) return;
    const r = roomManager.placeMinePhase3(room, color, row, col);
    if (!r.ok) { socket.emit('error', { message: r.error! }); return; }
    broadcastGameState(room.id);
    // If the last mine was placed, turn ended — bot might need to go
    if (r.done && room.phase !== 'finished') {
      maybeSendBotTurn(room);
    }
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
      if (room.players.length > 0) broadcastGameState(room.id);
      console.log(`[leaveRoom] ${socket.id} left room ${room.id}`);
    }
  });

  socket.on('disconnect', () => {
    const { room } = roomManager.removePlayer(socket.id);
    if (room) console.log(`[disconnect] left room ${room.id}`);
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
