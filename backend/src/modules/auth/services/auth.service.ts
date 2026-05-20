import { ForbiddenException, Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import * as argon2 from 'argon2';
import { randomUUID } from 'crypto';

import { JwtPayload } from '@fpchat/shared';
import { PrismaService } from '@/common/prisma.service';
import { InvitesService } from '@/modules/invites/services/invites.service';
import { AuthRepository } from '../repositories/auth.repository';
import { LoginDto } from '../dto/login.dto';
import { RegisterDto } from '../dto/register.dto';

@Injectable()
export class AuthService {
  constructor(
    private readonly authRepository: AuthRepository,
    private readonly inviteService: InvitesService,
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
    private readonly config: ConfigService
  ) {}

  async register(dto: RegisterDto): Promise<{ accessToken: string; refreshToken: string }> {
    await this.inviteService.consumeInvite(dto.inviteCode);
    const passwordHash = await argon2.hash(dto.password);

    const user = await this.prisma.user.create({
      data: {
        nickname: dto.nickname,
        passwordHash,
        displayName: dto.displayName ?? dto.nickname,
        identityPublicKey: dto.identityPublicKey
      }
    });

    return this.issueTokens(user.id, user.nickname);
  }

  async login(dto: LoginDto): Promise<{ accessToken: string; refreshToken: string }> {
    const user = await this.authRepository.findUserByNickname(dto.nickname);
    if (!user) throw new UnauthorizedException('Invalid credentials');

    const ok = await argon2.verify(user.passwordHash, dto.password);
    if (!ok) throw new UnauthorizedException('Invalid credentials');

    return this.issueTokens(user.id, user.nickname);
  }

  async refreshByToken(refreshToken: string): Promise<{ accessToken: string; refreshToken: string }> {
    const payload = await this.jwt.verifyAsync<JwtPayload>(refreshToken, {
      secret: this.config.getOrThrow<string>('JWT_REFRESH_SECRET')
    });
    return this.refresh(payload.sessionId, refreshToken);
  }

  async refresh(sessionId: string, refreshToken: string): Promise<{ accessToken: string; refreshToken: string }> {
    const session = await this.prisma.userSession.findUnique({ where: { id: sessionId } });
    if (!session || session.revokedAt) throw new ForbiddenException('Session revoked');

    const valid = await argon2.verify(session.refreshTokenHash, refreshToken);
    if (!valid) throw new UnauthorizedException('Invalid refresh token');

    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: session.userId } });
    return this.issueTokens(user.id, user.nickname, session.id);
  }

  async logout(sessionId: string): Promise<void> {
    await this.authRepository.revokeSession(sessionId);
  }

  private async issueTokens(userId: string, nickname: string, sessionId = randomUUID()) {
    const payload: JwtPayload = { sub: userId, sessionId, nickname };

    const accessToken = await this.jwt.signAsync(payload, {
      secret: this.config.getOrThrow<string>('JWT_ACCESS_SECRET'),
      expiresIn: this.config.getOrThrow<string>('JWT_ACCESS_TTL')
    });
    const refreshToken = await this.jwt.signAsync(payload, {
      secret: this.config.getOrThrow<string>('JWT_REFRESH_SECRET'),
      expiresIn: this.config.getOrThrow<string>('JWT_REFRESH_TTL')
    });

    const refreshTokenHash = await argon2.hash(refreshToken);
    const existing = await this.prisma.userSession.findUnique({ where: { id: sessionId } });
    if (existing) await this.authRepository.updateSessionRefreshHash(sessionId, refreshTokenHash);
    else await this.authRepository.createSession({ userId, refreshTokenHash });

    return { accessToken, refreshToken };
  }
}