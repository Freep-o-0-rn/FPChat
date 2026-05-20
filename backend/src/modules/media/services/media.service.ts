import { BadRequestException, Injectable } from '@nestjs/common';

import { PrismaService } from '@/common/prisma.service';
import { StorageService } from '@/common/storage/storage.service';
import { UploadMediaDto } from '../dto/upload-media.dto';

@Injectable()
export class MediaService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService
  ) {}

  async upload(dto: UploadMediaDto, encryptedBytes: Buffer) {
    if (encryptedBytes.byteLength !== dto.sizeBytes) {
      throw new BadRequestException('Encrypted size mismatch');
    }

    const { path, sha256 } = await this.storage.saveEncryptedObject(encryptedBytes, dto.encryptedFileName);

    return this.prisma.attachment.create({
      data: {
        messageId: dto.messageId,
        encryptedObjectPath: path,
        encryptedObjectHash: sha256,
        encryptedFileName: dto.encryptedFileName,
        mimeType: dto.mimeType,
        sizeBytes: dto.sizeBytes,
        category: dto.category
      }
    });
  }
}