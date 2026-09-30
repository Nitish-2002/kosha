import {
  ArrayNotEmpty,
  IsArray,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
} from 'class-validator';

// Change repo / branch / credential on several GitHub-sourced component
// connections of one environment at once. Only the fields given change;
// each connection keeps its own manifest paths.
export class GithubBulkEditDto {
  @IsArray()
  @ArrayNotEmpty()
  @IsUUID('all', { each: true })
  configIds!: string[];

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
}
