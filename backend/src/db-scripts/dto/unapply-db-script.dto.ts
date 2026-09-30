import { IsOptional, IsString, MaxLength } from 'class-validator';

export class UnapplyDbScriptDto {
  // Required for a Member (their undo request needs it); ignored for an
  // Admin, who undoes directly. Checked in DbScriptsService.
  @IsOptional()
  @IsString()
  @MaxLength(500)
  reason?: string;
}
