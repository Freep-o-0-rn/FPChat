import { BadRequestException, Injectable } from '@nestjs/common';
import { randomBytes } from 'crypto';

import { PrismaService } from '@/common/prisma.service';
import { CreateInviteDto } from '../dto/create-invite.dto';

@Injectable()
export class InvitesService {
  constructor(private readonly prisma: PrismaService) {}

  async createInvite(dto: CreateInviteDto) {
    return this.prisma.invite.create({
      data: {
        code: randomBytes(18).toString('base64url'),
        maxActivations: dto.maxActivations ?? 1
      }
    });
  }

  async consumeInvite(code: string): Promise<void> {
    const invite = await this.prisma.invite.findUnique({ where: { code } });
    if (!invite) throw new BadRequestException('Invalid invite code');
    if (invite.usedActivations >= invite.maxActivations) {
      throw new BadRequestException('Invite code exhausted');
    }

    await this.prisma.invite.update({ where: { id: invite.id }, data: { usedActivations: { increment: 1 } } });
  }
}