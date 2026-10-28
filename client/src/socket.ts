import { io, Socket } from 'socket.io-client';

/**
 * Client socket singleton. Connects to same origin in prod (served by Express),
 * localhost:4000 in dev (via Vite proxy the URL is /socket.io → 4000, so this
 * works seamlessly in both).
 */
export const socket: Socket = io({
  autoConnect: true,
  transports: ['websocket', 'polling'],
});