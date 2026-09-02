import { z } from 'zod';
import { requirementIdSchema, textSchema } from './common.js';

/**
 * LAYER 2a — UNDERSTANDING  (AI stage 1)
 *
 * "What does this technical task actually ask for?"
 *
 * Still close to the source: this stage interprets, it does not yet expand into
 * a curriculum. Requirement ids created here are the backbone of traceability —
 * every R* must reappear in the finished roadmap or validation fails.
 */

export const requirementSchema = z.object({
  /** "R1", "R2", … — stable within one roadmap. */
  id: requirementIdSchema,
  text: textSchema,
  kind: z.enum(['learn', 'build', 'submit', 'other']),
  source: z.enum(['explicit', 'implicit']),
  /** Required when source is 'implicit': why the task implies this. */
  reason: z.string().optional(),
  /** Portal topic indexes this requirement came from. Empty = task-level. */
  fromTopicIndexes: z.array(z.number().int().min(1)),
});
export type Requirement = z.infer<typeof requirementSchema>;

/** The AI's reading of one portal topic — kept alongside the raw extraction. */
export const topicInterpretationSchema = z.object({
  index: z.number().int().min(1),
  title: textSchema,
  /** What this topic is really asking the student to be able to do. */
  interpretation: textSchema,
  /** True when this topic is the week's project rather than a study topic. */
  isProject: z.boolean(),
});
export type TopicInterpretation = z.infer<typeof topicInterpretationSchema>;

export const taskUnderstandingSchema = z.object({
  /** Echoed from extraction so the whole object is self-contained. */
  moduleTitle: z.string(),
  taskTitle: textSchema,
  /** Free-form, discovered from the task — e.g. "frontend state management". */
  domain: z.string(),
  /** Technologies detected in the task text. DATA, discovered per week. */
  stack: z.array(z.string()),
  summary: textSchema,
  learningObjectives: z.array(textSchema),
  requirements: z.array(requirementSchema),
  deliverables: z.array(z.string()),
  topicInterpretations: z.array(topicInterpretationSchema),
  project: z.object({
    /** Never invent one. False when the task contains no project. */
    present: z.boolean(),
    summary: z.string().optional(),
    fromTopicIndexes: z.array(z.number().int().min(1)),
  }),
  /** What a student reaching this module can reasonably be assumed to know. */
  assumedKnowledge: z.array(z.string()),
  /** Genuinely unclear points — surfaced to the student, not guessed away. */
  ambiguities: z.array(z.string()),
});
export type TaskUnderstanding = z.infer<typeof taskUnderstandingSchema>;
