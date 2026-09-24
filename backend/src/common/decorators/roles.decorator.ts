import { SetMetadata } from '@nestjs/common';
import { UserRole } from '../../users/user.entity';

export const ROLES_KEY = 'roles';

// Applied per-controller/handler on top of the global JwtAuthGuard — that
// guard only proves *who* the caller is, this narrows *what role* they must
// have. Requires RolesGuard on the same controller to actually enforce it.
export const Roles = (...roles: UserRole[]) => SetMetadata(ROLES_KEY, roles);
