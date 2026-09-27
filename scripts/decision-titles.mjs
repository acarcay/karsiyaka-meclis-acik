import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';

const titles = JSON.parse(readFileSync(new URL('../data/decision-titles.json', import.meta.url), 'utf8'));

export function sourceHash(record) {
  return createHash('sha256').update(JSON.stringify([record.text, record.result])).digest('hex');
}

// Readable titles are independent of human verification. Apply them only to
// the exact source text and result they describe, never to a changed decision.
export function applyDisplayTitle(record) {
  const entry = titles[record.id];
  if (!entry || entry.sourceHash !== sourceHash(record)) return record;
  return { ...record, title: entry.title };
}
