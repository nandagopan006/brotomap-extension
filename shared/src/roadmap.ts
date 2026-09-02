import { z } from 'zod';
import { isoDateSchema } from './common.js';
import { extractedTechnicalTaskSchema } from './extraction.js';
import { knowledgeMapSchema } from './knowledge.js';
import { fiveDayPlanSchema, planOptionsSchema } from './plan.js';
import { practicePlanSchema } from './practice.js';
import { projectPlanSchema } from './project.js';
import { taskUnderstandingSchema } from './understanding.js';
import { validationReportSchema } from './validation.js';

/**
 * THE DELIVERABLE
 *
 * Everything the UI renders and the PDF prints. Self-contained: it carries the
 * original extraction, so a saved roadmap can always be traced back to what was
 * actually on the page that day.
 */

/**
 * Bump whenever prompts, schemas or the scheduler change in a way that would
 * make a cached roadmap wrong. It is part of the cache key.
 */
export const PIPELINE_VERSION = '1.0.0';

export const roadmapMetaSchema = z.object({
  pipelineVersion: z.string(),
  /** sha256 of the extracted task + pipeline version. The cache key. */
  hash: z.string(),
  generatedAt: isoDateSchema,
  /** Milliseconds per pipeline stage. Real measurements, never faked. */
  timings: z.record(z.string(), z.number()),
  /** Stages that failed. Non-empty means the UI must show a degraded state. */
  degradedStages: z.array(z.string()),
  planOptions: planOptionsSchema,
});
export type RoadmapMeta = z.infer<typeof roadmapMetaSchema>;

export const roadmapSchema = z.object({
  meta: roadmapMetaSchema,
  extraction: extractedTechnicalTaskSchema,
  understanding: taskUnderstandingSchema,
  knowledge: knowledgeMapSchema,
  practice: practicePlanSchema,
  /** null when the task genuinely contains no project. */
  project: projectPlanSchema.nullable(),
  plan: fiveDayPlanSchema,
  validation: validationReportSchema,
});
export type Roadmap = z.infer<typeof roadmapSchema>;
