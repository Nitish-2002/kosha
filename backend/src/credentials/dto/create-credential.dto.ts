import { IsIn, IsNotEmpty, IsString, ValidateIf } from 'class-validator';
import type { CredentialType } from '../credential.entity';

export class CreateCredentialDto {
  @IsIn(['aws', 'github'])
  type!: CredentialType;

  @IsString()
  @IsNotEmpty()
  label!: string;

  @ValidateIf((dto: CreateCredentialDto) => dto.type === 'aws')
  @IsString()
  @IsNotEmpty()
  accessKeyId?: string;

  @ValidateIf((dto: CreateCredentialDto) => dto.type === 'aws')
  @IsString()
  @IsNotEmpty()
  secretAccessKey?: string;

  @ValidateIf((dto: CreateCredentialDto) => dto.type === 'github')
  @IsString()
  @IsNotEmpty()
  username?: string;

  @ValidateIf((dto: CreateCredentialDto) => dto.type === 'github')
  @IsString()
  @IsNotEmpty()
  pat?: string;
}
