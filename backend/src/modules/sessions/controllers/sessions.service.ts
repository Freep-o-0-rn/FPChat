import { Injectable } from '@nestjs/common';

import { PrismaService } from '@/common/prisma.service';

@Injectable()
export class SessionsService {
  constructor(private readonly prisma: PrismaService) {}

  list(userId: string) {
    return this.prisma.userSession.findMany({ where: { userId }, orderBy: { createdAt: 'desc' } });
  }

  async revoke(userId: string, sessionId: string) {
    await this.prisma.userSession.updateMany({
      where: { id: sessionId, userId },
      data: { revokedAt: new Date() }
    });
    return { ok: true };
  }
}