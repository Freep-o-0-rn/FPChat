import { Injectable } from '@nestjs/common';

import { PrismaService } from '@/common/prisma.service';

@Injectable()
export class AuthRepository {
  constructor(private readonly prisma: PrismaService) {}

  findUserByNickname(nickname: string) {
    return this.prisma.user.findUnique({ where: { nickname } });
  }

  createSession(data: { userId: string; refreshTokenHash: string; userAgent?: string; ipAddress?: string }) {
    return this.prisma.userSession.create({ data });
  }

  updateSessionRefreshHash(sessionId: string, refreshTokenHash: string) {
    return this.prisma.userSession.update({ where: { id: sessionId }, data: { refreshTokenHash } });
  }

  revokeSession(sessionId: string) {
    return this.prisma.userSession.update({ where: { id: sessionId }, data: { revokedAt: new Date() } });
  }
}