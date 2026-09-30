// CLAUDE.md #10/#12: all timestamps are stored/transmitted as UTC, converted
// to IST only for display — DD/MM/YYYY, HH:mm, regardless of the viewer's own
// browser timezone (this is Divami/client ops data, not a personal calendar).
export function formatTimestamp(iso: string): string {
  return new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Kolkata',
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(new Date(iso));
}

// A plain calendar date ("2026-09-24", e.g. the day a DB dump was taken) as
// DD/MM/YYYY. No timezone conversion: it names a day, not a moment.
export function formatCalendarDate(isoDate: string): string {
  const [year, month, day] = isoDate.slice(0, 10).split('-');
  return `${day}/${month}/${year}`;
}
