import { Module } from '@nestjs/common';

import { MessagesController } from './controllers/messages.controller';
import { MessagesService } from './services/messages.service';

@Module({ controllers: [MessagesController], providers: [MessagesService], exports: [MessagesService] })
export class MessagesModule {}