import { Injectable } from '@nestjs/common';

import { PrismaService } from '@/common/prisma.service';
import { CreateGroupDto } from '../dto/create-group.dto';

@Injectable()
export class GroupsService {
  constructor(private readonly prisma: PrismaService) {}

  create(ownerId: string, dto: CreateGroupDto) {
    const memberIds = Array.from(new Set([ownerId, ...dto.memberIds]));
    return this.prisma.chat.create({
      data: {
        type: 'GROUP',
        title: dto.title,
        avatarUrl: dto.avatarUrl,
        members: {
          createMany: {
            data: memberIds.map((id) => ({ userId: id, role: id === ownerId ? 'owner' : 'member' }))
          }
        }
      },
      include: { members: true }
    });
  }
}