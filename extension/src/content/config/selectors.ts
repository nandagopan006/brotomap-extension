/**
 * PORTAL SELECTORS — the only file that may contain portal-specific CSS.
 *
 * Empty on purpose right now: no real portal HTML has been captured yet, so
 * every selector would be a guess. Detection therefore runs on structure and
 * semantics alone, which is the behaviour we want as the *fallback* anyway.
 *
 * When real HTML arrives, fill these in. They are tried first as a fast path;
 * if they miss, the structural detector still runs. That ordering means a
 * portal redesign degrades performance, never correctness.
 */

export interface PortalSelectors {
  /** Container holding the module list. */
  moduleList: string[];
  /** The currently selected module inside that list. */
  activeModule: string[];
  /** Container holding the task cards for the selected module. */
  taskList: string[];
  /** An individual task card. */
  taskCard: string[];
  /** An element inside a card that states its category. */
  categoryLabel: string[];
  /** A topic section on an opened task page. */
  topicSection: string[];
}

export const SELECTORS: PortalSelectors = {
  moduleList: [],
  activeModule: [],
  taskList: [],
  taskCard: [],
  categoryLabel: [],
  topicSection: [],
};

/** Generic markers of "this element is the selected one", by convention. */
export const ACTIVE_MARKERS = [
  '[aria-current]',
  '[aria-selected="true"]',
  '[data-active="true"]',
  '[data-selected="true"]',
  '.active',
  '.selected',
  '.is-active',
  '.is-selected',
] as const;

/** Elements that never contain task content. Skipped before anything is read. */
export const NOISE_TAGS = new Set([
  'SCRIPT',
  'STYLE',
  'NOSCRIPT',
  'SVG',
  'NAV',
  'HEADER',
  'FOOTER',
  'ASIDE',
  'IFRAME',
  'TEMPLATE',
]);

export function queryFirst(root: ParentNode, selectors: readonly string[]): Element | null {
  for (const selector of selectors) {
    const found = root.querySelector(selector);
    if (found) {
      return found;
    }
  }
  return null;
}
