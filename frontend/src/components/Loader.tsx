import './Loader.scss';

interface LoaderProps {
  label?: string;
}

export function Loader({ label = 'Loading…' }: LoaderProps) {
  return (
    <div className="loader" role="status" aria-live="polite">
      <span className="loader-spinner" aria-hidden="true" />
      <span className="loader-label">{label}</span>
    </div>
  );
}
