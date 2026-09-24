import {
  IsIn,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  ValidateIf,
} from 'class-validator';
import type { ComponentConfigSourceType } from '../environment-component-config.entity';

// Same flat-DTO-with-ValidateIf shape as CreateCredentialDto — one row, two
// mutually exclusive field groups, picked by sourceType.
export class CreateComponentConfigDto {
  @IsUUID()
  projectComponentId!: string;

  @IsIn(['s3', 'github'])
  sourceType!: ComponentConfigSourceType;

  @ValidateIf((dto: CreateComponentConfigDto) => dto.sourceType === 's3')
  @IsString()
  @IsNotEmpty()
  s3Bucket?: string;

  @ValidateIf((dto: CreateComponentConfigDto) => dto.sourceType === 's3')
  @IsString()
  @IsNotEmpty()
  s3Region?: string;

  @ValidateIf((dto: CreateComponentConfigDto) => dto.sourceType === 's3')
  @IsUUID()
  s3CredentialId?: string;

  @ValidateIf(
    (dto: CreateComponentConfigDto) =>
      dto.sourceType === 's3' && dto.s3KeyOverride !== undefined,
  )
  @IsString()
  @IsNotEmpty()
  s3KeyOverride?: string;

  @ValidateIf((dto: CreateComponentConfigDto) => dto.sourceType === 'github')
  @IsString()
  @IsNotEmpty()
  githubRepo?: string;

  @ValidateIf((dto: CreateComponentConfigDto) => dto.sourceType === 'github')
  @IsString()
  @IsNotEmpty()
  githubBranch?: string;

  @ValidateIf((dto: CreateComponentConfigDto) => dto.sourceType === 'github')
  @IsUUID()
  githubCredentialId?: string;

  @IsOptional()
  @ValidateIf((dto: CreateComponentConfigDto) => dto.sourceType === 'github')
  @IsString()
  @IsNotEmpty()
  githubConfigmapPath?: string;

  @IsOptional()
  @ValidateIf((dto: CreateComponentConfigDto) => dto.sourceType === 'github')
  @IsString()
  @IsNotEmpty()
  githubSecretPath?: string;
}
