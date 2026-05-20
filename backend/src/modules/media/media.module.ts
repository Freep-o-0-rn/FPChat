import { Module } from '@nestjs/common';

import { StorageService } from '@/common/storage/storage.service';
import { MediaController } from './controllers/media.controller';
import { MediaService } from './services/media.service';

@Module({ controllers: [MediaController], providers: [MediaService, StorageService], exports: [MediaService] })
export class MediaModule {}