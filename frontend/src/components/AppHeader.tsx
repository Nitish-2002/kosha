import { useState } from 'react';
import { Link, NavLink, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/useAuth';
import { NotificationBell } from './NotificationBell';
import './AppHeader.scss';

export function AppHeader() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const [menuOpen, setMenuOpen] = useState(false);

  async function handleLogout(): Promise<void> {
    await logout();
    navigate('/login', { replace: true });
  }

  const initial = user?.email?.[0]?.toUpperCase() ?? '?';
  const navClass = ({ isActive }: { isActive: boolean }) => (isActive ? 'app-header-nav-active' : undefined);

  return (
    <header className="app-header">
      <div className="app-header-row">
        <Link to="/" className="app-header-logo" onClick={() => setMenuOpen(false)}>
          <img src="/logo.png" alt="Kosha" />
        </Link>

        {user && (
          <nav className={menuOpen ? 'app-header-nav app-header-nav--open' : 'app-header-nav'}>
            {user.role === 'admin' && (
              <>
                {/* A Member's own project list is already the home page (the
                    logo link) — everything this adds beyond that (search,
                    sort, create/archive/delete) is Admin-only anyway, so the
                    tab is Admin-only too instead of duplicating Home for a
                    Member with nothing extra to offer them. */}
                <NavLink to="/projects" className={navClass} onClick={() => setMenuOpen(false)}>
                  Projects
                </NavLink>
                <NavLink to="/credentials" className={navClass} onClick={() => setMenuOpen(false)}>
                  Credentials
                </NavLink>
                <NavLink to="/members" className={navClass} onClick={() => setMenuOpen(false)}>
                  Members
                </NavLink>
                <NavLink to="/audit-log" className={navClass} onClick={() => setMenuOpen(false)}>
                  Audit log
                </NavLink>
                <NavLink to="/requests" className={navClass} onClick={() => setMenuOpen(false)}>
                  Requests
                </NavLink>
              </>
            )}
          </nav>
        )}

        <div className="app-header-controls">
          {user && (
            <button
              className="app-header-menu-toggle"
              onClick={() => setMenuOpen((open) => !open)}
              aria-label="Menu"
              aria-expanded={menuOpen}
            >
              {menuOpen ? <CloseIcon /> : <MenuIcon />}
            </button>
          )}

          <NotificationBell />

          <div className="app-header-profile">
            <div className="app-header-avatar" aria-hidden="true">
              {initial}
            </div>
            <div className="app-header-profile-text">
              <span className={`app-header-role app-header-role--${user?.role ?? 'member'}`}>{user?.role}</span>
              <span className="app-header-email">{user?.email}</span>
            </div>
          </div>

          <button className="app-header-logout" onClick={() => void handleLogout()} aria-label="Log out">
            <LogoutIcon />
            <span>Log out</span>
          </button>
        </div>
      </div>
    </header>
  );
}

function MenuIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path d="M2 4h12M2 8h12M2 12h12" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
    </svg>
  );
}

function CloseIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path d="M3 3l10 10M13 3 3 13" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
    </svg>
  );
}

function LogoutIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 15 15" fill="none" aria-hidden="true">
      <path
        d="M6 1.5H2.75A1.25 1.25 0 0 0 1.5 2.75v9.5a1.25 1.25 0 0 0 1.25 1.25H6"
        stroke="currentColor"
        strokeWidth="1.3"
        strokeLinecap="round"
      />
      <path d="M10 4.5 13 7.5l-3 3M13 7.5H5.5" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
