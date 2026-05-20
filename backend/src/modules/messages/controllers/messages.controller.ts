import { Body, Controller, Get, Post, Query, Req, UseGuards } from '@nestjs/common';

import { JwtPayload } from '@fpchat/shared';
import { JwtAuthGuard } from '@/modules/auth/guards/jwt-auth.guard';
import { SendMessageDto } from '../dto/send-message.dto';
import { MessagesService } from '../services/messages.service';

@Controller('messages')
@UseGuards(JwtAuthGuard)
export class MessagesController {
  constructor(private readonly messagesService: MessagesService) {}

  @Post()
  send(@Req() req: { user: JwtPayload }, @Body() dto: SendMessageDto) {
    return this.messagesService.send(req.user.sub, dto);
  }

  @Get()
  history(@Query('chatId') chatId: string, @Query('cursor') cursor?: string) {
    return this.messagesService.history(chatId, cursor);
  }
}