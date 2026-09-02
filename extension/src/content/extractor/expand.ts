import {
  EXPANDER_SELECTORS,
  EXPANSION_LIMITS,
  FORBIDDEN_CONTROL,
  MORE_CONTROL,
} from '../config/content.js';
import { readLine } from '../dom/text.js';
import type { ExpansionOutcome } from '../../types/index.js';

/**
 * SAFE EXPANSION — read before touch, then try properly.
 *
 * Brotomap is an analysis tool, not an agent acting on a student's account.
 * The order here is deliberate and never varies:
 *
 *   1. content readable already        -> read it, touch nothing
 *   2. content genuinely absent        -> open it, read it, put it back
 *   3. cannot open it safely           -> say so, and keep the other topics
 *
 * Step 2 has to be persistent rather than polite: a roadmap built from one of
 * six topics is worthless, so if the obvious control does not work the next
 * candidate is tried. What never bends is the safety rule - only small controls
 * are pressed, never anything that submits, deletes, uploads or navigates.
 */

export interface ExpansionBudget {
  interactions: number;
  /** Wall-clock limit for all expansion in one extraction. */
  deadline: number;
}

export function newBudget(): ExpansionBudget {
  return { interactions: 0, deadline: Date.now() + EXPANSION_LIMITS.totalMs };
}

/**
 * Everything in this block that could plausibly open it, best first.
 *
 * The live portal's expander is a bare chevron icon — no button element, no
 * aria-expanded — so searching only for the accessible pattern found nothing
 * and five of six topics came back empty.
 */
export function findToggles(element: Element): Element[] {
  const seen = new Set<Element>();
  const ordered: Element[] = [];

  const add = (candidate: Element | null): void => {
    if (candidate === null || seen.has(candidate) || !element.contains(candidate)) {
      return;
    }
    seen.add(candidate);
    // A control is a small thing. Clicking a whole panel is not expanding, it
    // is gambling on whatever happens to be underneath.
    if (readLine(candidate).length <= 160 && isSafeToClick(candidate)) {
      ordered.push(candidate);
    }
  };

  for (const selector of EXPANDER_SELECTORS) {
    if (element.matches(selector)) {
      add(element);
    }
    for (const found of Array.from(element.querySelectorAll(selector))) {
      add(found);
    }
  }

  for (const button of Array.from(element.querySelectorAll('button, [role="button"]'))) {
    add(button);
  }

  // A chevron: an icon, and whatever is wrapped around it.
  for (const icon of Array.from(element.querySelectorAll('svg, i, img')).slice(0, 20)) {
    add(icon.parentElement);
    add(icon.parentElement?.parentElement ?? null);
  }

  // Accordion headers are usually the click target themselves.
  add(element.firstElementChild);

  return ordered.slice(0, EXPANSION_LIMITS.maxCandidates);
}

/** The first candidate only, for callers that just want to know one exists. */
export function findToggle(element: Element): Element | null {
  return findToggles(element)[0] ?? null;
}

export function isSafeToClick(candidate: Element): boolean {
  const label = `${readLine(candidate)} ${candidate.getAttribute('aria-label') ?? ''} ${
    candidate.getAttribute('title') ?? ''
  }`;

  if (FORBIDDEN_CONTROL.test(label)) {
    return false;
  }

  // Never interact inside a form: a stray click there can submit it.
  if (candidate.closest('form') !== null) {
    return false;
  }

  // Never follow a link that would navigate away mid-extraction.
  const href = candidate.getAttribute('href');
  if (href !== null && href.length > 0 && !href.startsWith('#')) {
    return false;
  }

  if (candidate instanceof HTMLInputElement || candidate instanceof HTMLTextAreaElement) {
    return false;
  }

  return true;
}

/**
 * Reveals instruction text the portal truncated behind "Read more".
 *
 * Observed on the live page: an instruction ends "Write a short description
 * about this ta... Read more". Half a sentence is not a task, and an AI given
 * half a sentence plans a week around it as though it were whole.
 *
 * Returns the controls pressed, so they can be pressed again afterwards.
 */
export async function revealTruncatedText(
  element: Element,
  budget: ExpansionBudget,
): Promise<Element[]> {
  const clicked: Element[] = [];

  for (const candidate of Array.from(element.querySelectorAll('*')).slice(0, 400)) {
    if (clicked.length >= EXPANSION_LIMITS.maxMoreControls) {
      break;
    }

    if (budget.interactions >= EXPANSION_LIMITS.maxInteractions || Date.now() > budget.deadline) {
      break;
    }

    if (candidate.children.length > 0 || !MORE_CONTROL.test(readLine(candidate))) {
      continue;
    }

    if (!isSafeToClick(candidate)) {
      continue;
    }

    budget.interactions += 1;
    clicked.push(candidate);
    (candidate as HTMLElement).click();
    await pause(EXPANSION_LIMITS.pauseMs);
  }

  return clicked;
}

