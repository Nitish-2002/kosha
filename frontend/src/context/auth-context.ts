import { createContext } from 'react';

export type UserRole = 'admin' | 'member';

export interface AuthUser {
  id: string;
  email: string;
  role: UserRole;
}

export interface AuthContextValue {
  user: AuthUser | null;
  loading: boolean;
  logout: () => Promise<void>;
}

export const AuthContext = createContext<AuthContextValue>({
  user: null,
  loading: true,
  logout: () => Promise.resolve(),
});
