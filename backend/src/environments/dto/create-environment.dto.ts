import { IsNotEmpty, IsString } from 'class-validator';

export class CreateEnvironmentDto {
  @IsString()
  @IsNotEmpty()
  name!: string;
}
