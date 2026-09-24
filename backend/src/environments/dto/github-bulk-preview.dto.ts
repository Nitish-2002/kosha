import { IsNotEmpty, IsString, IsUUID, Matches } from 'class-validator';

// One repo/branch/credential for every component of an environment; the
// manifest path is a template with "{component}" swapped for each
// component's name (ConfigMap and Secret live in the same file).
export class GithubBulkPreviewDto {
  @IsString()
  @IsNotEmpty()
  githubRepo!: string;

  @IsString()
  @IsNotEmpty()
  githubBranch!: string;

  @IsUUID()
  githubCredentialId!: string;

  @IsString()
  @Matches(/\{component\}/, {
    message: 'pathTemplate must contain {component}.',
  })
  pathTemplate!: string;
}
