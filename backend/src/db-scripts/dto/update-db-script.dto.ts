import {
  IsArray,
  IsBoolean,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
} from 'class-validator';
import { MAX_SQL_LENGTH } from './create-db-script.dto';

// Same fields as CreateDbScriptDto, all optional. Once the script has been
// applied anywhere, name and SQL can't change (DbScriptsService.update).
export class UpdateDbScriptDto {
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  name?: string;

  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(MAX_SQL_LENGTH)
  sql?: string;

  @IsOptional()
  @IsBoolean()
  rerunAfterRestore?: boolean;

  @IsOptional()
  @IsArray()
  @IsUUID('all', { each: true })
  notApplicableEnvironmentIds?: string[];
}
