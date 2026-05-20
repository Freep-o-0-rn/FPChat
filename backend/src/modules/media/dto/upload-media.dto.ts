import { IsEnum, IsNumber, IsString, IsUUID, Max, Min } from 'class-validator';

export class UploadMediaDto {
  @IsUUID('4')
  messageId!: string;

  @IsString()
  encryptedFileName!: string;

  @IsString()
  mimeType!: string;

  @IsEnum(['image', 'video', 'file', 'audio'])
  category!: 'image' | 'video' | 'file' | 'audio';

  @IsNumber()
  @Min(1)
  @Max(100 * 1024 * 1024)
  sizeBytes!: number;
}