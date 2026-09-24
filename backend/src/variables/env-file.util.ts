import { parse as dotenvParse } from 'dotenv';

export interface EnvEntry {
  key: string;
  value: string;
}

// Import sources sometimes prefix a line with `export ` (copied from a shell
// script) — dotenv's own parser doesn't strip that (PRD Feature 3).
function stripExportPrefix(text: string): string {
  return text
    .split('\n')
    .map((line) => line.replace(/^\s*export\s+/, ''))
    .join('\n');
}

export function parseEnvFile(text: string): EnvEntry[] {
  const parsed = dotenvParse(stripExportPrefix(text));
  return Object.entries(parsed).map(([key, value]) => ({ key, value }));
}

export function serializeEnvFile(entries: EnvEntry[]): string {
  return (
    entries.map(({ key, value }) => `${key}=${quoteValue(value)}`).join('\n') +
    '\n'
  );
}

// Single-quoted is dotenv's only fully-literal form — no escaping, and a
// round-trip through parseEnvFile reproduces the value exactly (verified:
// backslashes, double quotes, '#', and even raw embedded newlines all pass
// through untouched). Falls back to double quotes only if the value itself
// contains a literal apostrophe (single quotes have no escape mechanism for
// that); this is lossless too unless the value *also* contains a literal
// double quote, a rare compound case dotenv's own format has no way to
// represent — an accepted limitation, not something to hand-roll a custom
// escaping scheme for.
function quoteValue(value: string): string {
  if (!value.includes("'")) return `'${value}'`;
  return `"${value}"`;
}
