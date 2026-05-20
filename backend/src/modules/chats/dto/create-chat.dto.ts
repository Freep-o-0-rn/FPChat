import { IsArray, IsUUID, Length } from 'class-validator';

export class CreateChatDto {
  @IsArray()
  @IsUUID('4', { each: true })
  participantIds!: string[];

  @Length(43, 43)
  senderIdentityPublicKey!: string;

  @Length(43, 43)
  recipientIdentityPublicKey!: string;
}