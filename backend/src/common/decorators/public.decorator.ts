import { SetMetadata } from '@nestjs/common';

export const IS_PUBLIC_KEY = 'isPublic';

// Marks a route as reachable without a valid access token. Every other route
// is private by default via the global JwtAuthGuard — see CLAUDE.md #11.
export const Public = () => SetMetadata(IS_PUBLIC_KEY, true);
