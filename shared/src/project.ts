import { z } from 'zod';
import { effortMinutesSchema, idSchema, requirementIdSchema, textSchema } from './common.js';

/**
 * LAYER 2d — PROJECT  (AI stage 5)
 *
 * Only runs when the extracted task actually contains a project.
 * If there is no project, this whole object is null. Never invent one.
 */

/** Where a feature sits in the build lifecycle. */
export const projectPhaseSchema = z.enum([
  'setup',
  'architecture',
  'implementation',
  'integration',
  'testing',
  'debugging',
  'completion',
]);
export type ProjectPhase = z.infer<typeof projectPhaseSchema>;

export const projectFeatureSchema = z.object({
  id: idSchema,
  title: textSchema,
  description: textSchema,
  phase: projectPhaseSchema,
  /**
   * Knowledge nodes required before this can be built.
   * The scheduler uses these to guarantee a feature is never placed on a day
   * before the student has learned what it needs.
   */
  requiredTopicIds: z.array(idSchema),
  coversRequirements: z.array(requirementIdSchema),
  effortMinutes: effortMinutesSchema,
  /** 1-based build sequence. */
  buildOrder: z.number().int().min(1),
});
export type ProjectFeature = z.infer<typeof projectFeatureSchema>;

export const projectMilestoneSchema = z.object({
  day: z.number().int().min(1).max(5),
  achievement: textSchema,
});
export type ProjectMilestone = z.infer<typeof projectMilestoneSchema>;

export const projectPlanSchema = z.object({
  name: textSchema,
  overview: textSchema,
  /** Requirements taken verbatim-ish from the task, before decomposition. */
  requirements: z.array(textSchema),
  features: z.array(projectFeatureSchema).min(1),
  milestones: z.array(projectMilestoneSchema),
  definitionOfDone: z.array(textSchema),
  submissionChecklist: z.array(textSchema),
  totalEffortMinutes: z.number().int().min(0),
});
export type ProjectPlan = z.infer<typeof projectPlanSchema>;
