import { Injectable } from '@nestjs/common';

import { PrismaService } from '@/common/prisma.service';
import { SendMessageDto } from '../dto/send-message.dto';

@Injectable()
export class MessagesService {
  constructor(private readonly prisma: PrismaService) {}

  async send(senderId: string, dto: SendMessageDto) {
    const message = await this.prisma.message.create({
      data: {
        chatId: dto.chatId,
        senderId,
        type: dto.type,
        ciphertext: dto.ciphertext,
        nonce: dto.nonce,
        replyToId: dto.replyToId
      }
    });

    await this.prisma.deliveryStatus.createMany({
      data: dto.recipientIds.map((recipientId) => ({ messageId: message.id, userId: recipientId, status: 'sent' }))
    });

    return message;
  }

  history(chatId: string, cursor?: string) {
    return this.prisma.message.findMany({
      where: { chatId, deletedAt: null },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      take: 50
    });
  }
}