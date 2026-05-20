import { Injectable } from '@nestjs/common';

import { PrismaService } from '@/common/prisma.service';

@Injectable()
export class UsersService {
  constructor(private readonly prisma: PrismaService) {}

  me(userId: string) {
    return this.prisma.user.findUniqueOrThrow({
      where: { id: userId },
      select: { id: true, nickname: true, displayName: true, avatarUrl: true, lastSeenAt: true }
    });
  }

  searchByNickname(nickname: string) {
    return this.prisma.user.findMany({
      where: { nickname: { startsWith: nickname } },
      take: 10,
      select: { id: true, nickname: true, displayName: true, avatarUrl: true }
    });
  }
}