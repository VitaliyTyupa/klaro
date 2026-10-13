import { WebSocketGateway, SubscribeMessage, ConnectedSocket, MessageBody, type OnGatewayInit, type OnGatewayDisconnect } from '@nestjs/websockets';
import type { IncomingMessage } from 'node:http';
import type { Server, Socket } from 'socket.io';
import { z } from 'zod';
import { authenticateRequest } from '../identity/controller';
import type { AuthenticatedSession } from '../identity/sessions';
import { operations } from './runtime';
import { ApplicationError } from './errors';
import { transportError } from './transport-errors';

const origins = new Set([process.env['APP_ORIGIN'] ?? 'http://localhost:4200', ...(process.env['EXTENSION_ORIGINS'] ?? '').split(',').filter(Boolean)]);
const reference = z.strictObject({ operationId: z.uuid() });

@WebSocketGateway({ namespace: '/v1/operations', transports: ['websocket'], maxHttpBufferSize: 1000000, cors: { origin: [...origins], credentials: true } })
export class OperationsGateway implements OnGatewayInit, OnGatewayDisconnect {
  private readonly clients = new Map<string, { socket: Socket; request: IncomingMessage; actor: AuthenticatedSession; expiry: NodeJS.Timeout }>();

  afterInit(server: Server): void {
    server.use((socket, next) => {
      void this.authenticate(socket).then(() => next(), () => next(new Error('unauthenticated')));
    });
    operations.subscribe((userId, event) => {
      for (const client of this.clients.values()) {
        if (client.actor.userId !== userId) continue;
        void operations.deliverIfActive(client.actor, () => {
          if (client.socket.connected) client.socket.emit('operation.event', event);
        }).catch(() => client.socket.disconnect(true));
      }
    });
  }

  private async authenticate(socket: Socket): Promise<void> {
    if (typeof socket.handshake.headers.origin !== 'string' || !origins.has(socket.handshake.headers.origin)) throw new ApplicationError('forbidden');
    const auth = z.strictObject({ token: z.string().regex(/^[a-zA-Z0-9_-]{43}$/).optional(), csrfToken: z.string().max(128).optional() }).safeParse(socket.handshake.auth);
    if (!auth.success) throw new ApplicationError('unauthenticated');
    const request = Object.assign(Object.create(socket.request), { headers: { ...socket.request.headers, ...(auth.data.token ? { authorization: `Bearer ${auth.data.token}` } : {}), 'x-csrf-token': auth.data.csrfToken } }) as IncomingMessage;
    const actor = await authenticateRequest(request, true);
    const expiry = setTimeout(() => socket.disconnect(true), Math.max(0, actor.expiresAt.getTime() - Date.now()));
    expiry.unref();
    this.clients.set(socket.id, { socket, request, actor, expiry });
  }

  handleDisconnect(socket: Socket): void { const client = this.clients.get(socket.id); if (client) clearTimeout(client.expiry); this.clients.delete(socket.id); }

  private async execute(socket: Socket, action: (actor: AuthenticatedSession) => Promise<unknown>): Promise<unknown> {
    try {
      const client = this.clients.get(socket.id);
      if (!client) throw new ApplicationError('unauthenticated');
      return await action(await authenticateRequest(client.request, true));
    } catch (error) { return { error: transportError(error) }; }
  }

  @SubscribeMessage('operation.accept')
  accept(@ConnectedSocket() socket: Socket, @MessageBody() body: unknown): Promise<unknown> { return this.execute(socket, actor => operations.accept(actor, body)); }

  @SubscribeMessage('operation.snapshot')
  snapshot(@ConnectedSocket() socket: Socket, @MessageBody() body: unknown): Promise<unknown> {
    return this.execute(socket, actor => { const parsed = reference.safeParse(body); if (!parsed.success) throw new ApplicationError('invalid-request'); return operations.snapshot(actor, parsed.data.operationId); });
  }

  @SubscribeMessage('operation.cancel')
  cancel(@ConnectedSocket() socket: Socket, @MessageBody() body: unknown): Promise<unknown> {
    return this.execute(socket, actor => { const parsed = reference.safeParse(body); if (!parsed.success) throw new ApplicationError('invalid-request'); return operations.cancel(actor, parsed.data.operationId); });
  }
}
