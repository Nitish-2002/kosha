import { IsIn } from 'class-validator';
import type { UserRole } from '../../users/user.entity';

export class ApproveAccessRequestDto {
  @IsIn(['admin', 'member'])
  role!: UserRole;
}
