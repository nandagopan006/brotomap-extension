import { isPortalTaskUrl } from '../config/portal.js';
import { GENERIC_HEADINGS, PATTERNS, isModuleLabelOnly } from '../config/taxonomy.js';
import { readLine, readText } from '../dom/text.js';
import type {
  DetectionResult,
  ExtractionFailureReason,
  ModuleContext,
  TaskCandidate,
} from '../../types/index.js';
import { findGroups, findModuleGroup, type CardGroup } from './cards.js';
import {
  confidenceFor,
  decide,
  examine,
  findSelectedCard,
  toCandidate,
  type ExaminedCard,
} from './classify.js';
import { detectModule } from './module.js';

/**
 * DETECTION — "which technical task is the student on, and what is it called?"
 *
 * Two entry situations, both real and both present at once on the live portal:
 *   A. the module's task list is showing — one of the cards is the technical one
 *   B. a task is open, and the page itself lays out the topics
 *
 * A wins when it is available, because a card carries the task's real name and
 * its category badge, while the opened pane only carries content.
 *
 * Detection reads. It never clicks, never expands, never submits: every path
 * here is side-effect free, which is why it is safe to run the moment the popup
 * opens.
 */

const MAX_GROUPS_EXAMINED = 12;

function fail(
  reason: ExtractionFailureReason,
  message: string,
  candidates: TaskCandidate[] = [],
  retryable = false,
): DetectionResult {
  return { status: 'failed', reason, message, candidates, retryable };
}

function isGenericHeading(text: string): boolean {
  const lower = text.toLowerCase().trim();
  return GENERIC_HEADINGS.some((generic) => lower === generic || lower === `${generic}:`);
}

function countTopicHeadings(text: string): number {
  return text.split('\n').filter((line) => PATTERNS.topicHeading.test(line)).length;
}

// ---------------------------------------------------------------------------
// Situation A — the task list
// ---------------------------------------------------------------------------

interface ExaminedGroup {
  group: CardGroup;
  cards: ExaminedCard[];
  /** How many cards state a category. The strongest "this is the task list" signal. */
  evidence: number;
}

/**
 * Rank the repeated groups by how likely each is to be the task list.
 *
 * Structural score alone is not enough: a sidebar menu, a product grid and a
 * task list are all "a list of similar things". The taxonomy is the real
 * signal — the group whose members declare categories is the task list. Shape
 * only breaks ties.
 */
function rankTaskGroups(groups: CardGroup[]): ExaminedGroup[] {
  return groups
    .filter((group) => group.kind === 'tasks')
    .slice(0, MAX_GROUPS_EXAMINED)
    .map((group) => {
      const cards = group.members.map(examine);
      const evidence = cards.filter(
        (card) => card.evidence.technicalTerm !== null || card.evidence.nonTechnicalTerm !== null,
      ).length;
      return { group, cards, evidence };
    })
    .sort(
      (a, b) =>
        b.evidence - a.evidence ||
        a.group.order - b.group.order ||
        b.group.score - a.group.score,
    );
}

export interface Located {
  result: DetectionResult;
  /** The card element, when one was identified. Needed to open the task. */
  element: Element | null;
  /**
   * The task the portal is currently showing, when that can be told apart.
   * null means "cannot tell", which is treated as "no objection".
   */
  selected: { title: string; classification: ExaminedCard['classification'] } | null;
}

function fromTaskList(cards: ExaminedCard[], moduleContext: ModuleContext | null): Located {
  const decision = decide(cards);
  const chosen = findSelectedCard(cards);
  const selected =
    chosen === null ? null : { title: chosen.title, classification: chosen.classification };

  if (decision.kind === 'none') {
    return {
      element: null,
      selected,
      result: fail(
        'technical-task-not-found',
        'No technical task found in this module.',
        cards.map((card) => toCandidate(card, false, false)),
        true,
      ),
    };
  }

  if (decision.kind === 'ambiguous') {
    // Deliberately no pick. Choosing wrong here would produce a complete,
    // convincing roadmap for the wrong task.
    return {
      element: null,
      selected,
      result: fail(
        'technical-task-ambiguous',
        'Technical task could not be confidently identified.',
        cards.map((card) => toCandidate(card, false, false)),
        true,
      ),
    };
  }

  const candidates = cards.map((card) =>
    toCandidate(card, card === decision.card, decision.viaExclusion),
  );

  if (moduleContext === null) {
    return {
      element: decision.card.element,
      selected,
      result: fail(
        'module-not-found',
        'Found the technical task but could not tell which module it belongs to.',
        candidates,
        true,
      ),
    };
  }

  return {
    element: decision.card.element,
    selected,
    result: {
    status: 'ok',
    module: moduleContext,
    taskTitle: decision.card.title,
    detection: {
      confidence: confidenceFor(decision.score),
      score: decision.score,
      matchedSignals: decision.signals,
      candidates,
      warnings: decision.viaExclusion
        ? ['Identified by elimination: no card stated its category as technical.']
        : [],
      interactionCount: 0,
    },
    },
  };
}

// ---------------------------------------------------------------------------
// Situation B — an opened task page
// ---------------------------------------------------------------------------

