import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ScheduleModule } from '@nestjs/schedule';
import { ThrottlerModule } from '@nestjs/throttler';

import { PrismaService } from '@/common/prisma.service';
import { RedisService } from '@/common/redis/redis.service';
import { validateEnv } from '@/config/env.validation';
import { AuthModule } from '@/modules/auth/auth.module';
import { ChatsModule } from '@/modules/chats/chats.module';
import { GroupsModule } from '@/modules/groups/groups.module';
import { InvitesModule } from '@/modules/invites/invites.module';
import { MediaModule } from '@/modules/media/media.module';
import { MessagesModule } from '@/modules/messages/messages.module';
import { NotificationsModule } from '@/modules/notifications/notifications.module';
import { SessionsModule } from '@/modules/sessions/sessions.module';
import { UsersModule } from '@/modules/users/users.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, validate: validateEnv }),
    ScheduleModule.forRoot(),
    ThrottlerModule.forRoot([{ ttl: 60_000, limit: 120 }]),
    AuthModule,
    InvitesModule,
    UsersModule,
    ChatsModule,
    GroupsModule,
    MessagesModule,
    MediaModule,
    NotificationsModule,
    SessionsModule
  ],
  providers: [PrismaService, RedisService]
})
export class AppModule {}