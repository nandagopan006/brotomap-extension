import { z } from 'zod';
import { apiErrorSchema, pipelineStageSchema } from './api.js';
import { knowledgeMapSchema } from './knowledge.js';
import { fiveDayPlanSchema } from './plan.js';
import { practicePlanSchema } from './practice.js';
import { taskUnderstandingSchema } from './understanding.js';
import { detectionResultSchema, extractionOutcomeSchema } from './extraction.js';
import { planOptionsSchema } from './plan.js';
import { roadmapSchema } from './roadmap.js';

/**
 * Messages passed inside the extension:
 *   popup  ⇄  service worker  ⇄  content script
 *   roadmap tab ⇄ service worker
 *
 * Typed as a discriminated union so a handler that forgets a case is a compile
 * error, not a message that silently disappears.
 */

export const extensionMessageSchema = z.discriminatedUnion('type', [
  /**
   * Liveness check. The content script is injected on demand, so the worker
   * asks before injecting: a PONG means it is already there and injecting again
   * would register a second listener and produce duplicate replies.
   */
  z.object({ type: z.literal('PING') }),
  z.object({ type: z.literal('PONG') }),

  /**
   * popup → worker → content script: which technical task is on this page?
   * Detection only - fast, reads no topic content, touches nothing.
   */
  z.object({ type: z.literal('PROBE') }),
  z.object({ type: z.literal('PROBE_RESULT'), result: detectionResultSchema }),

  /**
   * popup → worker → content script: describe what the detector saw.
   * Used when detection fails, so a failure can be reported without anyone
   * having to capture and hand over the page.
   */
  z.object({ type: z.literal('DIAGNOSE') }),
  z.object({ type: z.literal('DIAGNOSTIC'), report: z.string() }),

  /**
   * roadmap tab → worker → content script: do the full extraction.
   *
   * `useTechnical` is the student answering "yes, switch to the technical task"
   * after being told the one they had open is not one Brotomap plans for.
   */
  z.object({ type: z.literal('EXTRACT'), useTechnical: z.boolean().optional() }),
  z.object({ type: z.literal('EXTRACT_RESULT'), outcome: extractionOutcomeSchema }),

  /** popup → worker: the one click. */
  z.object({ type: z.literal('GENERATE'), options: planOptionsSchema.partial().optional() }),

  /**
   * popup → worker: read the task and run the AI pipeline.
   *
   * The worker owns this rather than the popup, because a popup closes the
   * moment the student clicks anywhere else and a pipeline run takes a minute
   * on a free tier. Losing it to a stray click would be unforgivable.
   */
  z.object({ type: z.literal('ANALYSE'), force: z.boolean().optional() }),

  /**
   * worker → offscreen document: there is a task waiting in storage.
   *
   * A nudge, not a delivery. Sending the task itself raced the offscreen
   * document's own start-up: chrome.offscreen.createDocument resolves before
   * the page's script has registered a listener, so the message arrived at
   * nothing and the run failed before it began. The task is handed over through
   * storage, which does not care who is ready when.
   */
  z.object({ type: z.literal('RUN_PIPELINE') }),

  /** popup → worker: open the printable full-page view. */
  z.object({ type: z.literal('OPEN_FULL_VIEW') }),

  /**
   * Generic acknowledgement.
   *
   * Chrome rejects a sendMessage promise when a listener handles a message but
   * never responds ("the message port closed before a response was received"),
   * so every handled message must reply with something.
   */
  z.object({ type: z.literal('ACK'), detail: z.string().optional() }),

  /** worker/tab → any listener: real pipeline progress. */
  z.object({ type: z.literal('PROGRESS'), stage: pipelineStageSchema, status: z.string() }),
  z.object({ type: z.literal('RESULT'), roadmap: roadmapSchema }),
  z.object({ type: z.literal('FAILED'), error: apiErrorSchema }),
]);
export type ExtensionMessage = z.infer<typeof extensionMessageSchema>;

/**
 * What the pipeline is doing, kept where both the popup and the page can see it.
 *
 * A popup is not a place to hold state: it is destroyed and recreated every time
 * it opens. The run belongs to the worker, and this is how anyone else finds out
 * how it went.
 */
export const analysisStateSchema = z.discriminatedUnion('status', [
  z.object({ status: z.literal('idle') }),
  z.object({
    status: z.literal('running'),
    startedAt: z.number(),
    detail: z.string(),
    /**
     * The server-side ticket.
     *
     * Present once the work has been handed over, which is what makes a run
     * survivable: whoever opens the popup next asks the server how the ticket
     * is doing, rather than needing to have been there all along.
     */
    jobId: z.string().optional(),
    moduleTitle: z.string().optional(),
    taskTitle: z.string().optional(),
    topicsRead: z.number().int().min(0).optional(),
    topicsDeclared: z.number().int().min(0).optional(),
    warnings: z.array(z.string()).optional(),
  }),
  z.object({
    status: z.literal('done'),
    finishedAt: z.number(),
    moduleTitle: z.string(),
    taskTitle: z.string(),
    understanding: taskUnderstandingSchema,
    knowledge: knowledgeMapSchema,
    practice: practicePlanSchema,
    plan: fiveDayPlanSchema,
    cached: z.boolean(),
    ms: z.number(),
    /**
     * How much of the portal was actually read.
     *
     * Carried through to the UI because a thin roadmap has two very different
     * causes - a small task, or extraction that missed most of it - and without
     * this number nobody can tell which. A roadmap built from two of five
     * topics looks exactly like a roadmap for a two-topic task.
     */
    topicsRead: z.number().int().min(0),
    topicsDeclared: z.number().int().min(0).optional(),
    /** Anything the extractor could not do cleanly. Shown, never swallowed. */
    warnings: z.array(z.string()),
  }),
  z.object({
    status: z.literal('failed'),
    code: z.string(),
    message: z.string(),
    retryable: z.boolean(),
  }),
]);
export type AnalysisState = z.infer<typeof analysisStateSchema>;

/** Keys used in chrome.storage.local. Centralised so nothing collides. */
export const STORAGE_KEYS = {
  runState: 'brotomap:runState',
  settings: 'brotomap:settings',
  history: 'brotomap:history',
  /** The pipeline's current state, written by whoever is running it. */
  analysis: 'brotomap:analysis',
  /** A task waiting to be picked up. Claimed by removing it, so it runs once. */
  pendingTask: 'brotomap:pendingTask',
  /** Per-roadmap entries are `brotomap:roadmap:<hash>`. */
  roadmapPrefix: 'brotomap:roadmap:',
} as const;

export const settingsSchema = z.object({
  apiBaseUrl: z.string(),
  planOptions: planOptionsSchema,
});
export type Settings = z.infer<typeof settingsSchema>;

export const historyEntrySchema = z.object({
  hash: z.string(),
  moduleTitle: z.string(),
  taskTitle: z.string(),
  generatedAt: z.string(),
});
export type HistoryEntry = z.infer<typeof historyEntrySchema>;

/** How many roadmaps we keep locally. No database, by design. */
export const HISTORY_LIMIT = 20;
