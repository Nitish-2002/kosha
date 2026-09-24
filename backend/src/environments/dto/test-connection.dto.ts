import {
  IsIn,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  ValidateIf,
} from 'class-validator';
import type { ComponentConfigSourceType } from '../environment-component-config.entity';

// Same flat-DTO-with-ValidateIf shape as CreateComponentConfigDto — this is
// deliberately a subset of it (no projectComponentId): testing validates
// that the credential can reach the bucket/repo+branch, and — when a path is
// actually entered — that the S3 key or GitHub ConfigMap/Secret file exists
// at that exact path. The paths stay optional since one may not exist yet
// for a brand-new wiring; skip the check rather than force a value here.
export class TestConnectionDto {
  @IsIn(['s3', 'github'])
  sourceType!: ComponentConfigSourceType;

  @ValidateIf((dto: TestConnectionDto) => dto.sourceType === 's3')
  @IsString()
  @IsNotEmpty()
  s3Bucket?: string;

  @ValidateIf((dto: TestConnectionDto) => dto.sourceType === 's3')
  @IsString()
  @IsNotEmpty()
  s3Region?: string;

  @ValidateIf((dto: TestConnectionDto) => dto.sourceType === 's3')
  @IsUUID()
  s3CredentialId?: string;

  @IsOptional()
  @IsString()
  s3KeyOverride?: string;

  @ValidateIf((dto: TestConnectionDto) => dto.sourceType === 'github')
  @IsString()
  @IsNotEmpty()
  githubRepo?: string;

  @ValidateIf((dto: TestConnectionDto) => dto.sourceType === 'github')
  @IsString()
  @IsNotEmpty()
  githubBranch?: string;

  @ValidateIf((dto: TestConnectionDto) => dto.sourceType === 'github')
  @IsUUID()
  githubCredentialId?: string;

  @IsOptional()
  @IsString()
  githubConfigmapPath?: string;

  @IsOptional()
  @IsString()
  githubSecretPath?: string;
}
