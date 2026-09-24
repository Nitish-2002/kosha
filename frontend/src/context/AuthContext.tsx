import { useEffect, useState, type ReactNode } from 'react';
import { apiGet, apiPost, ApiError } from '../api/client';
import { AuthContext, type AuthUser } from './auth-context';

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    apiGet<AuthUser>('/auth/me')
      .then(setUser)
      .catch((error: unknown) => {
        if (!(error instanceof ApiError) || error.status !== 401) {
          console.error('Failed to load current user', error);
        }
        setUser(null);
      })
      .finally(() => setLoading(false));
  }, []);

  async function logout(): Promise<void> {
    try {
      await apiPost('/auth/logout');
    } finally {
      // Clear client-side state even if the request fails, so a user is
      // never stuck "logged in" locally when the server already cleared it.
      setUser(null);
    }
  }

  return <AuthContext.Provider value={{ user, loading, logout }}>{children}</AuthContext.Provider>;
}
