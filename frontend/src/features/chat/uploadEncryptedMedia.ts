import { api } from '@/shared/api/client';
import { encryptMedia } from '@/shared/crypto/e2ee';

export async function uploadEncryptedMedia(params: {
  token: string;
  messageId: string;
  file: File;
  mediaKey: CryptoKey;
  category: 'image' | 'video' | 'file' | 'audio';
}): Promise<void> {
  const bytes = await params.file.arrayBuffer();
  const { encrypted } = await encryptMedia(bytes, params.mediaKey);

  const formData = new FormData();
  formData.append('file', new Blob([encrypted]), `${params.file.name}.enc`);
  formData.append('messageId', params.messageId);
  formData.append('encryptedFileName', `${params.file.name}.enc`);
  formData.append('mimeType', 'application/octet-stream');
  formData.append('category', params.category);
  formData.append('sizeBytes', String(encrypted.byteLength));

  await fetch((import.meta.env.VITE_API_URL ?? 'http://localhost:3000/api/v1') + '/media/upload', {
    method: 'POST',
    headers: { Authorization: `Bearer ${params.token}` },
    body: formData
  });
}