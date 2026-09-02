import { z } from 'zod';
import {
  difficultySchema,
  effortMinutesSchema,
  idSchema,
  knowledgeCategorySchema,
  prioritySchema,
  requirementIdSchema,
  textSchema,
} from './common.js';

/**
 * LAYER 2b — KNOWLEDGE  (AI stages 2 + 3, then code)
 *
 * "What must the student actually know to complete this task?"
 *
 * This is the core intelligence of the product. The map must contain knowledge
 * the portal never mentions — the prerequisites that are the real reason a task
 * is hard. A missing prerequisite is the worst possible failure of this system.
 */

/** Depth in the tree. topic → subtopic → concept, never deeper. */
export const nodeLevelSchema = z.enum(['topic', 'subtopic', 'concept']);
export type NodeLevel = z.infer<typeof nodeLevelSchema>;

/**
 * A resource hint. Deliberately has NO url: models invent plausible links, and a
 * dead link is worse than none. A searchable title is honest.
 */
export const resourceHintSchema = z.object({
  label: textSchema,
  kind: z.enum(['documentation', 'article', 'video', 'exercise']),
});
export type ResourceHint = z.infer<typeof resourceHintSchema>;

export const knowledgeNodeSchema = z.object({
  id: idSchema,
  title: textSchema,
  /** null for a root topic. Must reference an existing node otherwise. */
  parentId: idSchema.nullable(),
  level: nodeLevelSchema,
  category: knowledgeCategorySchema,
  difficulty: difficultySchema,
  summary: textSchema,
  /** One line tying this back to the task. Forces relevance; kills filler. */
  whyItMatters: textSchema,
  /** 'review' when the student plausibly knows it already — surfaced, not dropped. */
  status: z.enum(['learn', 'review']),
  effortMinutes: effortMinutesSchema,
  /** Ids of nodes that must be understood first. Code validates and sorts these. */
  prerequisites: z.array(idSchema),
  /** Traceability back to the source. */
  coversRequirements: z.array(requirementIdSchema),
  coversTopicIndexes: z.array(z.number().int().min(1)),
  resources: z.array(resourceHintSchema),
  /** Assigned by code from category + graph position, not by the model. */
  priority: prioritySchema.optional(),
  /** Assigned by code: distance from a root node. */
  depth: z.number().int().min(0).optional(),
});
export type KnowledgeNode = z.infer<typeof knowledgeNodeSchema>;

/** A prerequisite edge the scheduler removed to break a cycle. Always reported. */
export const brokenEdgeSchema = z.object({
  from: idSchema,
  to: idSchema,
  reason: z.string(),
});
export type BrokenEdge = z.infer<typeof brokenEdgeSchema>;

export const knowledgeMapSchema = z.object({
  nodes: z.array(knowledgeNodeSchema).min(1),
  /**
   * Topological learning order — node ids, first to last.
   * Produced by code (deterministic), never asked of the model.
   */
  sequence: z.array(idSchema),
  brokenEdges: z.array(brokenEdgeSchema),
  totals: z.object({
    nodeCount: z.number().int().min(0),
    effortMinutes: z.number().int().min(0),
    byCategory: z.object({
      explicit: z.number().int().min(0),
      supporting: z.number().int().min(0),
      optional: z.number().int().min(0),
    }),
    byDifficulty: z.object({
      basic: z.number().int().min(0),
      medium: z.number().int().min(0),
      advanced: z.number().int().min(0),
    }),
  }),
});
export type KnowledgeMap = z.infer<typeof knowledgeMapSchema>;
