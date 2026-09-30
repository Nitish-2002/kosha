import { IsDateString, IsUUID } from 'class-validator';

export class PreviewRefreshDto {
  // The environment the dump was taken from.
  @IsUUID()
  sourceEnvironmentId!: string;

  // The environment whose database was restored.
  @IsUUID()
  targetEnvironmentId!: string;
}

export class RecordRefreshDto extends PreviewRefreshDto {
  // 'YYYY-MM-DD'.
  @IsDateString({ strict: true })
  dumpTakenOn!: string;
}
