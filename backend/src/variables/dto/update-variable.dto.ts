import { IsString } from 'class-validator';

export class UpdateVariableDto {
  @IsString()
  value!: string;
}
