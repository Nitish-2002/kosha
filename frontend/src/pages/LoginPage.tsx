import { useSearchParams } from 'react-router-dom';
import { googleSignInUrl } from '../api/client';
import { LOGIN_FEATURES } from '../constants';
import './LoginPage.scss';

export function LoginPage() {
  const [searchParams] = useSearchParams();
  const error = searchParams.get('error');

  return (
    <div className="login-page">
      <div className="login-glow login-glow--one" aria-hidden="true" />
      <div className="login-glow login-glow--two" aria-hidden="true" />

      <div className="login-card">
        <div className="login-icon">
          <img src="/favicon.png" alt="Kosha" />
        </div>
        <h1 className="login-title">
          <span>Kosha</span>
        </h1>
        <p className="login-subtitle">Environment variables, centralized and audited.</p>
        <a className="login-button" href={googleSignInUrl()}>
          <GoogleIcon />
          Sign in with Google
        </a>
        {error && <p className="login-error">Sign-in failed. Please try again.</p>}

        <ul className="login-features">
          {LOGIN_FEATURES.map((feature) => (
            <li className="login-feature" key={feature}>
              <CheckIcon />
              {feature}
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

function CheckIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <circle cx="8" cy="8" r="7" stroke="currentColor" strokeWidth="1.3" />
      <path d="M5 8.2 7 10l4-4.5" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function GoogleIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 18 18" aria-hidden="true">
      <path
        fill="#fff"
        d="M17.64 9.2c0-.64-.06-1.25-.16-1.84H9v3.48h4.84a4.14 4.14 0 0 1-1.8 2.72v2.26h2.9c1.7-1.57 2.7-3.88 2.7-6.62z"
      />
      <path
        fill="#fff"
        d="M9 18c2.43 0 4.47-.8 5.96-2.18l-2.9-2.26c-.8.54-1.84.86-3.06.86-2.35 0-4.34-1.59-5.05-3.72H.9v2.33A9 9 0 0 0 9 18z"
      />
      <path
        fill="#fff"
        d="M3.95 10.7A5.4 5.4 0 0 1 3.67 9c0-.59.1-1.17.28-1.7V4.97H.9A9 9 0 0 0 0 9c0 1.45.35 2.83.9 4.03l3.05-2.33z"
      />
      <path
        fill="#fff"
        d="M9 3.58c1.32 0 2.51.46 3.44 1.35l2.58-2.58C13.46.89 11.43 0 9 0A9 9 0 0 0 .9 4.97L3.95 7.3C4.66 5.17 6.65 3.58 9 3.58z"
      />
    </svg>
  );
}
