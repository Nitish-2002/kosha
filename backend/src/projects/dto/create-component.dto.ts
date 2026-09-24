import { IsNotEmpty, IsString } from 'class-validator';

export class CreateComponentDto {
  @IsString()
  @IsNotEmpty()
  name!: string;
}
