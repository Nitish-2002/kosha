// Environments carry no stored color, so each gets one by its position in the
// project's list (both APIs return environments oldest-first) — the same
// environment is the same color on the Projects list and the project page.
// ponytail: positional, so deleting an environment shifts the later ones'
// colors; add a stored color column if that ever matters.
const ENVIRONMENT_COLOR_COUNT = 8;

export function environmentColor(index: number): string {
  return `var(--color-env-${(index % ENVIRONMENT_COLOR_COUNT) + 1})`;
}
