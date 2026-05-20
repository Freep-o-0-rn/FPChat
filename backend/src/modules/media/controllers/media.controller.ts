import { Body, Controller, Post, UploadedFile, UseGuards, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';

import { JwtAuthGuard } from '@/modules/auth/guards/jwt-auth.guard';
import { UploadMediaDto } from '../dto/upload-media.dto';
import { MediaService } from '../services/media.service';

@Controller('media')
@UseGuards(JwtAuthGuard)
export class MediaController {
  constructor(private readonly mediaService: MediaService) {}

  @Post('upload')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: 100 * 1024 * 1024 } }))
  upload(@Body() dto: UploadMediaDto, @UploadedFile() file: any) {
    return this.mediaService.upload(dto, file.buffer as Buffer);
  }
}