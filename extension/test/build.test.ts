import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * Build verification.
 *
 * An extension fails in ways a typechecker cannot see: a file the manifest
 * points at is missing, or the content script is emitted as an ES module that
 * Chrome silently refuses to inject. Both produce a confusing runtime error and
 * no build failure — so they are checked here instead.
 *
 * `npm test` builds first, so dist/ is always current when this runs.
 */

const extensionDir = fileURLToPath(new URL('../', import.meta.url));
const dist = `${extensionDir}dist/`;

interface Manifest {
  manifest_version: number;
  name: string;
  permissions: string[];
  host_permissions?: string[];
  background: { service_worker: string; type?: string };
  action: { default_popup: string };
}

const manifest = JSON.parse(readFileSync(`${extensionDir}manifest.json`, 'utf8')) as Manifest;

describe('manifest', () => {
  it('is Manifest V3', () => {
    expect(manifest.manifest_version).toBe(3);
  });

  it('requests only the permissions we can justify', () => {
    // activeTab + scripting = read the page only when the student acts.
    // storage = remember the last run, so a closed popup loses nothing.
    // Broad host permissions would let us read the portal at any time, which we
    // have never needed and must not start needing by accident.
    expect([...manifest.permissions].sort()).toEqual(['activeTab', 'scripting', 'storage']);
    expect(manifest.host_permissions).toBeUndefined();
  });

  it('runs the service worker as a module', () => {
    expect(manifest.background.type).toBe('module');
  });
});

describe('build output', () => {
  it('was produced', () => {
    expect(existsSync(`${dist}manifest.json`)).toBe(true);
  });

  it.each([
    ['service worker', () => manifest.background.service_worker],
    ['popup page', () => manifest.action.default_popup],
  ])('%s referenced by the manifest exists in dist', (_label, get) => {
    expect(existsSync(`${dist}${get()}`)).toBe(true);
  });

  it('ships content.js, which nothing in the manifest references', () => {
    // Injected programmatically by the worker, so a missing file would only
    // surface as a runtime error in front of the student.
    expect(existsSync(`${dist}content.js`)).toBe(true);
  });

  it('ships the printable page, which the popup cannot be', () => {
    expect(existsSync(`${dist}roadmap.html`)).toBe(true);
  });


  it('emits the content script as a classic script', () => {
    // Chrome cannot inject an ES module as a content script. A stray import
    // here means the two-config build has regressed into one.
    const code = readFileSync(`${dist}content.js`, 'utf8');
    expect(code).not.toMatch(/^\s*import[\s{*"']/m);
    expect(code).not.toMatch(/^\s*export[\s{*]/m);
  });

  it('keeps the injected script small', () => {
    // It runs inside the student's portal page, so it carries detection and
    // extraction and nothing else. The budget is sized for that code growing;
    // it is a tripwire for a framework leaking in, which would be an order of
    // magnitude, not a few kilobytes.
    const bytes = readFileSync(`${dist}content.js`).byteLength;
    expect(bytes).toBeLessThan(60_000);
  });

  it('does not bundle React or zod into the page', () => {
    // The real rule the size budget is protecting: nothing heavy may be
    // injected into someone else's page.
    const code = readFileSync(`${dist}content.js`, 'utf8');
    expect(code).not.toMatch(/react-dom|createRoot|ZodObject|_zod/);
  });
});

/**
 * The PDF rules are stated in the specification, not left to taste: white
 * paper, black text, no colour, no emoji. A test is the only thing that keeps
 * a stylesheet honest about that once someone is styling the screen.
 */
describe('the print stylesheet', () => {
  const css = readFileSync(`${extensionDir}src/styles/print.css`, 'utf8');

  it('forces black on white regardless of the screen design', () => {
    expect(css).toMatch(/color:\s*#000\s*!important/);
    expect(css).toMatch(/background:\s*transparent\s*!important/);
  });

  it('keeps a topic from being split across two pages', () => {
    expect(css).toMatch(/break-inside:\s*avoid/);
  });

  it('does not print controls', () => {
    expect(css).toMatch(/button[\s\S]*display:\s*none/);
  });

  it('sets a real page size and margins', () => {
    expect(css).toMatch(/@page[\s\S]*size:\s*A4/);
    expect(css).toMatch(/margin:\s*18mm/);
  });
});
