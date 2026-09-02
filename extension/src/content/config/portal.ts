/**
 * PORTAL IDENTITY — the one file that knows where Brotomap works.
 *
 * Knowing the portal's host is not the same as knowing this week's subject:
 * the host is permanent, the subject changes weekly. Rule 2 forbids the second,
 * not the first.
 *
 * Confirmed from the live portal:
 *   https://student.brototype.com/tasks/module/details?id=<uuid>
 */

export const PORTAL_HOSTS = ['brototype.com'] as const;

/** Paths where a module's tasks are shown. */
export const PORTAL_PATHS = [/\/tasks?\b/i, /\/module\b/i] as const;

export function isPortalHost(url: string): boolean {
  try {
    const { hostname } = new URL(url);
    return PORTAL_HOSTS.some((host) => hostname === host || hostname.endsWith(`.${host}`));
  } catch {
    return false;
  }
}

export function isPortalTaskUrl(url: string): boolean {
  if (!isPortalHost(url)) {
    return false;
  }

  try {
    const { pathname } = new URL(url);
    return PORTAL_PATHS.some((pattern) => pattern.test(pathname));
  } catch {
    return false;
  }
}
