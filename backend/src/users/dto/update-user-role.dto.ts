import { IsIn } from 'class-validator';
import type { UserRole } from '../user.entity';

export class UpdateUserRoleDto {
  @IsIn(['admin', 'member'])
  role!: UserRole;
}
