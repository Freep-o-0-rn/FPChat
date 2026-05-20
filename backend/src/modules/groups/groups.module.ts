import { Module } from '@nestjs/common';

import { GroupsController } from './controllers/groups.controller';
import { GroupsService } from './services/groups.service';

@Module({ controllers: [GroupsController], providers: [GroupsService], exports: [GroupsService] })
export class GroupsModule {}