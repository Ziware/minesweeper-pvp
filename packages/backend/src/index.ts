import express from 'express';
import { createServer } from 'http';
import { Server } from 'socket.io';
import cors from 'cors';
import { ServerToClientEvents, ClientToServerEvents } from '@minesweeper-pvp/shared';
import { RoomManager } from './roomManager';

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
    io.to(roomId).emit('gameOver', {
      winnerColor: room.winner,
      reason: room.winReason || 'lives',
    });
  }
}

io.on('connection', (socket) => {
  console.log('Connected:', socket.id);

  // Восстановление сессии после перезагрузки
  socket.on('restoreSession', ({ roomId, playerColor }) => {
    const room = roomManager.restoreSession(socket.id, roomId, playerColor);
    if (!room) {
      socket.emit('error', { message: 'Session expired or room not found' });
      return;
    }
    socket.join(room.id);
    socket.emit('sessionRestored', { playerColor, roomId });
    const state = roomManager.getGameStateForPlayer(room, playerColor);
    socket.emit('gameState', state as any);
    console.log(`Session restored: ${playerColor} in room ${roomId}`);
  });

  socket.on('createRoom', ({ playerName }) => {
    const room = roomManager.createRoom(socket.id, playerName);
    socket.join(room.id);
    socket.emit('roomCreated', { roomId: room.id, playerColor: 'red' });
    socket.emit('waitingForOpponent');
  });

  socket.on('joinRoom', ({ roomId, playerName }) => {
    const room = roomManager.joinRoom(socket.id, roomId.toUpperCase(), playerName);
    if (!room) {
      socket.emit('error', { message: 'Room not found or full' });
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
    const result = roomManager.placeMineSetup(room, color, row, col);
    if (!result.ok) { socket.emit('error', { message: result.error! }); return; }
    broadcastGameState(room.id);
  });

  socket.on('confirmSetup', () => {
    const room  = roomManager.getRoom(socket.id);
    const color = roomManager.getPlayerColor(socket.id);
    if (!room || !color) return;
    const result = roomManager.confirmSetup(room, color);
    if (!result.ok) { socket.emit('error', { message: result.error! }); return; }
    broadcastGameState(room.id);
  });

  socket.on('selectZone', ({ row, col }) => {
    const room  = roomManager.getRoom(socket.id);
    const color = roomManager.getPlayerColor(socket.id);
    if (!room || !color) return;
    const result = roomManager.selectZone(room, color, row, col);
    if (!result.ok) { socket.emit('error', { message: result.error! }); return; }
    broadcastGameState(room.id);
  });

  socket.on('captureCell', ({ row, col }) => {
    const room  = roomManager.getRoom(socket.id);
    const color = roomManager.getPlayerColor(socket.id);
    if (!room || !color) return;
    const result = roomManager.captureCell(room, color, row, col);
    if (!result.ok) { socket.emit('error', { message: result.error! }); return; }
    broadcastGameState(room.id);
  });

  socket.on('defuseCell', ({ row, col }) => {
    const room  = roomManager.getRoom(socket.id);
    const color = roomManager.getPlayerColor(socket.id);
    if (!room || !color) return;
    const result = roomManager.defuseCell(room, color, row, col);
    if (!result.ok) { socket.emit('error', { message: result.error! }); return; }
    broadcastGameState(room.id);
  });

  socket.on('endPhase2', () => {
    const room  = roomManager.getRoom(socket.id);
    const color = roomManager.getPlayerColor(socket.id);
    if (!room || !color) return;
    const result = roomManager.endPhase2(room, color);
    if (!result.ok) { socket.emit('error', { message: result.error! }); return; }
    broadcastGameState(room.id);
  });

  socket.on('placeMinePhase3', ({ row, col }) => {
    const room  = roomManager.getRoom(socket.id);
    const color = roomManager.getPlayerColor(socket.id);
    if (!room || !color) return;
    const result = roomManager.placeMinePhase3(room, color, row, col);
    if (!result.ok) { socket.emit('error', { message: result.error! }); return; }
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

  socket.on('disconnect', () => {
    const { room } = roomManager.removePlayer(socket.id);
    if (room) console.log(`Player left room ${room.id}`);
  });
});

app.get('/health', (_, res) => res.json({ ok: true }));

const PORT = process.env.PORT || 3001;
httpServer.listen(PORT, () => console.log(`Server on port ${PORT}`));
