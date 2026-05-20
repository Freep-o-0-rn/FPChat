import { io, Socket } from 'socket.io-client';

let socket: Socket | null = null;

export function connectSocket(token: string): Socket {
  if (!socket) {
    socket = io((import.meta.env.VITE_WS_URL ?? 'http://localhost:3000') + '/realtime', {
      auth: { token }
    });
  }
  return socket;
}