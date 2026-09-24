const REQUIRED_KEYS = [
  'DATABASE_URL',
  'FRONTEND_URL',
  'GOOGLE_CLIENT_ID',
  'GOOGLE_CLIENT_SECRET',
  'GOOGLE_CALLBACK_URL',
  'JWT_ACCESS_SECRET',
  'JWT_REFRESH_SECRET',
  'CREDENTIALS_ENCRYPTION_KEY',
] as const;

// getOrThrow() only catches a MISSING key — an env var present but blank
// (e.g. `JWT_ACCESS_SECRET=`) sails through and fails later, mid-request,
// with a confusing error from whatever library first tries to use it.
// Checking non-emptiness once at boot turns that into a clear startup error.
export function validateEnv(
  config: Record<string, unknown>,
): Record<string, unknown> {
  const blank = REQUIRED_KEYS.filter((key) => {
    const value = config[key];
    return typeof value !== 'string' || value.trim() === '';
  });
  if (blank.length > 0) {
    throw new Error(
      `Missing or empty required env var(s): ${blank.join(', ')}`,
    );
  }
  return config;
}
