import { IsBoolean, IsOptional, IsString, Matches } from 'class-validator';

export class CreateVariableDto {
  @IsString()
  @Matches(/^[A-Za-z_][A-Za-z0-9_]*$/, {
    message:
      'key must look like an env var name (letters, digits, underscore; not starting with a digit).',
  })
  key!: string;

  @IsString()
  value!: string;

  // Only ever honored when the caller is an Admin (CLAUDE.md #8) — the
  // service forces this to false for anyone else, regardless of what's
  // sent. A Member creating a variable still always starts non-Secret.
  @IsOptional()
  @IsBoolean()
  isSecret?: boolean;
}
