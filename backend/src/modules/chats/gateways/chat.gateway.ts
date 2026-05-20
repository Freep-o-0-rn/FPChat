import {
  ConnectedSocket,
  MessageBody,
  OnGatewayConnection,
  OnGatewayDisconnect,
  SubscribeMessage,
  WebSocketGateway,
  WebSocketServer
} from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';

import { RedisService } from '@/common/redis/redis.service';

@WebSocketGateway({ cors: { origin: true, credentials: true }, namespace: '/realtime' })
export class ChatGateway implements OnGatewayConnection, OnGatewayDisconnect {
  @WebSocketServer()
  server!: Server;

  constructor(private readonly redis: RedisService) {}

  async handleConnection(client: Socket): Promise<void> {
    await this.redis.client.setex(`presence:${client.id}`, 30, 'online');
  }

  async handleDisconnect(client: Socket): Promise<void> {
    await this.redis.client.del(`presence:${client.id}`);
  }

  @SubscribeMessage('chat:join')
  async joinRoom(@ConnectedSocket() client: Socket, @MessageBody() payload: { chatId: string }) {
    await client.join(payload.chatId);
    return { ok: true };
  }

  @SubscribeMessage('typing:start')
  async typingStart(@ConnectedSocket() client: Socket, @MessageBody() payload: { chatId: string; userId: string }) {
    await this.redis.client.setex(`typing:${payload.chatId}:${payload.userId}`, 5, '1');
    client.to(payload.chatId).emit('typing:update', payload);
  }

  @SubscribeMessage('typing:stop')
  async typingStop(@ConnectedSocket() client: Socket, @MessageBody() payload: { chatId: string; userId: string }) {
    await this.redis.client.del(`typing:${payload.chatId}:${payload.userId}`);
    client.to(payload.chatId).emit('typing:update', payload);
  }
}