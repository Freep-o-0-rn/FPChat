import { IsArray, IsEnum, IsOptional, IsString, IsUUID, Length } from 'class-validator';

export class SendMessageDto {
  @IsUUID('4')
  chatId!: string;

  @IsEnum(['TEXT', 'MEDIA', 'SYSTEM'])
  type!: 'TEXT' | 'MEDIA' | 'SYSTEM';

  @IsString()
  ciphertext!: string;

  @Length(24, 24)
  nonce!: string;

  @IsOptional()
  @IsUUID('4')
  replyToId?: string;

  @IsArray()
  @IsUUID('4', { each: true })
  recipientIds!: string[];
}