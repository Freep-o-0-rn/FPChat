import { Body, Controller, Post, Req, UseGuards } from '@nestjs/common';

import { JwtPayload } from '@fpchat/shared';
import { JwtAuthGuard } from '@/modules/auth/guards/jwt-auth.guard';
import { CreateGroupDto } from '../dto/create-group.dto';
import { GroupsService } from '../services/groups.service';

@Controller('groups')
@UseGuards(JwtAuthGuard)
export class GroupsController {
  constructor(private readonly groupsService: GroupsService) {}

  @Post()
  create(@Req() req: { user: JwtPayload }, @Body() dto: CreateGroupDto) {
    return this.groupsService.create(req.user.sub, dto);
  }
}