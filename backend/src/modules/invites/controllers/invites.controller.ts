import { Body, Controller, Post } from '@nestjs/common';

import { CreateInviteDto } from '../dto/create-invite.dto';
import { InvitesService } from '../services/invites.service';

@Controller('invites')
export class InvitesController {
  constructor(private readonly invitesService: InvitesService) {}

  @Post()
  create(@Body() dto: CreateInviteDto) {
    return this.invitesService.createInvite(dto);
  }
}