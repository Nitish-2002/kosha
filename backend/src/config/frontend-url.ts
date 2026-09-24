import { ConfigService } from '@nestjs/config';

// FRONTEND_URL is comma-separated: dev needs more than one origin at once
// (Vite falls back to 5174/5175 when 5173 is taken), and prod may too
// (www and non-www). The first entry is canonical, for the one-URL-only
// cases (OAuth redirect, notification links) — main.ts uses the full,
// unsplit list directly for CORS since that's the only place needing all of it.
export function primaryFrontendUrl(config: ConfigService): string {
  return config.getOrThrow<string>('FRONTEND_URL').split(',')[0];
}
