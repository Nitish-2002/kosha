import { useEffect, useRef, useState } from 'react';
import { FLOATING_PANEL_VIEWPORT_MARGIN, WEEKDAY_LABELS } from '../constants';
import './DatePicker.scss';

interface DatePickerProps {
  value: string; // ISO date, e.g. "2026-09-19", or '' for unset
  onChange: (value: string) => void;
  placeholder?: string;
  // Dates outside [minDate, maxDate] render disabled and can't be picked —
  // for a from/to pair, prevents an inverted range at the source instead of
  // letting one through and then flagging it as invalid after the fact.
  minDate?: string;
  maxDate?: string;
}

function parseIsoDate(iso: string): Date | null {
  if (!iso) return null;
  const [year, month, day] = iso.split('-').map(Number);
  return new Date(year, month - 1, day);
}

function toIsoDate(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function isSameDay(a: Date, b: Date): boolean {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}

// Native <input type="date"> can't have its calendar popup restyled cross-
// browser (same reason Select.tsx exists instead of a native <select>) — it
// renders with the OS/browser's own light-themed widget regardless of page
// CSS, which stands out against this app's dark red/black theme. This is a
// small custom calendar instead, day-granularity only (matches what the
// callers here actually need — a date-range filter, not a date+time picker).
export function DatePicker({ value, onChange, placeholder = 'Select date', minDate, maxDate }: DatePickerProps) {
  const selected = parseIsoDate(value);
  const min = minDate ? parseIsoDate(minDate) : null;
  const max = maxDate ? parseIsoDate(maxDate) : null;
  const [open, setOpen] = useState(false);
  const [viewMonth, setViewMonth] = useState(() => selected ?? new Date());
  const [panelPosition, setPanelPosition] = useState({ top: 0, left: 0 });
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    function handleClickOutside(event: MouseEvent): void {
      if (rootRef.current && !rootRef.current.contains(event.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  function toggleOpen(): void {
    const next = !open;
    if (next) {
      setViewMonth(selected ?? new Date());
      if (triggerRef.current) {
        const rect = triggerRef.current.getBoundingClientRect();
        const maxLeft = window.innerWidth - 260 - FLOATING_PANEL_VIEWPORT_MARGIN;
        const left = Math.min(
          Math.max(rect.left, FLOATING_PANEL_VIEWPORT_MARGIN),
          Math.max(FLOATING_PANEL_VIEWPORT_MARGIN, maxLeft),
        );
        setPanelPosition({ top: rect.bottom + 4, left });
      }
    }
    setOpen(next);
  }

  function changeMonth(delta: number): void {
    setViewMonth((prev) => new Date(prev.getFullYear(), prev.getMonth() + delta, 1));
  }

  const monthLabel = viewMonth.toLocaleDateString('en-GB', { month: 'long', year: 'numeric' });
  const firstOfMonth = new Date(viewMonth.getFullYear(), viewMonth.getMonth(), 1);
  const daysInMonth = new Date(viewMonth.getFullYear(), viewMonth.getMonth() + 1, 0).getDate();
  const leadingBlanks = firstOfMonth.getDay();
  const today = new Date();

  const cells: (Date | null)[] = [
    ...Array.from({ length: leadingBlanks }, () => null),
    ...Array.from({ length: daysInMonth }, (_, i) => new Date(viewMonth.getFullYear(), viewMonth.getMonth(), i + 1)),
  ];

  return (
    <div className="date-picker" ref={rootRef}>
      <button ref={triggerRef} type="button" className="date-picker-trigger" onClick={toggleOpen} aria-expanded={open}>
        <span className="date-picker-trigger-label">
          {selected ? selected.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }) : placeholder}
        </span>
        <CalendarIcon />
      </button>
      {open && (
        <div className="date-picker-panel" style={{ top: panelPosition.top, left: panelPosition.left }}>
          <div className="date-picker-header">
            <button type="button" aria-label="Previous month" onClick={() => changeMonth(-1)}>
              <ChevronIcon direction="left" />
            </button>
            <span>{monthLabel}</span>
            <button type="button" aria-label="Next month" onClick={() => changeMonth(1)}>
              <ChevronIcon direction="right" />
            </button>
          </div>
          <div className="date-picker-weekdays">
            {WEEKDAY_LABELS.map((label, i) => (
              <span key={i}>{label}</span>
            ))}
          </div>
          <div className="date-picker-grid">
            {cells.map((date, i) => {
              if (!date) return <span key={i} className="date-picker-day date-picker-day--blank" />;
              const disabled = Boolean((min && date < min) || (max && date > max));
              return (
                <button
                  key={i}
                  type="button"
                  disabled={disabled}
                  className={[
                    'date-picker-day',
                    selected && isSameDay(date, selected) ? 'date-picker-day--selected' : '',
                    isSameDay(date, today) ? 'date-picker-day--today' : '',
                  ]
                    .filter(Boolean)
                    .join(' ')}
                  onClick={() => {
                    onChange(toIsoDate(date));
                    setOpen(false);
                  }}
                >
                  {date.getDate()}
                </button>
              );
            })}
          </div>
          {value && (
            <button
              type="button"
              className="date-picker-clear"
              onClick={() => {
                onChange('');
                setOpen(false);
              }}
            >
              Clear
            </button>
          )}
        </div>
      )}
    </div>
  );
}

function CalendarIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <rect x="3" y="5" width="18" height="16" rx="2" stroke="currentColor" strokeWidth="1.6" />
      <path d="M8 3v4M16 3v4M3 10h18" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
    </svg>
  );
}

function ChevronIcon({ direction }: { direction: 'left' | 'right' }) {
  return (
    <svg width="14" height="14" viewBox="0 0 12 12" fill="none" aria-hidden="true">
      <path
        d={direction === 'left' ? 'm7.5 2.5-3.5 3.5 3.5 3.5' : 'm4.5 2.5 3.5 3.5-3.5 3.5'}
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
