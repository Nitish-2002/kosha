import { IsOptional, IsString } from 'class-validator';

export class ReviewRequestDto {
  @IsOptional()
  @IsString()
  note?: string;
}
