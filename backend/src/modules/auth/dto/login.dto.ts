import { IsString, Matches, MinLength } from 'class-validator';

export class LoginDto {
  @IsString()
  @Matches(/^@[a-zA-Z0-9_]{4,30}$/)
  nickname!: string;

  @IsString()
  @MinLength(8)
  password!: string;
}