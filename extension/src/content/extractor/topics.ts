import { ATTACHMENT_COUNT, CONTROL_LINE, NUMBERED_TITLE, RESPONSE_MARKERS } from '../config/content.js';
import { NOISE_TAGS } from '../config/selectors.js';
import { PATTERNS, isChipLabel } from '../config/taxonomy.js';
import { readLine, readText } from '../dom/text.js';
import type { ExtractedAttachment, ExtractedLink, ExtractedSection } from '../../types/index.js';

/**
 * TOPIC DISCOVERY AND PARSING
 *
 * The live portal lays a technical task out as numbered blocks:
 *
 *   Topic 1
 *   1). State Management with Redux
 *   A) Introduction to Redux and the need for global state management
 *   B) Understanding the Redux data flow
 *   ...
 *   Your Response          <- everything below here is the student's own work
 *
 * Topics are found by that numbering, never by class or subject, so the same
 * code reads any week's task.
 */

const MAX_ELEMENTS = 8000;

/** Cheap pre-filter: only elements whose text begins with a topic number. */
const LOOKS_LIKE_TOPIC = /^\s*topic\s*\d/i;

export interface TopicElement {
  index: number;
  element: Element;
}

/**
 * Every numbered topic block on the page, in source order.
 *
 * Elements whose text *starts with* "Topic N" are collected and grouped by
 * parent; the parent holding the most distinct numbers is the topic list. That
 * naturally rejects both the single label inside a topic and the container that
 * merely begins with the first one.
 */
export function discoverTopics(doc: Document): TopicElement[] {
  if (!doc.body) {
    return [];
  }

  const byParent = new Map<Element, Map<number, Element>>();

  for (const element of Array.from(doc.body.querySelectorAll('*')).slice(0, MAX_ELEMENTS)) {
    if (NOISE_TAGS.has(element.tagName)) {
      continue;
    }

    // Cheap gate first. readLine walks the whole subtree and builds a string;
    // doing that for every element on the page was most of the wait. textContent
    // is native, and only a handful of elements survive this test.
    // trimStart before slicing: markup indentation is whitespace, and slicing
    // first cut the text off before the word ever appeared.
    if (!LOOKS_LIKE_TOPIC.test((element.textContent ?? '').trimStart().slice(0, 24))) {
      continue;
    }

    const match = PATTERNS.topicHeading.exec(readLine(element));
    const parent = element.parentElement;

    if (match === null || parent === null) {
      continue;
    }

    const index = Number(match[1]);
    const found = byParent.get(parent) ?? new Map<number, Element>();

    // Document order means the outermost element for a number arrives first,
    // and that is the one holding the whole block.
    if (!found.has(index)) {
      found.set(index, element);
    }

    byParent.set(parent, found);
  }

  let best: Map<number, Element> | null = null;

  for (const found of byParent.values()) {
    if (best === null || found.size > best.size) {
      best = found;
    }
  }

  if (best === null || best.size === 0) {
    return [];
  }

  return Array.from(best.entries())
    .map(([index, element]) => ({ index, element }))
    .sort((a, b) => a.index - b.index);
}

/**
 * Waits for the page to finish putting its topics on screen.
 *
 * The portal declares how many there are, which makes this checkable rather
 * than a guess: keep looking until that many have appeared, or until waiting
 * stops being reasonable. Returns whatever is there at the end - a partial read
 * that says so beats an empty one that does not.
 */
export async function waitForTopics(
  doc: Document,
  limits: { settleMs: number; settlePollMs: number },
): Promise<TopicElement[]> {
  const declared = declaredTopicCount(doc);
  const deadline = Date.now() + limits.settleMs;

  let found = discoverTopics(doc);
  let stableFor = 0;

  while (Date.now() < deadline) {
    // Everything the page said it has: nothing left to wait for.
    if (declared !== undefined && found.length >= declared) {
      return found;
    }

    await new Promise((resolve) => setTimeout(resolve, limits.settlePollMs));
    const next = discoverTopics(doc);

    if (next.length > found.length) {
      found = next;
      stableFor = 0;
      continue;
    }

    stableFor += limits.settlePollMs;

    // No declared count to aim for, and nothing new for a while: this is all
    // the page is going to render.
    if (declared === undefined && found.length > 0 && stableFor >= limits.settlePollMs * 4) {
      return found;
    }
  }

  return found;
}

/** The topic count the page declares for itself, when it states one. */
export function declaredTopicCount(doc: Document): number | undefined {
  const match = doc.body ? PATTERNS.topicCount.exec(readText(doc.body)) : null;
  const value = match?.[1];
  return value === undefined ? undefined : Number(value);
}

