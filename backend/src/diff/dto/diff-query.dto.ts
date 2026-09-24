import { IsUUID } from 'class-validator';

export class DiffQueryDto {
  @IsUUID()
  fromConfigId!: string;

  @IsUUID()
  toConfigId!: string;
}
