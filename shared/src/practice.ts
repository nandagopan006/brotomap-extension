import { z } from 'zod';
import { difficultySchema, effortMinutesSchema, idSchema, textSchema } from './common.js';

/**
 * LAYER 2c — PRACTICE  (AI stage 4)
 *
 * Practice exists so knowledge survives contact with a keyboard.
 * It must progress simple → intermediate → practical, and every item must be
 * something a student can actually sit down and do. No filler.
 */

export const practiceKindSchema = z.enum([
  'drill', // 5–20 min, mechanical repetition
  'exercise', // 30–60 min, applied
  'question', // recall / explanation check
  'debug', // fix a described broken behaviour
  'challenge', // stretch application
  'checkpoint', // "you can do X without looking it up"
]);
export type PracticeKind = z.infer<typeof practiceKindSchema>;

export const practiceItemSchema = z.object({
  id: idSchema,
  kind: practiceKindSchema,
  title: textSchema,
  /** Concrete enough to start without asking a follow-up question. */
  description: textSchema,
  /** Knowledge nodes this practises. Must all exist in the map. */
  topicIds: z.array(idSchema).min(1),
  difficulty: difficultySchema,
  effortMinutes: effortMinutesSchema,
  /** How the student knows they are done. */
  successCriteria: z.array(textSchema),
  commonMistakes: z.array(z.string()),
});
export type PracticeItem = z.infer<typeof practiceItemSchema>;

export const practicePlanSchema = z.object({
  items: z.array(practiceItemSchema),
  totalEffortMinutes: z.number().int().min(0),
});
export type PracticePlan = z.infer<typeof practicePlanSchema>;
