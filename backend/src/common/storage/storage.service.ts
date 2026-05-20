import { Injectable } from '@nestjs/common';
import { createHash } from 'crypto';
import { mkdir, writeFile } from 'fs/promises';
import { join } from 'path';

@Injectable()
export class StorageService {
  private readonly mediaDir = process.env.MEDIA_DIR ?? '/tmp/fpchat-media';

  async saveEncryptedObject(buffer: Buffer, originalName: string): Promise<{ path: string; sha256: string }> {
    await mkdir(this.mediaDir, { recursive: true });
    const safeName = createHash('sha256').update(originalName + Date.now().toString()).digest('hex');
    const fullPath = join(this.mediaDir, safeName);
    await writeFile(fullPath, buffer);
    const sha256 = createHash('sha256').update(buffer).digest('hex');
    return { path: fullPath, sha256 };
  }
}