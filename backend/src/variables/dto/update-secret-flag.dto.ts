import { IsBoolean } from 'class-validator';

export class UpdateSecretFlagDto {
  @IsBoolean()
  isSecret!: boolean;
}
