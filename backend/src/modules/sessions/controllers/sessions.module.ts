import { Module } from '@nestjs/common';

import { SessionsController } from './controllers/sessions.controller';
import { SessionsService } from './services/sessions.service';

@Module({ controllers: [SessionsController], providers: [SessionsService], exports: [SessionsService] })
export class SessionsModule {}