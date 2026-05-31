import express from 'express';
import { createServer } from 'http';
import { Server } from 'socket.io';
import cors from 'cors';
import { ServerToClientEvents, ClientToServerEvents } from '@minesweeper-pvp/shared';
import { RoomManager } from './roomManager';
import { getClientIp } from './gameLogger';

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
    for (const player of room.players) {
      io.to(player.id).emit('gameOver', {
        winnerColor: room.winner!,
        reason: room.winReason || 'lives',
      });
    }
  }
}

io.on('connection', (socket) => {
  console.log('[connect]', socket.id);

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

  socket.on('createRoom', ({ playerName, timeControl }) => {
    const tabId = (socket.handshake.query.tabId as string) || socket.id;
    const ip = getClientIp(socket.handshake.address, socket.handshake.headers['x-forwarded-for']);
    const room  = roomManager.createRoom(socket.id, tabId, playerName, ip, timeControl);
    socket.join(room.id);
    socket.emit('roomCreated', { roomId: room.id, playerColor: 'red' });
    socket.emit('waitingForOpponent');
  });

  socket.on('joinRoom', ({ roomId, playerName }) => {
    const tabId = (socket.handshake.query.tabId as string) || socket.id;
    const ip = getClientIp(socket.handshake.address, socket.handshake.headers['x-forwarded-for']);
    const room  = roomManager.joinRoom(socket.id, tabId, roomId.toUpperCase(), playerName, ip);
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

  socket.on('leaveRoom', () => {
    const room = roomManager.leaveRoom(socket.id);
    if (room) {
      // Если в комнате ещё кто-то остался — обновить ему состояние / уведомить.
      if (room.players.length > 0) broadcastGameState(room.id);
      console.log(`[leaveRoom] ${socket.id} left room ${room.id}`);
    }
  });

  socket.on('disconnect', () => {
    const { room } = roomManager.removePlayer(socket.id);
    if (room) console.log(`[disconnect] left room ${room.id}`);
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
