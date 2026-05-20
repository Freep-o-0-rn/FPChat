import { Module } from '@nestjs/common';

import { InvitesController } from './controllers/invites.controller';
import { InvitesService } from './services/invites.service';

@Module({
  controllers: [InvitesController],
  providers: [InvitesService],
  exports: [InvitesService]
})
export class InvitesModule {}