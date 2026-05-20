import { Body, Controller, Get, Post, Req, UseGuards } from '@nestjs/common';

import { JwtPayload } from '@fpchat/shared';
import { JwtAuthGuard } from '@/modules/auth/guards/jwt-auth.guard';
import { CreateChatDto } from '../dto/create-chat.dto';
import { ChatsService } from '../services/chats.service';

@Controller('chats')
@UseGuards(JwtAuthGuard)
export class ChatsController {
  constructor(private readonly chatsService: ChatsService) {}

  @Get()
  list(@Req() req: { user: JwtPayload }) {
    return this.chatsService.listChats(req.user.sub);
  }

  @Post('direct')
  createDirect(@Req() req: { user: JwtPayload }, @Body() dto: CreateChatDto) {
    return this.chatsService.createPrivateChat(req.user.sub, dto);
  }
}