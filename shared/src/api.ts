import { z } from 'zod';
import { extractedTechnicalTaskSchema } from './extraction.js';
import { planOptionsSchema } from './plan.js';
import { roadmapSchema } from './roadmap.js';

/**
 * THE CONTRACT between extension and server.
 *
 * Both sides import these schemas, so a field renamed on the server becomes a
 * compile error in the UI instead of a silently blank section.
 */

// ---------------------------------------------------------------------------
// Pipeline stages — used for real progress reporting (never fake progress)
// ---------------------------------------------------------------------------

export const pipelineStageSchema = z.enum([
  'understand',
  'discover',
  'gap-pass',
  'graph',
  'practice',
  'project',
  'plan',
  'validate',
]);
export type PipelineStage = z.infer<typeof pipelineStageSchema>;

/** Student-facing labels. The UI never invents its own wording for a stage. */
export const STAGE_LABELS: Record<PipelineStage, string> = {
  understand: 'Understanding requirements',
  discover: 'Building knowledge map',
  'gap-pass': 'Finding missing prerequisites',
  graph: 'Ordering prerequisites',
  practice: 'Creating practice plan',
  project: 'Breaking down the project',
  plan: 'Planning 5 days',
  validate: 'Validating roadmap',
};

// ---------------------------------------------------------------------------
// POST /api/roadmap/generate
// ---------------------------------------------------------------------------

export const generateRequestSchema = z.object({
  task: extractedTechnicalTaskSchema,
  options: planOptionsSchema.partial().optional(),
  /** Skip the cache and regenerate. */
  force: z.boolean().optional(),
});
export type GenerateRequest = z.infer<typeof generateRequestSchema>;

export const apiErrorCodeSchema = z.enum([
  'BAD_REQUEST',
  'PAYLOAD_TOO_LARGE',
  'RATE_LIMITED',
  'AI_UNAVAILABLE',
  'AI_RATE_LIMITED',
  'AI_INVALID_OUTPUT',
  'STAGE_FAILED',
  'TIMEOUT',
  'INTERNAL',
]);
export type ApiErrorCode = z.infer<typeof apiErrorCodeSchema>;

export const apiErrorSchema = z.object({
  code: apiErrorCodeSchema,
  /** Safe to display. Never a stack trace, never a prompt, never a key. */
  message: z.string(),
  stage: pipelineStageSchema.optional(),
  retryable: z.boolean(),
});
export type ApiError = z.infer<typeof apiErrorSchema>;

export const generateResponseSchema = z.discriminatedUnion('ok', [
  z.object({ ok: z.literal(true), roadmap: roadmapSchema, cached: z.boolean() }),
  z.object({ ok: z.literal(false), error: apiErrorSchema }),
]);
export type GenerateResponse = z.infer<typeof generateResponseSchema>;

// ---------------------------------------------------------------------------
// Server-sent events — one event per real stage transition
// ---------------------------------------------------------------------------

export const progressEventSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('stage-start'), stage: pipelineStageSchema }),
  z.object({
    type: z.literal('stage-done'),
    stage: pipelineStageSchema,
    ms: z.number(),
    detail: z.string().optional(),
  }),
  z.object({
    type: z.literal('stage-failed'),
    stage: pipelineStageSchema,
    error: apiErrorSchema,
  }),
  z.object({ type: z.literal('result'), roadmap: roadmapSchema, cached: z.boolean() }),
  z.object({ type: z.literal('error'), error: apiErrorSchema }),
]);
export type ProgressEvent = z.infer<typeof progressEventSchema>;

// ---------------------------------------------------------------------------
// GET /api/health
// ---------------------------------------------------------------------------

export const healthResponseSchema = z.object({
  ok: z.literal(true),
  pipelineVersion: z.string(),
  /** Which model is configured. The key itself is never exposed. */
  model: z.string(),
  aiConfigured: z.boolean(),
});
export type HealthResponse = z.infer<typeof healthResponseSchema>;

/** Requests larger than this are rejected. Extracted text only — never page HTML. */
export const MAX_REQUEST_BYTES = 256 * 1024;