/** Pressing them again collapses the text back. */
export function collapseAgain(clicked: Element[], budget: ExpansionBudget): () => Promise<void> {
  return async () => {
    for (const control of [...clicked].reverse()) {
      if (budget.interactions >= EXPANSION_LIMITS.maxInteractions * 2) {
        return;
      }
      budget.interactions += 1;
      (control as HTMLElement).click();
    }
  };
}

/**
 * Opens the technical task from a list.
 *
 * Navigation, unlike expansion, is deliberate: the student asked for a roadmap
 * for this task, the topics live on the task's own page, and the specification
 * requires Brotomap to get there without them hunting for it. It still refuses
 * anything that reads as destructive, and it only ever runs on the card that
 * detection identified - never on a guess.
 */
export function openTaskCard(card: Element): boolean {
  const label = `${readLine(card)} ${card.getAttribute('aria-label') ?? ''}`;

  if (FORBIDDEN_CONTROL.test(label) || card.closest('form') !== null) {
    return false;
  }

  // Prefer the card's own link or heading: some portals only bind the click
  // handler to the inner element.
  const target =
    card.querySelector('a[href]') ??
    card.querySelector('[role="button"], button') ??
    card;

  (target as HTMLElement).click();
  return true;
}

/** Only meaningful when the control actually declares its state. */
function isCollapsed(toggle: Element): boolean {
  return (
    toggle.getAttribute('aria-expanded') === 'false' ||
    toggle.getAttribute('data-expanded') === 'false'
  );
}

const pause = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Waits until the content is actually readable, not merely until something
 * changed. A class flip or an animation frame fires a mutation long before the
 * text arrives, and treating that as success was reporting empty topics.
 */
async function waitForContent(read: () => string, timeoutMs: number): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    if (read().length >= EXPANSION_LIMITS.minContentChars) {
      return true;
    }
    await pause(EXPANSION_LIMITS.pollMs);
  }

  return read().length >= EXPANSION_LIMITS.minContentChars;
}

export interface ExpansionResult {
  outcome: ExpansionOutcome;
  /** Set when we opened something and must close it again afterwards. */
  restore: (() => Promise<void>) | null;
  /** How many controls were tried. Reported so the page's cost is visible. */
  attempts: number;
}

/**
 * Opens one topic if, and only if, it is necessary and safe.
 * `read` re-reads the block, so the caller decides what counts as content.
 */
export async function expandIfNeeded(
  element: Element,
  read: () => string,
  budget: ExpansionBudget,
): Promise<ExpansionResult> {
  // `read` walks the DOM, which CSS cannot hide from. If it already returns the
  // content, the block needs no interaction whether it looks open or not.
  if (read().length >= EXPANSION_LIMITS.minContentChars) {
    const existing = findToggle(element);
    return {
      outcome: existing !== null && isCollapsed(existing) ? 'hidden-in-dom' : 'already-visible',
      restore: null,
      attempts: 0,
    };
  }

  const candidates = findToggles(element);
  const clicked: Element[] = [];

  for (const toggle of candidates) {
    if (budget.interactions >= EXPANSION_LIMITS.maxInteractions || Date.now() > budget.deadline) {
      break;
    }

    budget.interactions += 1;
    clicked.push(toggle);
    (toggle as HTMLElement).click();

    const wait = clicked.length === 1 ? EXPANSION_LIMITS.waitMs : EXPANSION_LIMITS.retryWaitMs;

    if (await waitForContent(read, wait)) {
      return { outcome: 'expanded-by-us', restore: closeAgain(clicked, budget), attempts: clicked.length };
    }
  }

  return {
    outcome: 'unavailable',
    restore: clicked.length > 0 ? closeAgain(clicked, budget) : null,
    attempts: clicked.length,
  };
}

/**
 * Putting the page back the way it was found is part of the contract.
 *
 * Anything opened is closed again, in reverse order. A control that now reports
 * itself closed is skipped: an accordion allowing one open panel has already
 * closed this one, and clicking again would re-open it.
 */
function closeAgain(clicked: Element[], budget: ExpansionBudget): () => Promise<void> {
  return async () => {
    for (const toggle of [...clicked].reverse()) {
      if (budget.interactions >= EXPANSION_LIMITS.maxInteractions * 2 || isCollapsed(toggle)) {
        continue;
      }
      budget.interactions += 1;
      (toggle as HTMLElement).click();
      // No pause: everything has been read by this point, so there is nothing
      // left to wait for. Pausing here was dead time at the end of every run.
    }
  };
}
