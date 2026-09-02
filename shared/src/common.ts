import { z } from 'zod';

/**
 * Small vocabularies reused across every layer.
 *
 * Rule: these describe *structure and grading*, never a technology.
 * No file in this package may contain a technology name (React, Node, Mongo…)
 * — those are always runtime data, never code.
 */

/** How hard a piece of knowledge is for a student meeting it for the first time. */
export const difficultySchema = z.enum(['basic', 'medium', 'advanced']);
export type Difficulty = z.infer<typeof difficultySchema>;

/**
 * The three levels of knowledge discovery.
 * - explicit   : named by the portal task itself
 * - supporting : not named, but required to understand or complete the task
 * - optional   : useful depth, not needed for this week
 */
export const knowledgeCategorySchema = z.enum(['explicit', 'supporting', 'optional']);
export type KnowledgeCategory = z.infer<typeof knowledgeCategorySchema>;

/**
 * How necessary a topic is for making progress - not how hard it is.
 *
 *   P0  cannot be skipped: without it the topics that follow make no sense
 *   P1  needed to work with the technology in practice
 *   P2  supports understanding or implementation, not immediately essential
 *   P3  advanced, specialised or postponable
 *
 * Assigned by code from category and position in the dependency graph, because
 * "what depends on this" is a fact about the graph and not a matter of opinion.
 */
export const prioritySchema = z.enum(['P0', 'P1', 'P2', 'P3']);
export type Priority = z.infer<typeof prioritySchema>;

/** What each level means, for anywhere it has to be explained. */
export const PRIORITY_LABELS: Record<Priority, string> = {
  P0: 'must learn',
  P1: 'important',
  P2: 'supporting',
  P3: 'optional',
};

/** How sure the extractor is about what it found. */
export const confidenceSchema = z.enum(['high', 'medium', 'low']);
export type Confidence = z.infer<typeof confidenceSchema>;

/** Non-empty trimmed text. Used everywhere a blank string would be a bug. */
export const textSchema = z.string().trim().min(1);

/** Effort in minutes: 15-minute granularity, capped so nothing is unschedulable. */
export const effortMinutesSchema = z.number().int().min(5).max(240);

/** Stable, human-readable identifier, e.g. "t-state-management". */
export const idSchema = z
  .string()
  .trim()
  .min(1)
  .max(80)
  .regex(/^[a-z0-9][a-z0-9-]*$/, 'ids are lowercase kebab-case');

/** ISO-8601 timestamp. Kept as a plain string so it survives JSON round-trips. */
export const isoDateSchema = z.string().min(1);

/**
 * A task requirement id: "R1", "R2", …
 *
 * Defined once and reused everywhere a requirement is referenced, so a typo in
 * a `coversRequirements` array fails validation instead of quietly producing a
 * requirement that the coverage check can never match.
 */
export const requirementIdSchema = z.string().regex(/^R\d+$/, 'requirement ids look like "R1"');
