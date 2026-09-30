import { ArrayNotEmpty, IsArray, IsUUID } from 'class-validator';

export class ReorderEnvironmentsDto {
  // Lowest first (e.g. dev, qa, preprod, prod).
  @IsArray()
  @ArrayNotEmpty()
  @IsUUID('all', { each: true })
  environmentIds!: string[];
}