interface OpenedTask {
  title: string;
  declaredTopicCount: number | undefined;
  topicHeadings: number;
}

/**
 * The signature is structural and technology-agnostic: a task that declares a
 * topic count, or lays out numbered topics. No other task category does.
 */
export function detectOpenedTask(doc: Document): OpenedTask | null {
  const body = doc.body ? readText(doc.body) : '';
  const declared = PATTERNS.topicCount.exec(body);
  const topicHeadings = countTopicHeadings(body);

  if (declared === null && topicHeadings < 2) {
    return null;
  }

  const title = findTaskTitle(doc);

  if (title === null) {
    return null;
  }

  const count = declared?.[1];

  return {
    title,
    declaredTopicCount: count === undefined ? undefined : Number(count),
    topicHeadings,
  };
}

/**
 * The task's own name, whatever it happens to be this week.
 *
 * Found by elimination: skip a heading that is only the module label, skip page
 * furniture, skip topic headings — the first heading left is the subject.
 */
function findTaskTitle(doc: Document): string | null {
  const headings = Array.from(doc.querySelectorAll('h1, h2, h3, [role="heading"]'));

  for (const heading of headings) {
    const text = readLine(heading);

    if (
      text.length < 3 ||
      text.length > 120 ||
      isGenericHeading(text) ||
      PATTERNS.topicHeading.test(text) ||
      // Skip a heading that is *only* the module label; keep one that merely
      // ends with it, because that is how the portal names its tasks.
      isModuleLabelOnly(text)
    ) {
      continue;
    }

    return text;
  }

  return null;
}

function fromOpenedTask(opened: OpenedTask, moduleContext: ModuleContext | null): DetectionResult {
  const candidate: TaskCandidate = {
    title: opened.title,
    classification: 'technical',
    score: 0.85,
    matchedSignals: ['structure-signature'],
  };

  if (moduleContext === null) {
    return fail(
      'module-not-found',
      'Found a technical task but could not tell which module it belongs to.',
      [candidate],
      true,
    );
  }

  const warnings =
    opened.declaredTopicCount !== undefined && opened.declaredTopicCount !== opened.topicHeadings
      ? [
          `The page declares ${opened.declaredTopicCount} topics but ${opened.topicHeadings} are visible. Some may be collapsed.`,
        ]
      : [];

  return {
    status: 'ok',
    module: moduleContext,
    taskTitle: opened.title,
    detection: {
      confidence: 'high',
      score: 0.85,
      matchedSignals: ['structure-signature'],
      candidates: [candidate],
      warnings,
      interactionCount: 0,
    },
  };
}

// ---------------------------------------------------------------------------

/**
 * Detection, plus the element that was identified.
 *
 * The element matters to extraction: when the student is on a task *list*, the
 * topics are not on the page at all and the task has to be opened first.
 */
export function locateTechnicalTask(doc: Document, url = doc.location?.href ?? ''): Located {
  if (!doc.body) {
    return {
      element: null,
      selected: null,
      result: fail('not-on-portal', 'This page has nothing to read.'),
    };
  }

  const groups = findGroups(doc.body);
  const moduleGroup = findModuleGroup(groups);
  const ranked = rankTaskGroups(groups);
  const onPortal = isPortalTaskUrl(url);

  /**
   * Try each candidate group, best evidence first, and take the first that
   * identifies exactly one technical task.
   *
   * Committing to a single group was a real failure on the live portal: the
   * page offered several plausible groups and the first one chosen was a
   * wrapper that happened to contain only two of the four cards. A group that
   * cannot produce a confident answer is not evidence of a problem — it is
   * evidence that it was not the task list.
   */
  let firstFailure: Located | null = null;

  for (const candidate of ranked) {
    const moduleContext = detectModule(doc, moduleGroup, candidate.group.parent);
    const located = fromTaskList(candidate.cards, moduleContext);

    if (located.result.status === 'ok') {
      return located;
    }

    // Keep the most informative failure: one from a group whose cards actually
    // stated categories tells the student far more than one from a sidebar.
    if (firstFailure === null && candidate.evidence > 0) {
      firstFailure = located;
    }
  }

  const opened = detectOpenedTask(doc);

  if (opened !== null) {
    return {
      element: null,
      selected: null,
      result: fromOpenedTask(opened, detectModule(doc, moduleGroup)),
    };
  }

  if (firstFailure !== null) {
    return firstFailure;
  }

  // Any page with a list of cards has "task cards" as far as a structural
  // detector is concerned — a shop's product grid included. Before reporting
  // anything about tasks, require evidence this is actually the portal.
  if (!onPortal && detectModule(doc, moduleGroup) === null) {
    return {
      element: null,
      selected: null,
      result: fail(
        'not-on-portal',
        'This does not look like a Brototype task page. Open your module and try again.',
      ),
    };
  }

  return {
    element: null,
    selected: null,
    result: fail(
      'no-tasks-found',
      'No technical task found on this page. Open a module and try again.',
      [],
      true,
    ),
  };
}

export function detectTechnicalTask(doc: Document, url = doc.location?.href ?? ''): DetectionResult {
  return locateTechnicalTask(doc, url).result;
}
