import { z } from 'zod';
import { confidenceSchema, isoDateSchema, textSchema } from './common.js';

/**
 * LAYER 1 — EXTRACTION
 *
 * "What is on the Brototype page right now?"
 *
 * Produced entirely by the content script. No AI, no network. Everything here
 * is observed fact about the page; nothing is inferred about the subject matter.
 */

// ---------------------------------------------------------------------------
// Pieces of a topic
// ---------------------------------------------------------------------------

export const extractedLinkSchema = z.object({
  label: z.string(),
  url: z.string(),
  kind: z.enum(['reference', 'resource', 'submission', 'unknown']),
});
export type ExtractedLink = z.infer<typeof extractedLinkSchema>;

export const extractedAttachmentSchema = z.object({
  name: z.string(),
  url: z.string().optional(),
  mimeType: z.string().optional(),
  /** False when the file exists but its contents could not be read from the page. */
  accessible: z.boolean(),
});
export type ExtractedAttachment = z.infer<typeof extractedAttachmentSchema>;

/**
 * A labelled block inside a topic. Keeping these separate (instead of one text
 * blob) is what lets the AI tell an instruction apart from an example.
 */
export const extractedSectionSchema = z.object({
  heading: z.string().optional(),
  kind: z.enum([
    'description',
    'instructions',
    'requirements',
    'questions',
    'examples',
    'project',
    'submission',
    'other',
  ]),
  content: z.string(),
  /** Bullet or numbered items, kept in source order when the block is a list. */
  items: z.array(z.string()).optional(),
});
export type ExtractedSection = z.infer<typeof extractedSectionSchema>;

/** How the topic's content became readable. Recorded for debugging and safety audit. */
export const expansionOutcomeSchema = z.enum([
  'already-visible', // was open on arrival
  'hidden-in-dom', // present but CSS-hidden — read without any click
  'expanded-by-us', // we toggled it, then restored the original state
  'unavailable', // could not be read; content is partial
]);
export type ExpansionOutcome = z.infer<typeof expansionOutcomeSchema>;

// ---------------------------------------------------------------------------
// Topic
// ---------------------------------------------------------------------------

export const extractedTopicSchema = z.object({
  /** 1-based position on the page. Source order is meaningful and must survive. */
  index: z.number().int().min(1),
  /** Portal's own id when one is exposed in the DOM. */
  sourceId: z.string().optional(),
  title: textSchema,
  /** Full cleaned text of the topic, structure preserved (headings, lists). */
  content: z.string(),
  sections: z.array(extractedSectionSchema),
  links: z.array(extractedLinkSchema),
  attachments: z.array(extractedAttachmentSchema),
  expansion: expansionOutcomeSchema,
  /** False when expansion failed or content looks truncated. Never hidden from the user. */
  complete: z.boolean(),
});
export type ExtractedTopic = z.infer<typeof extractedTopicSchema>;

// ---------------------------------------------------------------------------
// Module + task identification
// ---------------------------------------------------------------------------

/** The module the student is currently in. Title and number are DATA, never selectors. */
export const moduleContextSchema = z.object({
  sourceId: z.string().optional(),
  title: textSchema,
  /** True when this is the module currently selected in the portal UI. */
  isCurrent: z.boolean(),
});
export type ModuleContext = z.infer<typeof moduleContextSchema>;

/**
 * Which signal identified the technical task.
 * Ordered strongest → weakest; see docs/02-architecture.md.
 */
export const detectionSignalSchema = z.enum([
  'category-attribute', // data-* / aria / route segment naming the category
  'category-label', // a visible badge or chip naming the category
  'structure-signature', // the topic-list shape unique to technical tasks
  'category-exclusion', // everything else matched a known non-technical category
  'user-selection', // student chose it from the discovered candidates
]);
export type DetectionSignal = z.infer<typeof detectionSignalSchema>;

/**
 * Every task card discovered in the current module, with how it was classified.
 * Kept in the payload so a wrong pick is diagnosable, and so the manual
 * fallback can offer a real list instead of asking the student to hunt.
 */
export const taskCandidateSchema = z.object({
  sourceId: z.string().optional(),
  title: z.string(),
  /** Category text as shown by the portal, when any is exposed. */
  categoryLabel: z.string().optional(),
  classification: z.enum(['technical', 'non-technical', 'unknown']),
  /** 0..1 — the classifier's confidence for this card. */
  score: z.number().min(0).max(1),
  matchedSignals: z.array(detectionSignalSchema),
});
export type TaskCandidate = z.infer<typeof taskCandidateSchema>;

