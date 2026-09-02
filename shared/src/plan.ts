import { z } from 'zod';
import { idSchema, textSchema } from './common.js';

/**
 * LAYER 3 — PLANNING  (pure code, no AI)
 *
 * Produced by a deterministic scheduler: topological order + effort bin-packing.
 * Same input always produces the same plan — that property is what makes the
 * whole system debuggable, and what lets us *guarantee* prerequisite order
 * instead of hoping a model respected it.
 */

export const blockKindSchema = z.enum(['learn', 'practice', 'build', 'review', 'checkpoint']);
export type BlockKind = z.infer<typeof blockKindSchema>;

export const planBlockSchema = z.object({
  kind: blockKindSchema,
  title: textSchema,
  minutes: z.number().int().min(5),
  /** Whichever ids this block covers. Empty arrays are normal. */
  topicIds: z.array(idSchema),
  practiceIds: z.array(idSchema),
  featureIds: z.array(idSchema),
  notes: z.string().optional(),
});
export type PlanBlock = z.infer<typeof planBlockSchema>;

/**
 * What a day is for.
 *
 * The week follows a teaching progression rather than an even split of topics:
 * meeting the material, then understanding how it fits together, then using it,
 * then building with it, then closing the gaps. Learning and understanding are
 * different activities, and a plan that runs them together does neither.
 */
export const dayStageSchema = z.enum(['learn', 'understand', 'practice', 'build', 'revise']);
export type DayStage = z.infer<typeof dayStageSchema>;

export const dayPlanSchema = z.object({
  day: z.number().int().min(1).max(5),
  stage: dayStageSchema,
  /** Derived from what actually landed here, not from a fixed template. */
  theme: textSchema,
  focus: textSchema,
  blocks: z.array(planBlockSchema),
  totalMinutes: z.number().int().min(0),
  /** What the student should be able to do by the end of the day. */
  expectedOutcome: textSchema,
  /** How they know it actually happened. */
  endOfDayCheckpoint: textSchema,
});
export type DayPlan = z.infer<typeof dayPlanSchema>;

/** Work that did not fit the week. Reported honestly — never silently dropped. */
export const deferredWorkSchema = z.object({
  topicIds: z.array(idSchema),
  practiceIds: z.array(idSchema),
  reason: z.string(),
});
export type DeferredWork = z.infer<typeof deferredWorkSchema>;

export const fiveDayPlanSchema = z.object({
  days: z.array(dayPlanSchema).length(5),
  plannedMinutes: z.number().int().min(0),
  budgetMinutes: z.number().int().min(0),
  beyondThisWeek: deferredWorkSchema,
});
export type FiveDayPlan = z.infer<typeof fiveDayPlanSchema>;

/** Student-adjustable scheduling inputs. */
export const planOptionsSchema = z.object({
  /** Total study hours available across the 5 days. */
  weeklyHours: z.number().min(5).max(70),
  /** Fraction of each day held back for overrun. 0.15 = 15%. */
  slackRatio: z.number().min(0).max(0.5),
  /** Minutes reserved on day 5 for revision and the final checklist. */
  reviewReserveMinutes: z.number().int().min(0),
});
export type PlanOptions = z.infer<typeof planOptionsSchema>;

export const DEFAULT_PLAN_OPTIONS: PlanOptions = {
  weeklyHours: 25,
  slackRatio: 0.15,
  reviewReserveMinutes: 60,
};
