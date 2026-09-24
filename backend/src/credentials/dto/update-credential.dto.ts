import { IsNotEmpty, IsOptional, IsString } from 'class-validator';

// Rotating a credential: only the fields being replaced need to be sent.
// The service merges these into the existing (decrypted) secret material —
// it already knows the credential's type, so that isn't repeated here.
export class UpdateCredentialDto {
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  label?: string;

  @IsOptional()
  @IsString()
  @IsNotEmpty()
  accessKeyId?: string;

  @IsOptional()
  @IsString()
  @IsNotEmpty()
  secretAccessKey?: string;

  @IsOptional()
  @IsString()
  @IsNotEmpty()
  username?: string;

  @IsOptional()
  @IsString()
  @IsNotEmpty()
  pat?: string;
}
