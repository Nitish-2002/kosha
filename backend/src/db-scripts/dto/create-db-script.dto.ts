import {
  IsArray,
  IsBoolean,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
} from 'class-validator';

// Matches the 2 MB JSON body limit in main.ts, with room for the other fields.
export const MAX_SQL_LENGTH = 1_000_000;

export class CreateDbScriptDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  name!: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(MAX_SQL_LENGTH)
  sql!: string;

  @IsOptional()
  @IsBoolean()
  rerunAfterRestore?: boolean;

  // Environments the author unticked in "Applies to". Every other
  // environment of the project starts pending.
  @IsOptional()
  @IsArray()
  @IsUUID('all', { each: true })
  notApplicableEnvironmentIds?: string[];
}
