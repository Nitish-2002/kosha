import { IsOptional, IsNotEmpty, IsString, IsUUID } from 'class-validator';

// sourceType and projectComponentId aren't editable here — a config that
// needs to change source or target component is different config; delete
// and recreate rather than mutating a connection's identity in place.
export class UpdateComponentConfigDto {
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  s3Bucket?: string;

  @IsOptional()
  @IsString()
  @IsNotEmpty()
  s3Region?: string;

  @IsOptional()
  @IsUUID()
  s3CredentialId?: string;

  @IsOptional()
  @IsString()
  @IsNotEmpty()
  s3KeyOverride?: string;

  @IsOptional()
  @IsString()
  @IsNotEmpty()
  githubRepo?: string;

  @IsOptional()
  @IsString()
  @IsNotEmpty()
  githubBranch?: string;

  @IsOptional()
  @IsUUID()
  githubCredentialId?: string;

  @IsOptional()
  @IsString()
  @IsNotEmpty()
  githubConfigmapPath?: string;

  @IsOptional()
  @IsString()
  @IsNotEmpty()
  githubSecretPath?: string;
}
