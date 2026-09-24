import { IsString } from 'class-validator';

// Same body shape for both preview and commit — commit re-parses and
// re-validates from scratch rather than trusting the preview response
// (LLD — Variables: "never trusts the preview response").
export class ImportEnvDto {
  @IsString()
  envText!: string;
}
