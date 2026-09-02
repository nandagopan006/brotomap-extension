import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * RULE 2, as an executable guarantee.
 *
 * The moment a technology name appears in detection code, the detector stops
 * being general and becomes a snapshot of one week's syllabus. Comments are
 * exempt - they explain the rule.
 *
 * Deliberately a separate file from the DOM tests: those run in a browser-like
 * environment where import.meta.url is an http URL and the filesystem is not
 * addressable.
 */

/**
 * Scoped to the content layer on purpose. The UI legitimately imports its
 * framework by name; what must never name a technology is the code that decides
 * which task the student is looking at.
 */
const srcDir = fileURLToPath(new URL('../src/content/', import.meta.url));
const forbidden =
  /\b(react|redux|zustand|mobx|mongodb|express|nodejs|node\.js|jwt|python|django|angular|svelte)\b/i;

function walk(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      return walk(full);
    }
    return entry.isFile() && /\.tsx?$/.test(entry.name) ? [full] : [];
  });
}

const files = walk(srcDir);

describe('no hard-coded technology names', () => {
  it('finds the content-layer sources', () => {
    expect(files.length).toBeGreaterThan(4);
  });

  it.each(files)('%s is subject-agnostic', (file) => {
    const code = readFileSync(file, 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/\/\/.*$/gm, '');
    expect(code).not.toMatch(forbidden);
  });
});
