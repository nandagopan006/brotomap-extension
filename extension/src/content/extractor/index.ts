import { EXPANSION_LIMITS } from '../config/content.js';
import { readText } from '../dom/text.js';
import { locateTechnicalTask } from '../detector/index.js';
import type { ExtractedTechnicalTask, ExtractedTopic, ExtractionOutcome } from '../../types/index.js';
import {
  collapseAgain,
  expandIfNeeded,
  newBudget,
  openTaskCard,
  revealTruncatedText,
} from './expand.js';
import {
  declaredTopicCount,
  linkedPanels,
  parseTopic,
  waitForTopics,
} from './topics.js';

/**
 * EXTRACTION — everything the technical task actually says.
 *
 * Runs only when the student asks for a roadmap, never on detection: this is
 * the one part of Brotomap allowed to touch the page, and then only to open a
 * collapsed topic it could not otherwise read.
 *
 * Detection first, so extraction always knows which task it is reading and can
 * report the same honest failures.
 */

const MAX_TOTAL_CHARS = 60_000;

/**
 * Remembers that the technical task has been opened during this run.
 *
 * sessionStorage rather than a variable, because opening the task can navigate
 * the page, and a variable does not survive that. Scoped to the tab and cleared
 * as soon as extraction finishes.
 */
const OPENED_KEY = 'brotomap:opened-task';

function alreadyOpened(title: string): boolean {
  try {
    return sessionStorage.getItem(OPENED_KEY) === title;
  } catch {
    return false;
  }
}

function markOpened(title: string): void {
  try {
    sessionStorage.setItem(OPENED_KEY, title);
  } catch {
    // Private mode or a blocked origin: worst case we open the task twice.
  }
}

function clearOpened(): void {
  try {
    sessionStorage.removeItem(OPENED_KEY);
  } catch {
    // Nothing to clean up.
  }
}

export interface ExtractOptions {
  /**
   * The student has been told the open task is not one Brotomap plans for, and
   * has asked for the technical task anyway.
   */
  useTechnical?: boolean;
}

export async function extractTechnicalTask(
  doc: Document,
  url = doc.location?.href ?? '',
  options: ExtractOptions = {},
): Promise<ExtractionOutcome> {
  const located = locateTechnicalTask(doc, url);
  const detection = located.result;

  if (detection.status === 'failed') {
    clearOpened();
    return {
      status: 'failed',
      reason: detection.reason,
      message: detection.message,
      candidates: detection.candidates,
      retryable: detection.retryable,
    };
  }

  /**
   * Open the technical task before reading anything.
   *
   * This is not an optimisation, it is a correctness rule. The task list and
   * the topic pane are independent: the list always shows every task, while the
   * pane shows whichever one is currently selected. Reading the pane without
   * opening the right task produced a roadmap titled "Basics of JavaScript"
   * built entirely from the Personal Development task's contents - the exact
   * kind of confidently wrong output this project refuses to produce.
   *
   * Clicking the already-open task is harmless, so it is always done once,
   * guarded so the retry after navigation does not loop.
   */
  /**
   * Brotomap plans technical tasks and nothing else.
   *
   * If the student is looking at Personal Development, Communication or
   * Miscellaneous, silently swapping it for a different task would be
   * presumptuous - they may well be reading it deliberately. Say what is open,
   * say what Brotomap can do with it, and let them decide.
   */
  if (
    options.useTechnical !== true &&
    located.selected !== null &&
    located.selected.classification === 'non-technical'
  ) {
    clearOpened();
    return {
      status: 'failed',
      reason: 'non-technical-task-open',
      message: `"${located.selected.title}" is not a technical task, so there is no roadmap to build from it. The technical task in ${detection.module.title} is "${detection.taskTitle}".`,
      candidates: detection.detection.candidates,
      retryable: false,
    };
  }

  if (located.element !== null && !alreadyOpened(detection.taskTitle)) {
    markOpened(detection.taskTitle);

    if (openTaskCard(located.element)) {
      return {
        status: 'navigating',
        taskTitle: detection.taskTitle,
        message: `Opening "${detection.taskTitle}"…`,
      };
    }
  }

  // Wait for the page to finish rendering before believing what is on it:
  // opening a task and reading straight away caught two topics of six.
  const found = await waitForTopics(doc, EXPANSION_LIMITS);

  if (found.length === 0) {
    clearOpened();
    return {
      status: 'failed',
      reason: 'no-topics-found',
      message: `Opened "${detection.taskTitle}" but found no topics on the page.`,
      retryable: true,
    };
  }

  const declared = declaredTopicCount(doc);
  const budget = newBudget();
  const topics: ExtractedTopic[] = [];
  const restores: Array<() => Promise<void>> = [];

  for (const { index, element } of found) {
    // Re-resolve the linked panel on every read: an accordion creates it when
    // it opens, so a reference captured beforehand would always be empty.
    const read = (): string => parseTopic(element, index, linkedPanels(element)).content;

    const expansion = await expandIfNeeded(element, read, budget);

    if (expansion.restore !== null) {
      restores.push(expansion.restore);
    }

    // Only worth doing once the topic is open: a collapsed block has no
    // truncated text to reveal.
    const revealed = await revealTruncatedText(element, budget);

    if (revealed.length > 0) {
      restores.push(collapseAgain(revealed, budget));
    }

    const parsed = parseTopic(element, index, linkedPanels(element));

    topics.push({
      index,
      title: parsed.title,
      content: parsed.content,
      sections: parsed.sections,
      links: parsed.links,
      attachments: parsed.attachments,
      expansion: expansion.outcome,
      complete: parsed.hasContent,
    });
  }

  // Leave the page as we found it, whatever happened above.
  for (const restore of restores) {
    await restore();
  }

  const warnings = [...detection.detection.warnings];

  if (declared !== undefined && declared !== topics.length) {
    warnings.push(`The page declares ${declared} topics but ${topics.length} were found.`);
  }

  const incomplete = topics.filter((topic) => !topic.complete);

  if (incomplete.length > 0) {
    warnings.push(
      `No content could be read for ${incomplete.length === 1 ? 'topic' : 'topics'} ${incomplete
        .map((topic) => topic.index)
        .join(', ')}.`,
    );
  }

  clearOpened();

  const totalChars = topics.reduce((sum, topic) => sum + topic.content.length, 0);

  const task: ExtractedTechnicalTask = {
    source: 'brototype',
    extractedAt: new Date().toISOString(),
    pageUrl: stripQuery(url),
    module: detection.module,
    task: {
      category: 'technical',
      title: detection.taskTitle,
      ...(declared === undefined ? {} : { declaredTopicCount: declared }),
    },
    topics,
    links: [],
    attachments: [],
    detection: {
      ...detection.detection,
      warnings,
      interactionCount: budget.interactions,
    },
    stats: {
      topicCount: topics.length,
      totalChars,
      truncated: totalChars > MAX_TOTAL_CHARS,
    },
  };

  return { status: 'ok', task };
}

/** The query string carries the student's own record id; it never leaves the page. */
function stripQuery(url: string): string {
  try {
    const parsed = new URL(url);
    return `${parsed.origin}${parsed.pathname}`;
  } catch {
    return url;
  }
}

/** Exported for the diagnostic view. */
export function readableLength(element: Element): number {
  return readText(element).length;
}
