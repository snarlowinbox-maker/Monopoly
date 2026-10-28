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

const clientDist = path.resolve(__dirname, '../../client/dist');
app.use(express.static(clientDist));

const server = http.createServer(app);
const io = new SocketIOServer(server, {
  cors: { origin: '*', methods: ['GET', 'POST'] },
});

const rooms = new Map<string, Room>();
const sessions = new Map<string, { roomCode: string; playerId: string }>();

function genCode(): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let s = '';
  do { s = ''; for (let i = 0; i < 6; i++) s += chars[Math.floor(Math.random() * chars.length)]; }
  while (rooms.has(s));
  return s;
}

function broadcastState(room: Room) {
  io.to(room.code).emit('state', room.state());
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

  const withRoom = (fn: (room: Room, playerId: string) => void) => {
    const s = sessions.get(socket.id);
    if (!s) return socket.emit('error', 'Not in a room');
    const room = rooms.get(s.roomCode);
    if (!room) return socket.emit('error', 'Room not found');
    try {
      fn(room, s.playerId);
      broadcastState(room);
    } catch (e: any) {
      console.error('[action error]', e.message || e);
      socket.emit('error', e.message || 'Action failed');
    }
  };

  socket.on('startGame',    () => withRoom((r, pid) => r.start(pid)));
  socket.on('roll',         () => withRoom((r, pid) => r.roll(pid)));
  socket.on('buy',          () => withRoom((r, pid) => r.resolveBuy(pid)));
  socket.on('decline',      () => withRoom((r, pid) => r.resolveDecline(pid)));
  socket.on('auctionBid',   ({ amount }) => withRoom((r, pid) => r.auctionBid(pid, amount)));
  socket.on('auctionPass',  () => withRoom((r, pid) => r.auctionPass(pid)));
  socket.on('build',        ({ propId }) => withRoom((r, pid) => r.build(pid, propId)));
  socket.on('sell',         ({ propId }) => withRoom((r, pid) => r.sellBuilding(pid, propId)));
  socket.on('mortgage',     ({ propId }) => withRoom((r, pid) => r.mortgage(pid, propId)));
  socket.on('unmortgage',   ({ propId }) => withRoom((r, pid) => r.unmortgage(pid, propId)));
  socket.on('proposeTrade', (data) => withRoom((r, pid) => r.proposeTrade(pid, data)));
  socket.on('respondTrade', ({ accept }) => withRoom((r, pid) => r.respondTrade(pid, accept)));
  socket.on('payFine',      () => withRoom((r, pid) => r.payFine(pid)));
  socket.on('useJailCard',  () => withRoom((r, pid) => r.useJailCard(pid)));
  socket.on('endTurn',      () => withRoom((r, pid) => r.endTurn(pid)));
  socket.on('requestState', () => withRoom(() => {}));

  socket.on('disconnect', () => {
    const s = sessions.get(socket.id);
    if (!s) return;
    const room = rooms.get(s.roomCode);
    if (!room) return;
    room.disconnectPlayer(s.playerId);
    broadcastState(room);
    sessions.delete(socket.id);
    setTimeout(() => {
      if (room.state().players.every(p => !p.connected)) rooms.delete(room.code);
    }, 60_000);
  });
});

const PORT = Number(process.env.PORT || 4000);
server.listen(PORT, () => console.log(`Monopoly server listening on :${PORT}`));