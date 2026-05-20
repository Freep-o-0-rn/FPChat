import { IsArray, IsOptional, IsString, IsUUID, MaxLength } from 'class-validator';

export class CreateGroupDto {
  @IsString()
  @MaxLength(120)
  title!: string;

  @IsOptional()
  @IsString()
  avatarUrl?: string;

  @IsArray()
  @IsUUID('4', { each: true })
  memberIds!: string[];
}