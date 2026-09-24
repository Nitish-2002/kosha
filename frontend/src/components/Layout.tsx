import type { ReactNode } from 'react';
import { AppHeader } from './AppHeader';

export function Layout({ children }: { children: ReactNode }) {
  return (
    <div className="app-layout">
      <AppHeader />
      {children}
    </div>
  );
}