export interface ParsedTopic {
  title: string;
  content: string;
  sections: ExtractedSection[];
  links: ExtractedLink[];
  attachments: ExtractedAttachment[];
  /** True when the block held more than its own heading. */
  hasContent: boolean;
}

/**
 * Lines that are page furniture rather than task content: the block's own
 * "Topic N" label, its expander button, status chips, and the attachment count
 * (which is recorded separately as a fact).
 */
function isNoise(line: string): boolean {
  return (
    (PATTERNS.topicHeading.test(line) && line.length <= 20) ||
    CONTROL_LINE.test(line) ||
    ATTACHMENT_COUNT.test(line) ||
    isChipLabel(line)
  );
}

function isResponseBoundary(line: string): boolean {
  const lower = line.toLowerCase().trim();
  return RESPONSE_MARKERS.some((marker) => lower === marker || lower.startsWith(marker));
}

/**
 * Panels a block controls but does not contain.
 *
 * An accordion may render its content outside the header it belongs to and link
 * the two with aria-controls. Reading only the block would then come back empty
 * however many times it was opened.
 */

/**
 * Splits a topic block into the task's instructions and nothing else.
 *
 * Cutting at the response boundary is the point: what follows is the student's
 * own answer. Including it would mean planning a week around work already done.
 */
export function linkedPanels(element: Element): Element[] {
  const panels: Element[] = [];
  const doc = element.ownerDocument;
  const controls = [element, ...Array.from(element.querySelectorAll('[aria-controls]'))];

  for (const control of controls) {
    const id = control.getAttribute('aria-controls');

    if (id === null || id.length === 0) {
      continue;
    }

    const panel = doc.getElementById(id);

    if (panel !== null && !element.contains(panel) && !panels.includes(panel)) {
      panels.push(panel);
    }
  }

  return panels;
}

export function parseTopic(element: Element, index: number, extra: Element[] = []): ParsedTopic {
  const lines: string[] = [];
  const source = [element, ...extra].map((node) => readText(node)).join('\n');

  for (const raw of source.split('\n')) {
    const line = raw.trim();

    // Everything past the boundary is the student's own work.
    if (isResponseBoundary(line)) {
      break;
    }

    if (line.length === 0 || isNoise(line)) {
      continue;
    }

    lines.push(line);
  }

  // The portal numbers its topic titles ("1). State Management with Redux"),
  // which is a far better signal than "the first line" — an accordion's own
  // button often sits above the title and would otherwise become the name.
  const numbered = lines.find((line) => NUMBERED_TITLE.test(line));
  const title = numbered === undefined ? (lines[0] ?? '') : (NUMBERED_TITLE.exec(numbered)?.[2] ?? '');

  const body: string[] = [];

  for (const line of lines) {
    // Skip the title itself and the copy of it the portal repeats as a heading.
    if (line === numbered || line === title) {
      continue;
    }

    if (numbered === undefined && line === lines[0]) {
      continue;
    }

    body.push(line);
  }

  const content = body.join('\n');
  const items = body.filter((line) => /^([A-Za-z]\)|\d+[.)])/.test(line));

  const sections: ExtractedSection[] =
    content.length === 0
      ? []
      : [
          {
            kind: items.length >= 2 ? 'instructions' : 'description',
            content,
            ...(items.length >= 2 ? { items } : {}),
          },
        ];

  return {
    title: title === '' ? `Topic ${index}` : title,
    content,
    sections,
    links: [element, ...extra].flatMap((node) => readLinks(node)),
    attachments: readAttachments(element),
    hasContent: content.length > 0,
  };
}

function readLinks(element: Element): ExtractedLink[] {
  const links: ExtractedLink[] = [];

  for (const anchor of Array.from(element.querySelectorAll('a[href]')).slice(0, 30)) {
    const url = anchor.getAttribute('href') ?? '';
    const label = readLine(anchor);

    if (url.length === 0 || url.startsWith('#') || url.startsWith('javascript:')) {
      continue;
    }

    links.push({ label: label.length > 0 ? label : url, url, kind: 'reference' });
  }

  return links;
}

/**
 * Attachments are recorded as facts, not fetched.
 *
 * The portal states a count ("1 attachment added") without exposing the files,
 * and they belong to the student's submission anyway. Knowing one exists is
 * useful context; downloading it is not our business.
 */
function readAttachments(element: Element): ExtractedAttachment[] {
  const match = ATTACHMENT_COUNT.exec(readText(element));

  if (match?.[1] === undefined) {
    return [];
  }

  const count = Math.min(Number(match[1]), 10);

  return Array.from({ length: count }, (_, position) => ({
    name: `Attachment ${position + 1}`,
    accessible: false,
  }));
}
