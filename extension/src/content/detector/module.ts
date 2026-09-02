import { ACTIVE_MARKERS, NOISE_TAGS, SELECTORS, queryFirst } from '../config/selectors.js';
import { isModuleLabelOnly } from '../config/taxonomy.js';
import { readLine } from '../dom/text.js';
import type { ModuleContext } from '../../types/index.js';
import type { CardGroup } from './cards.js';

/**
 * CURRENT MODULE — always read, never assumed.
 *
 * Module numbers are data. Nothing here may branch on a particular one; the
 * only thing hard-coded is the *shape* of a module label.
 *
 * The live portal shows the current module as a single chip with previous/next
 * arrows, not as a list, and renders it without a semantic heading tag. So the
 * module is found by scanning for elements whose entire text is a module label,
 * which works whether the portal uses <h1>, <div> or <span>.
 */

const MAX_ELEMENTS = 6000;
const MAX_LABEL_LENGTH = 40;

function fromActiveMarker(group: CardGroup): Element | null {
  for (const member of group.members) {
    for (const marker of ACTIVE_MARKERS) {
      if (member.matches(marker) || member.querySelector(marker)) {
        return member;
      }
    }
  }
  return null;
}

/** Every element whose entire text is a module label. */
function scanForModuleLabels(doc: Document): Element[] {
  if (!doc.body) {
    return [];
  }

  const found: Element[] = [];

  for (const element of Array.from(doc.body.querySelectorAll('*')).slice(0, MAX_ELEMENTS)) {
    if (NOISE_TAGS.has(element.tagName) || element.children.length > 3) {
      continue;
    }

    // Cheap gate before the expensive read: readLine walks the whole subtree
    // and builds a string, while textContent is native. A module label is short
    // and says the word, and almost nothing else on the page does both.
    const raw = element.textContent ?? '';

    if (raw.length > MAX_LABEL_LENGTH * 3 || !/module/i.test(raw)) {
      continue;
    }

    const text = readLine(element);

    if (text.length > 0 && text.length <= MAX_LABEL_LENGTH && isModuleLabelOnly(text)) {
      found.push(element);
    }
  }

  return found;
}

/**
 * Steps between two elements through their nearest common ancestor.
 * Used to pick the module label that belongs to the task list we found, rather
 * than one sitting elsewhere on the page.
 */
function domDistance(from: Element, to: Element): number {
  const chain: Element[] = [];

  for (let node: Element | null = from; node !== null; node = node.parentElement) {
    chain.push(node);
  }

  let depth = 0;

  for (let node: Element | null = to; node !== null; node = node.parentElement) {
    const index = chain.indexOf(node);
    if (index >= 0) {
      return index + depth;
    }
    depth += 1;
  }

  return Number.MAX_SAFE_INTEGER;
}

/**
 * @param anchor the task list, when one was found. A page can show several
 * module labels — a chip for the current module, a grid of other modules, a
 * sidebar entry. The one nearest the task list is the one those tasks belong to.
 */
export function detectModule(
  doc: Document,
  moduleGroup: CardGroup | null,
  anchor: Element | null = null,
): ModuleContext | null {
  const configured = queryFirst(doc, SELECTORS.activeModule);

  if (configured) {
    return { title: readLine(configured), isCurrent: true };
  }

  if (moduleGroup) {
    const active = fromActiveMarker(moduleGroup);
    if (active) {
      return { title: readLine(active), isCurrent: true };
    }
  }

  const labels = scanForModuleLabels(doc);

  if (labels.length === 0) {
    return null;
  }

  const ranked = labels
    .map((element) => ({
      element,
      text: readLine(element),
      distance: anchor === null ? 0 : domDistance(element, anchor),
    }))
    .sort((a, b) => a.distance - b.distance || a.text.length - b.text.length);

  const best = ranked[0];

  if (best === undefined) {
    return null;
  }

  // The portal shows one module at a time, so the label on screen beside the
  // task list *is* the module the student is currently in.
  return { title: best.text, isCurrent: true };
}