export const detectionReportSchema = z.object({
  confidence: confidenceSchema,
  score: z.number().min(0).max(1),
  matchedSignals: z.array(detectionSignalSchema),
  candidates: z.array(taskCandidateSchema),
  /** Non-fatal problems: declared topic count mismatch, a topic that would not expand… */
  warnings: z.array(z.string()),
  /** How many page interactions the extractor performed. Expected to be 0 in the common case. */
  interactionCount: z.number().int().min(0),
});
export type DetectionReport = z.infer<typeof detectionReportSchema>;

// ---------------------------------------------------------------------------
// The extraction result
// ---------------------------------------------------------------------------

export const extractedTechnicalTaskSchema = z.object({
  source: z.literal('brototype'),
  extractedAt: isoDateSchema,
  pageUrl: z.string(),
  module: moduleContextSchema,
  task: z.object({
    sourceId: z.string().optional(),
    /** Always 'technical'. Non-technical categories never reach this layer. */
    category: z.literal('technical'),
    /** Read dynamically from the page. NEVER used as a detection selector. */
    title: textSchema,
    description: z.string().optional(),
    /** The count the page itself declares ("Total Topics: 6"), when present. */
    declaredTopicCount: z.number().int().min(0).optional(),
  }),
  topics: z.array(extractedTopicSchema).min(1),
  /** Links/attachments belonging to the task as a whole rather than one topic. */
  links: z.array(extractedLinkSchema),
  attachments: z.array(extractedAttachmentSchema),
  detection: detectionReportSchema,
  stats: z.object({
    topicCount: z.number().int().min(0),
    totalChars: z.number().int().min(0),
    truncated: z.boolean(),
  }),
});
export type ExtractedTechnicalTask = z.infer<typeof extractedTechnicalTaskSchema>;

// ---------------------------------------------------------------------------
// Outcome — extraction is allowed to fail, and must say so precisely
// ---------------------------------------------------------------------------

export const extractionFailureReasonSchema = z.enum([
  'not-on-portal',
  'page-loading-timeout',
  'module-not-found',
  'no-tasks-found',
  'technical-task-not-found',
  'technical-task-ambiguous', // 2+ plausible candidates — we refuse to guess
  'non-technical-task-open', // the student is looking at a task Brotomap does not plan
  'task-page-open-failed',
  'no-topics-found',
  'extraction-failed',
]);
export type ExtractionFailureReason = z.infer<typeof extractionFailureReasonSchema>;

/**
 * The result of detection alone — before any topic content is read.
 *
 * This is what the popup shows the moment it opens: which module, which
 * technical task, how sure we are. Extraction (Phase 4) then builds on it.
 */
export const detectionResultSchema = z.discriminatedUnion('status', [
  z.object({
    status: z.literal('ok'),
    module: moduleContextSchema,
    /** Read from the page. Data, never a selector. */
    taskTitle: textSchema,
    detection: detectionReportSchema,
  }),
  z.object({
    status: z.literal('failed'),
    reason: extractionFailureReasonSchema,
    message: z.string(),
    /** Everything that was considered, so the UI can offer a real choice. */
    candidates: z.array(taskCandidateSchema),
    retryable: z.boolean(),
  }),
]);
export type DetectionResult = z.infer<typeof detectionResultSchema>;

export const extractionOutcomeSchema = z.discriminatedUnion('status', [
  z.object({ status: z.literal('ok'), task: extractedTechnicalTaskSchema }),
  /**
   * The technical task was found on a list and opened; the page is loading.
   * The caller waits for it to settle and asks again. Reported rather than
   * hidden, because navigating the student's tab is a visible thing to do.
   */
  z.object({
    status: z.literal('navigating'),
    taskTitle: textSchema,
    message: z.string(),
  }),
  z.object({
    status: z.literal('failed'),
    reason: extractionFailureReasonSchema,
    /** Safe to show a student. Never a stack trace. */
    message: z.string(),
    /** Present for 'ambiguous' / 'not-found' so the UI can offer a manual choice. */
    candidates: z.array(taskCandidateSchema).optional(),
    retryable: z.boolean(),
  }),
]);
export type ExtractionOutcome = z.infer<typeof extractionOutcomeSchema>;
