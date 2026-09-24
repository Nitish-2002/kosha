import { IsOptional, IsUUID } from 'class-validator';

export class CreateAssignmentDto {
  @IsUUID()
  projectId!: string;

  @IsUUID()
  environmentId!: string;

  // Omitted/null = every component in this environment.
  @IsOptional()
  @IsUUID()
  projectComponentId?: string;
}
