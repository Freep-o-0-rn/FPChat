import { Controller, Delete, Get, Param, Req, UseGuards } from '@nestjs/common';

import { JwtPayload } from '@fpchat/shared';
import { JwtAuthGuard } from '@/modules/auth/guards/jwt-auth.guard';
import { SessionsService } from '../services/sessions.service';

@Controller('sessions')
@UseGuards(JwtAuthGuard)
export class SessionsController {
  constructor(private readonly sessionsService: SessionsService) {}

  @Get()
  list(@Req() req: { user: JwtPayload }) {
    return this.sessionsService.list(req.user.sub);
  }

  @Delete(':id')
  revoke(@Req() req: { user: JwtPayload }, @Param('id') id: string) {
    return this.sessionsService.revoke(req.user.sub, id);
  }
}