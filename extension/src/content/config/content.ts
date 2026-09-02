/**
 * CONTENT VOCABULARY — what to read, what to leave alone, what never to touch.
 *
 * Portal structure, not weekly subject: safe under Rule 2, same as the category
 * taxonomy.
 */

/**
 * Where the task's instructions end and the student's own work begins.
 *
 * Everything from here on is the student's answer, their attachments and their
 * submission - their work, not the task. It must never reach the AI: a roadmap
 * built partly from an answer already given would teach what is already done.
 */
export const RESPONSE_MARKERS = [
  'your response',
  'your submission',
  'your answer',
  'add attachments',
  'attachments added',
  'submit',
  'edit response',
] as const;

/**
 * The portal truncates long instructions and hides the rest behind "Read more".
 * That text is part of the task, so it is revealed before reading - otherwise
 * the AI plans a week around half a sentence.
 */
export const MORE_CONTROL = /^(read|show|view)\s+more$/i;

/**
 * Lines that are controls or chrome, not task content.
 * An accordion's own button sits in the same block as the text it opens, so
 * without this the topic would be titled "expand".
 */
export const CONTROL_LINE = /^(expand|collapse|show (more|less)|read more|view|open|close|next|previous|back)$/i;

/** A topic title as the portal numbers them: "1). State Management with Redux" */
export const NUMBERED_TITLE = /^(\d+)\)\.?\s+(.+)$/;

/** "1 attachment added", "3 attachments added" */
export const ATTACHMENT_COUNT = /(\d+)\s+attachments?\s+added/i;

/**
 * Controls that must NEVER be clicked.
 *
 * Brotomap reads and plans. It does not act for the student: no submitting, no
 * deleting, no uploading. A single wrong click here is not a bug, it is damage
 * to somebody's coursework.
 */
export const FORBIDDEN_CONTROL = /\b(submit|send|delete|remove|discard|clear|finish|complete|approve|reject|upload|save|edit|log ?out|sign ?out|pay|purchase|confirm)\b/i;

/** Attributes and roles that mark a control as an expander. */
export const EXPANDER_SELECTORS = [
  '[aria-expanded]',
  '[data-expanded]',
  'button[aria-controls]',
  '[role="button"][aria-controls]',
] as const;

/** Limits on how much the page may be touched, ever. */
export const EXPANSION_LIMITS = {
  /** Total clicks allowed in one extraction. */
  maxInteractions: 40,
  /** How long to keep checking for content after the first toggle. */
  waitMs: 1200,
  /** Shorter wait for the second and third attempt: an inert control stays inert. */
  retryWaitMs: 600,
  /** How often to re-read while waiting. */
  pollMs: 100,
  /** How many "Read more" controls may be revealed in one topic. */
  maxMoreControls: 2,
  /** How many different controls may be tried on one topic. */
  maxCandidates: 3,
  /**
   * Total time expansion may spend across the whole task.
   *
   * Without this, six unreadable topics times three candidates times a full
   * wait each is a minute of the student staring at a spinner. Past the
   * deadline the remaining topics are reported unread, which is honest and
   * fast, rather than read eventually and far too late.
   */
  totalMs: 12_000,
  /** Pause between topics so the page is never hammered. */
  pauseMs: 50,

  /**
   * How long to wait for the page to finish rendering its topics.
   *
   * The portal states how many topics a task has, and after opening one the
   * rest arrive over the following second or two. Reading immediately caught
   * two of six - a roadmap for a third of the task, indistinguishable on screen
   * from a roadmap for a small task.
   */
  settleMs: 6000,
  /** How often to look while waiting for them. */
  settlePollMs: 250,
  /**
   * A topic counts as read when it yields any content at all.
   *
   * A character threshold was worse than useless: real topics are sometimes two
   * short lines ("A) Observables / B) Reactions"), and treating those as unread
   * made Brotomap click on blocks it had already read perfectly well. An empty
   * block is the only one worth touching the page for.
   */
  minContentChars: 1,
} as const;
