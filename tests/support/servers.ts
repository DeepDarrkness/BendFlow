import { createServer, type Server, type Socket } from 'node:net';
import type { Socket as DatagramSocket } from 'node:dgram';
import type { TestContext } from 'node:test';
import { bounded } from './deadlines.ts';
import { cleanupPriority, resources } from './resources.ts';

export async function listen(t: TestContext, server: Server, port = 0): Promise<number> {
  const sockets = new Set<Socket>();
  server.on('connection', socket => {
    sockets.add(socket);
    socket.on('error', () => {});
    socket.once('close', () => sockets.delete(socket));
  });
  resources(t).add(cleanupPriority.peer, async () => {
    for (const socket of sockets) socket.destroy();
    if (!server.listening) return;
    await bounded(new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve())));
  });
  await bounded(new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, '127.0.0.1', () => { server.off('error', reject); resolve(); });
  }));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Expected fixture port');
  return address.port;
}

export function fixtureServer(t: TestContext, onConnection: (socket: Socket) => void): Promise<number> {
  return listen(t, createServer(onConnection));
}

export async function bindUdp(t: TestContext, peer: DatagramSocket, port = 0): Promise<void> {
  resources(t).add(cleanupPriority.peer, () => new Promise<void>(resolve => {
    try { peer.close(resolve); }
    catch (error) {
      if (error instanceof Error && 'code' in error && error.code === 'ERR_SOCKET_DGRAM_NOT_RUNNING') resolve();
      else throw error;
    }
  }));
  await bounded(new Promise<void>((resolve, reject) => {
    peer.once('error', reject);
    peer.bind(port, '127.0.0.1', () => { peer.off('error', reject); resolve(); });
  }));
}
