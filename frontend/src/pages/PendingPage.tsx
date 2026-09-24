import { googleSignInUrl } from '../api/client';
import './LoginPage.scss';

export function PendingPage() {
  return (
    <div className="login-page">
      <div className="login-glow login-glow--one" aria-hidden="true" />
      <div className="login-glow login-glow--two" aria-hidden="true" />

      <div className="login-card">
        <div className="login-icon login-icon--status" aria-hidden="true">
          <ClockIcon />
        </div>
        <h1 className="login-title">
          Access <span>pending</span>
        </h1>
        <p className="login-subtitle">
          Your Google account isn't on the Kosha whitelist yet. An Admin has been notified — you'll
          get access once your request is approved.
        </p>
        {/* There's no session for a not-yet-approved user, so there's
            nothing to poll — this re-runs the same whitelist check
            (AuthService.handleGoogleLogin) the original sign-in did.
            Clicking it while still pending correctly lands right back on
            this same page; worded as a check, not a claim about the user's
            status. */}
        <a className="login-button" href={googleSignInUrl()}>
          Check again
        </a>
      </div>
    </div>
  );
}

function ClockIcon() {
  return (
    <svg width="48" height="48" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <circle cx="12" cy="12" r="9" stroke="var(--color-red)" strokeWidth="1.6" />
      <path
        d="M12 7.5v5l3.2 2.1"
        stroke="var(--color-red)"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
