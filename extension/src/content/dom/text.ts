import { NOISE_TAGS } from '../config/selectors.js';

/**
 * DOM reading helpers.
 *
 * Pure functions over an element, so every one of them is testable against a
 * synthetic document without a browser.
 */

const LINE_BREAK = '\n';

/** Elements that do not imply a line break around their text. */
const INLINE_TAGS = new Set([
  'A', 'ABBR', 'B', 'BDI', 'BDO', 'BR', 'CITE', 'CODE', 'DATA', 'EM', 'I',
  'KBD', 'LABEL', 'MARK', 'Q', 'S', 'SAMP', 'SMALL', 'SPAN', 'STRONG', 'SUB',
  'SUP', 'TIME', 'U', 'VAR', 'WBR',
]);

/**
 * Collapsed visible text with line structure preserved.
 *
 * textContent alone is not usable here: it concatenates without separators, so
 * a heading and the paragraph under it arrive as one run ("Topic 1State
 * Management"). Every line-based signal - topic headings, list items, topic
 * boundaries - would silently never match. Block elements therefore get an
 * explicit newline around them.
 */
export function readText(element: Element): string {
  const parts: string[] = [];
  collectText(element, parts);
  return normalise(parts.join(''));
}

function collectText(node: Node, out: string[]): void {
  if (node.nodeType === 3 /* text */) {
    out.push(node.nodeValue ?? '');
    return;
  }

  if (node.nodeType !== 1 /* element */) {
    return;
  }

  const element = node as Element;

  if (NOISE_TAGS.has(element.tagName)) {
    return;
  }

  const isBlock = !INLINE_TAGS.has(element.tagName);

  if (isBlock) {
    out.push(LINE_BREAK);
  }

  for (const child of Array.from(element.childNodes)) {
    collectText(child, out);
  }

  if (isBlock) {
    out.push(LINE_BREAK);
  }
}

export function normalise(text: string): string {
  return text
    .replace(/ /g, ' ')
    .replace(/[\t ]+/g, ' ')
    .replace(/\s*\n\s*/g, '\n')
    .trim();
}

/** Single-line version, for titles and labels. */
export function readLine(element: Element): string {
  return readText(element).replace(/\s*\n\s*/g, ' ').trim();
}

/**
 * A "structure signature" for grouping siblings.
 *
 * Tag and role only — deliberately NOT class names.
 *
 * The live portal proved why: its task cards carry their status in a class, so
 * the two "Verified" cards and the two "Submitted" cards formed two separate
 * groups of two, and detection only ever saw half the list. Any class-based
 * signature is hostage to whatever state the portal encodes there — selection,
 * status, animation, a framework's hashed class. Tag and role are stable.
 *
 * Grouping this loosely does mix unrelated siblings occasionally; that is
 * handled downstream, where the group is chosen by what its members say rather
 * than by its shape.
 */
export function signatureOf(element: Element): string {
  return `${element.tagName}|${element.getAttribute('role') ?? ''}`;
}

/** All attribute values on an element and its descendants, joined for scanning. */
export function attributeText(element: Element, names: readonly string[]): string {
  const values: string[] = [];

  const collect = (node: Element): void => {
    for (const name of names) {
      const value = node.getAttribute(name);
      if (value) {
        values.push(value);
      }
    }
  };

  collect(element);
  for (const child of Array.from(element.querySelectorAll('*')).slice(0, 40)) {
    collect(child);
  }

  return values.join(' ');
}

/** Depth-limited descendant count, used to tell a card apart from a page section. */
export function elementCount(element: Element): number {
  return element.querySelectorAll('*').length;
}
