import { UserRole } from '../users/user.entity';

// Access token payload.
export interface AccessTokenPayload {
  sub: string; // user id
  email: string;
  role: UserRole;
}

// Refresh token payload. `sid` is checked against User.currentRefreshTokenId
// to enforce single-session-per-user (CLAUDE.md #9).
export interface RefreshTokenPayload {
  sub: string;
  sid: string;
}

export interface RequestUser {
  id: string;
  email: string;
  role: UserRole;
}
