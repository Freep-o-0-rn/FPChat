import { Injectable } from '@nestjs/common';

import { PrismaService } from '@/common/prisma.service';
import { CreateChatDto } from '../dto/create-chat.dto';

@Injectable()
export class ChatsService {
  constructor(private readonly prisma: PrismaService) {}

  async listChats(userId: string) {
    return this.prisma.chat.findMany({
      where: { members: { some: { userId } } },
      include: { members: true },
      orderBy: { updatedAt: 'desc' }
    });
  }

  async createPrivateChat(userId: string, dto: CreateChatDto) {
    return this.prisma.chat.create({
      data: {
        type: 'DIRECT',
        members: {
          createMany: { data: [userId, ...dto.participantIds].map((memberId) => ({ userId: memberId, role: 'member' })) }
        }
      },
      include: { members: true }
    });
  }
}