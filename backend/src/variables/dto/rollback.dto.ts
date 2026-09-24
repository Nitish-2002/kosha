import { IsNotEmpty, IsOptional, IsString } from 'class-validator';

// Omitted key = whole-file rollback (LLD — Variables).
export class RollbackDto {
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  key?: string;

  @IsString()
  @IsNotEmpty()
  targetVersionId!: string;
}
