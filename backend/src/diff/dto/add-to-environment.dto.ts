import { IsNotEmpty, IsString, IsUUID } from 'class-validator';

export class AddToEnvironmentDto {
  @IsUUID()
  fromConfigId!: string;

  @IsUUID()
  toConfigId!: string;

  @IsString()
  @IsNotEmpty()
  key!: string;
}
