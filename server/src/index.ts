import express from 'express';
import http from 'http';
import { Server as SocketIOServer, Socket } from 'socket.io';
import cors from 'cors';
import path from 'path';
import { fileURLToPath } from 'url';
import { Room } from './room.js';
import type { GameState } from '@monopoly/shared';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const app = express();
app.use(cors());
app.use(express.json());

// Optional: serve built client in production
const clientDist = path.resolve(__dirname, '../../client/dist');
app.use(express.static(clientDist));

const server = http.createServer(app);
const io = new SocketIOServer(server, {
  cors: { origin: '*', methods: ['GET', 'POST'] },
});

/** In-memory room storage (fine for 3-player indie scale; swap for Redis for scale). */
const rooms = new Map<string, Room>();
/** socketId -> {roomCode, playerId} */
const sessions = new Map<string, { roomCode: string; playerId: string }>();

function genCode(): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let s = '';
  do { s = ''; for (let i=0;i<6;i++) s += chars[Math.floor(Math.random()*chars.length)]; }
  while (rooms.has(s));
  return s;
}

function broadcastState(room: Room) {
  const state = room.state();
  io.to(room.code).emit('state', state);
}

function emitEvent(room: Room, evt: any) {
  io.to(room.code).emit('event', evt);
}

io.on('connection', (socket: Socket) => {
  console.log('socket connected', socket.id);

  socket.on('createRoom', ({ name }: { name: string }, cb) => {
    try {
      const code = genCode();
      const room = new Room(code, broadcastState, emitEvent);
      const player = room.addPlayer(socket.id, name || 'Player 1', true);
      rooms.set(code, room);
      sessions.set(socket.id, { roomCode: code, playerId: player.id });
      socket.join(code);
      cb({ ok: true, code, playerId: player.id });
      broadcastState(room);
    } catch (e: any) { cb({ ok: false, error: e.message }); }
  });

  socket.on('joinRoom', ({ code, name }: { code: string; name: string }, cb) => {
    try {
      const room = rooms.get((code || '').toUpperCase());
      if (!room) return cb({ ok: false, error: 'Room not found' });
      const player = room.addPlayer(socket.id, name || 'Player', false);
      sessions.set(socket.id, { roomCode: room.code, playerId: player.id });
      socket.join(room.code);
      cb({ ok: true, code: room.code, playerId: player.id });
      broadcastState(room);
    } catch (e: any) { cb({ ok: false, error: e.message }); }
  });

  /** Auto-guard helper — runs an action against the room this socket is in. */
  const withRoom = (fn: (room: Room) => void) => {
    const s = sessions.get(socket.id);
    if (!s) return socket.emit('error', 'Not in a room');
    const room = rooms.get(s.roomCode);
    if (!room) return socket.emit('error', 'Room not found');
    try {
      fn(room);
      broadcastState(room);
    } catch (e: any) {
      socket.emit('error', e.message || 'Action failed');
    }
  };

  socket.on('startGame', () => withRoom(r => r.start(socket.id)));
  socket.on('roll', () => withRoom(r => r.roll(socket.id)));
  socket.on('buy', () => withRoom(r => r.resolveBuy(socket.id)));
  socket.on('decline', () => withRoom(r => r.resolveDecline(socket.id)));
  socket.on('auctionBid', ({ amount }: { amount: number }) => withRoom(r => r.auctionBid(socket.id, amount)));
  socket.on('auctionPass', () => withRoom(r => r.auctionPass(socket.id)));
  socket.on('build', ({ propId }: { propId: number }) => withRoom(r => r.build(socket.id, propId)));
  socket.on('sell', ({ propId }: { propId: number }) => withRoom(r => r.sellBuilding(socket.id, propId)));
  socket.on('mortgage', ({ propId }: { propId: number }) => withRoom(r => r.mortgage(socket.id, propId)));
  socket.on('unmortgage', ({ propId }: { propId: number }) => withRoom(r => r.unmortgage(socket.id, propId)));
  socket.on('proposeTrade', (data: any) => withRoom(r => r.proposeTrade(socket.id, data)));
  socket.on('respondTrade', ({ accept }: { accept: boolean }) => withRoom(r => r.respondTrade(socket.id, accept)));
  socket.on('payFine', () => withRoom(r => r.payFine(socket.id)));
  socket.on('useJailCard', () => withRoom(r => r.useJailCard(socket.id)));
  socket.on('endTurn', () => withRoom(r => r.endTurn(socket.id)));
  socket.on('requestState', () => withRoom(() => {}));

  socket.on('disconnect', () => {
    const s = sessions.get(socket.id);
    if (!s) return;
    const room = rooms.get(s.roomCode);
    if (!room) return;
    room.disconnectPlayer(s.playerId);
    broadcastState(room);
    sessions.delete(socket.id);
    // Clean empty rooms after a short delay
    setTimeout(() => {
      if (room.state().players.every(p => !p.connected)) rooms.delete(room.code);
    }, 60_000);
  });
});

const PORT = Number(process.env.PORT || 4000);
server.listen(PORT, () => console.log(`Monopoly server listening on :${PORT}`));