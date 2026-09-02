/**
 * CATEGORY VOCABULARY — the one file allowed to name task categories.
 *
 * The distinction that makes this legal under Rule 2: these are *category*
 * words, which are part of the portal's permanent structure, not *technology*
 * words, which change every week. "Technical" is how the portal labels a kind
 * of task; "React" is this week's subject. Detection may know the first and
 * must never know the second.
 *
 * When the portal renames a category, this file changes. Nothing else does.
 */

/** Words that mark a task as the technical one. */
export const TECHNICAL_TERMS = ['technical', 'tech task', 'tech'] as const;

/**
 * Categories Brotomap ignores. Used as a hard exclusion, and — more importantly —
 * to identify the technical task by elimination when it carries no label of its
 * own, which is the common case: the other cards say what they are, the
 * technical one just states its subject.
 */
export const NON_TECHNICAL_TERMS = [
  // The live portal's badges are single words - "Personal", not "Personal
  // Development" - while the card titles spell the category out in full. Both
  // forms have to be here.
  'personal',
  'communication',
  'miscellaneous',
  'workout',
  'soft skill',
  'aptitude',
  'mock interview',
  'weekly review',
  'attendance',
  'fees',
] as const;

/**
 * STRUCTURAL PATTERNS — shape, not subject.
 *
 * A technical task is the one that decomposes into numbered topics. That shape
 * is the strongest technology-agnostic signal available, and it survives any
 * rename of the subject.
 */
export const PATTERNS = {
  /** "Topic 1", "Topic  12" */
  topicHeading: /^\s*topic\s*(\d+)\b/i,
  /** "Total Topics: 6", "Total topics 6" */
  topicCount: /total\s+topics?\s*[:\-–]?\s*(\d+)/i,
  /** "Module 29", "Module Task - 29", "Module Task 31" */
  moduleLabel: /\bmodule\s*(?:task)?\s*[-–—:]?\s*(\d+)\b/i,
  /** A route or attribute value that names the category. */
  technicalRoute: /(?:^|[/_\-.])(technical|tech)(?:$|[/_\-.])/i,
} as const;

/**
 * Status and action chips the portal puts beside a task name.
 *
 * Portal vocabulary, like the categories above: permanent structure, not this
 * week's subject. Needed because a task's *name* can be shorter than its status
 * button - "React Module 3" is 14 characters, "View Submission" is 15 - so
 * picking the longest text in a card would name the task after its button.
 */
export const STATUS_TERMS = [
  'verified',
  'submitted',
  'not submitted',
  'view submission',
  'pending',
  're-do',
  'redo',
  'approved',
  'rejected',
  'completed',
  'in review',
  'locked',
  'done',
  'view',
  'open',
  'start',
] as const;

/**
 * True when a piece of text is a chip - a status, an action or a category -
 * rather than the name of anything.
 */
export function isChipLabel(text: string): boolean {
  const lower = text.trim().toLowerCase();

  if (lower.length === 0 || lower.length > 30) {
    return false;
  }

  return (
    STATUS_TERMS.some((term) => term === lower) ||
    TECHNICAL_TERMS.some((term) => term === lower) ||
    NON_TECHNICAL_TERMS.some((term) => term === lower)
  );
}

/**
 * Headings that describe the page furniture rather than the task.
 * Skipped when looking for the task's own title.
 */
export const GENERIC_HEADINGS = [
  'task overview',
  'overview',
  'topics',
  'tasks',
  'task',
  'dashboard',
  'modules',
  'module',
  'profile',
  'menu',
  'details',
  'description',
] as const;

/** Attribute names worth reading for a category hint. */
export const CATEGORY_ATTRIBUTE_HINTS = [
  'data-category',
  'data-type',
  'data-task-type',
  'data-task-category',
  'aria-label',
  'title',
  'href',
] as const;

/**
 * True when the text is a module label and nothing else ("Module 29").
 *
 * The distinction matters twice: a task card titled "Communication Task -
 * Module 29" is not a module item, and a task titled "<subject> Module 3" is
 * not the page's module heading. Testing for *containment* would break both.
 */
export function isModuleLabelOnly(text: string): boolean {
  if (!PATTERNS.moduleLabel.test(text)) {
    return false;
  }
  return text.replace(PATTERNS.moduleLabel, '').replace(/[\s\-–—:|]/g, '').length === 0;
}

export function matchesAny(text: string, terms: readonly string[]): string | null {
  const haystack = text.toLowerCase();
  return terms.find((term) => haystack.includes(term)) ?? null;
}
