import { Controller, Get, Query, Req, UseGuards } from '@nestjs/common';

import { JwtPayload } from '@fpchat/shared';
import { JwtAuthGuard } from '@/modules/auth/guards/jwt-auth.guard';
import { UsersService } from '../services/users.service';

@Controller('users')
@UseGuards(JwtAuthGuard)
export class UsersController {
  constructor(private readonly usersService: UsersService) {}

  @Get('me')
  me(@Req() req: { user: JwtPayload }) {
    return this.usersService.me(req.user.sub);
  }

  @Get('search')
  search(@Query('nickname') nickname: string) {
    return this.usersService.searchByNickname(nickname);
  }
}