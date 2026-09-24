import { useEffect, useMemo, useRef, useState } from 'react';
import { FLOATING_PANEL_VIEWPORT_MARGIN } from '../constants';
import './Select.scss';

export interface SelectOption {
  value: string;
  label: string;
}

interface SelectProps {
  value: string;
  options: SelectOption[];
  onChange: (value: string) => void;
  placeholder?: string;
  // Adds a filter box at the top of the dropdown — for a picker whose option
  // count grows with real data (projects, users) rather than a fixed small
  // set, where scrolling to find one entry gets impractical.
  searchable?: boolean;
}

// Native <select> can't be restyled cross-browser once the options popup is
// open (it renders with the OS's own list, not the page's CSS) — this is a
// small custom listbox instead, so it actually matches the rest of the UI.
export function Select({ value, options, onChange, placeholder = 'Select…', searchable = false }: SelectProps) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [panelPosition, setPanelPosition] = useState({ top: 0, left: 0, width: 0 });
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const current = options.find((option) => option.value === value);

  useEffect(() => {
    function handleClickOutside(event: MouseEvent): void {
      if (rootRef.current && !rootRef.current.contains(event.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  useEffect(() => {
    if (open && searchable) {
      // Autofocus so typing works immediately — this is the whole point of
      // making it searchable, an extra click to reach the box defeats it.
      searchInputRef.current?.focus();
    }
  }, [open, searchable]);

  function toggleOpen(): void {
    const next = !open;
    if (next && triggerRef.current) {
      // position: fixed, measured from the real trigger — a plain
      // position:absolute dropdown gets clipped by any ancestor with
      // overflow set (e.g. the table wrapper's horizontal-scroll
      // container), which is exactly what was cutting this off before.
      const rect = triggerRef.current.getBoundingClientRect();
      const maxLeft = window.innerWidth - rect.width - FLOATING_PANEL_VIEWPORT_MARGIN;
      const left = Math.min(
        Math.max(rect.left, FLOATING_PANEL_VIEWPORT_MARGIN),
        Math.max(FLOATING_PANEL_VIEWPORT_MARGIN, maxLeft),
      );
      setPanelPosition({ top: rect.bottom + 4, left, width: rect.width });
    } else {
      setQuery('');
    }
    setOpen(next);
  }

  const visibleOptions = useMemo(() => {
    if (!searchable || !query.trim()) return options;
    const q = query.trim().toLowerCase();
    return options.filter((option) => option.label.toLowerCase().includes(q));
  }, [options, query, searchable]);

  return (
    <div className="select" ref={rootRef}>
      <button ref={triggerRef} type="button" className="select-trigger" onClick={toggleOpen} aria-expanded={open}>
        <span className="select-trigger-label">{current?.label ?? placeholder}</span>
        <ChevronIcon open={open} />
      </button>
      {open && (
        <div
          className="select-options"
          style={{ top: panelPosition.top, left: panelPosition.left, width: panelPosition.width }}
        >
          {searchable && (
            <input
              ref={searchInputRef}
              className="select-search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search…"
              onClick={(e) => e.stopPropagation()}
            />
          )}
          <ul className="select-options-list" role="listbox">
            {visibleOptions.length === 0 ? (
              <li className="select-options-empty">No matches</li>
            ) : (
              visibleOptions.map((option) => (
                <li key={option.value}>
                  <button
                    type="button"
                    className={option.value === value ? 'select-option select-option--active' : 'select-option'}
                    onClick={() => {
                      onChange(option.value);
                      setQuery('');
                      setOpen(false);
                    }}
                  >
                    {option.label}
                  </button>
                </li>
              ))
            )}
          </ul>
        </div>
      )}
    </div>
  );
}

function ChevronIcon({ open }: { open: boolean }) {
  return (
    <svg
      width="12"
      height="12"
      viewBox="0 0 12 12"
      fill="none"
      style={{ transform: open ? 'rotate(180deg)' : undefined, transition: 'transform 0.15s ease' }}
      aria-hidden="true"
    >
      <path d="m2.5 4.5 3.5 3 3.5-3" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
