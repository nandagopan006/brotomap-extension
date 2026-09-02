import { z } from 'zod';
import {
  practiceItemSchema,
  type KnowledgeMap,
  type PracticePlan,
  type TaskUnderstanding,
} from '@brotomap/shared';
import type { AiProvider } from '../provider.js';
import { PRACTICE_SYSTEM, buildPracticePrompt } from '../prompts/practice.js';
import type { StageResult } from './understand.js';

/**
 * Stage 3: what to actually do, rather than what to read about.
 *
 * Kept to one call. On a small per-minute budget every extra call is a wait,
 * and practice is the stage that degrades most gracefully: fewer, better
 * exercises are worth more than an exercise per topic.
 */

const MAX_ITEMS = 10;

/** Format is forgiven, meaning is not - as everywhere else the model is read. */
const answerSchema = z.object({
  items: z.array(
    practiceItemSchema.extend({
      id: z.string().min(1),
      topicIds: z.array(z.string()),
      effortMinutes: z.number(),
    }),
  ),
});

export async function runPractice(
  provider: AiProvider,
  understanding: TaskUnderstanding,
  knowledge: KnowledgeMap,
): Promise<StageResult<PracticePlan>> {
  const known = new Set(knowledge.nodes.map((node) => node.id));

  const result = await provider.complete({
    system: PRACTICE_SYSTEM,
    user: buildPracticePrompt(understanding, knowledge, MAX_ITEMS),
    schema: answerSchema,
    schemaName: 'PracticeItems',
    temperature: 0.5,
    maxTokens: 3000,
    timeoutMs: 120_000,
    model: 'reasoning',
  });

  const items = result.value.items
    .map((item) => ({
      ...item,
      id: slug(item.id, item.title),
      // An exercise for a topic that is not in the plan cannot be scheduled,
      // and an exercise that is never scheduled is one nobody does.
      topicIds: item.topicIds.map(slugOnly).filter((id) => known.has(id)),
      effortMinutes: Math.min(180, Math.max(5, Math.round(item.effortMinutes))),
    }))
    .filter((item) => item.topicIds.length > 0);

  return {
    value: { items, totalEffortMinutes: items.reduce((sum, item) => sum + item.effortMinutes, 0) },
    ms: result.ms,
    calls: result.calls,
    repaired: result.repaired,
  };
}

function slugOnly(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function slug(id: string, title: string): string {
  return slugOnly(id) || slugOnly(title) || 'p-practice';
}
