import { createHash } from 'node:crypto';

// Two scripts count as the same SQL when they differ only in whitespace,
// blank lines, or trailing semicolons (PRD Feature 12). Case is kept —
// lowercasing would merge 'Demo' and 'demo' string literals.
// ponytail: whitespace inside string literals is collapsed too, so 'a  b'
// and 'a b' match; a real SQL tokenizer if that ever bites.
export function normalizeSql(sql: string): string {
  return sql
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/[\s;]+$/, '');
}

export function sqlFingerprint(sql: string): string {
  return createHash('sha256').update(normalizeSql(sql)).digest('hex');
}
