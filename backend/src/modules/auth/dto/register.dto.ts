import { IsAlphanumeric, IsOptional, IsString, Length, Matches, MinLength } from 'class-validator';

export class RegisterDto {
  @IsString()
  @MinLength(8)
  password!: string;

  @IsString()
  @Matches(/^@[a-zA-Z0-9_]{4,30}$/)
  nickname!: string;

  @IsString()
  @Length(6, 64)
  inviteCode!: string;

  @IsOptional()
  @IsString()
  @MinLength(1)
  displayName?: string;

  @IsString()
  @IsAlphanumeric()
  @Length(43, 43)
  identityPublicKey!: string;
}