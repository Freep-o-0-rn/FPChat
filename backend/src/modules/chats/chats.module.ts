import { Module } from '@nestjs/common';

import { ChatGateway } from './gateways/chat.gateway';
import { ChatsController } from './controllers/chats.controller';
import { ChatsService } from './services/chats.service';

@Module({ controllers: [ChatsController], providers: [ChatsService, ChatGateway], exports: [ChatsService] })
export class ChatsModule {}