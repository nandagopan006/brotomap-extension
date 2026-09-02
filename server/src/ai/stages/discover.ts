import { z } from 'zod';
import {
  knowledgeNodeSchema,
  type KnowledgeMap,
  type KnowledgeNode,
  type TaskUnderstanding,
} from '@brotomap/shared';
import type { AiProvider } from '../provider.js';
import { DISCOVER_SYSTEM, buildDiscoverPrompt } from '../prompts/discover.js';
import { GAPS_SYSTEM, buildGapsPrompt } from '../prompts/gaps.js';
import { buildGraph, promoteRequiredPrerequisites } from '../../planner/graph.js';
import { sanitiseNodes, type LooseNode } from '../sanitise.js';
import type { StageResult } from './understand.js';

/**
 * STAGE 2 — the knowledge map.
 *
 * Two calls and then arithmetic:
 *   discover  - what must be understood, including what the task never said
 *   gap pass  - what the first answer missed
 *   graph     - ordering, cycles and priorities, in code
 *
 * The split is the point. Producing a map and auditing one are different jobs,
 * and a model doing both at once does neither well.
 */

/**
 * The model is asked for nodes only. Everything derived - the sequence, the
 * depths, the priorities, the totals - is computed here, because those are
 * facts about the graph rather than opinions about the subject.
 */
/**
 * Deliberately permissive about format, strict about meaning.
 *
 * ids, parent links and prerequisites arrive as plain strings rather than being
 * held to our kebab-case convention, because a whole map was once thrown away
 * over two capital letters. Format is something we can fix; a missing title is
 * not. Everything is tidied and then validated properly downstream.
 */
const looseNodeSchema = knowledgeNodeSchema
  .omit({ priority: true, depth: true, resources: true })
  .extend({
    id: z.string().min(1),
    parentId: z.string().nullable(),
    prerequisites: z.array(z.string()),
    coversRequirements: z.array(z.string()),
    effortMinutes: z.number(),
    title: z.string(),
    summary: z.string(),
    whyItMatters: z.string(),
  });

const answerSchema = z.object({ nodes: z.array(looseNodeSchema).min(1) });

export interface DiscoverResult extends StageResult<KnowledgeMap> {
  /** Nodes the gap pass added. The clearest measure of whether it earned its call. */
  gapsFound: number;
  /** Cycles broken, dangling references dropped, duplicates removed. */
  repairs: string[];
}

/**
 * How many portal topics one call covers.
 *
 * Not an arbitrary number: a free tier allows a few thousand tokens a minute,
 * and a map of forty nodes does not fit in one answer of that size. Asking for
 * it anyway got a map truncated to whatever fitted - fifteen nodes and half the
 * subject missing - which is worse than asking twice.
 *
 * Splitting also improves the answers. A call responsible for two topics looks
 * underneath them properly; a call responsible for all five summarises.
 */
const TOPICS_PER_CALL = 2;

/** Nodes to aim for per call, so the total lands near a week's worth. */
const NODES_PER_CALL = 22;

export async function runDiscover(
  provider: AiProvider,
  understanding: TaskUnderstanding,
): Promise<DiscoverResult> {
  const started = Date.now();
  const chunks = chunkTopics(understanding, TOPICS_PER_CALL);

  let discovered: KnowledgeNode[] = [];
  let calls = 0;
  let repaired = false;
  const fixes: string[] = [];
  const failures: string[] = [];
  /**
   * The first real error, kept as it was thrown.
   *
   * Wrapping it in a new Error lost its type, so a rate limit - a known,
   * temporary, explainable condition with a clear instruction attached -
   * reached the student as "something went wrong on the server".
   */
  let firstError: unknown = null;

  for (const chunk of chunks) {
    try {
      await discoverChunk(chunk);
    } catch (error) {
      // One chunk failing should cost that chunk, not the map. A partial map
      // covering four topics is worth having; nothing at all is not.
      firstError ??= error;
      failures.push(
        `Could not map topics ${chunk.join(', ')}: ${error instanceof Error ? error.message : 'unknown error'}`,
      );
    }
  }

  async function discoverChunk(chunk: number[]): Promise<void> {
    const result = await provider.complete({
      system: DISCOVER_SYSTEM,
      user: buildDiscoverPrompt(
        understanding,
        NODES_PER_CALL,
        chunk,
        discovered.map((node) => ({ id: node.id, title: node.title })),
      ),
      schema: answerSchema,
      schemaName: 'KnowledgeNodes',
      // Higher than stage 1: this stage needs breadth, and a map that only ever
      // states the obvious is the failure mode here.
      temperature: 0.4,
      maxTokens: 4000,
      // Long enough to sit out a per-minute window rather than failing while it
      // is still open.
      timeoutMs: 120_000,
      model: 'reasoning',
    });

    calls += 1;
    repaired = repaired || result.repaired;

    // resources is not asked for: nothing renders it yet, and every field costs
    // tokens twice - describing it and filling it in - which on a small budget
    // is nodes not discovered.
    const cleaned = sanitiseNodes(
      result.value.nodes.map((node) => ({ ...node, resources: [] })) as LooseNode[],
    );

    fixes.push(...cleaned.fixes);
    discovered = mergeNew(discovered, cleaned.nodes);
  }

  if (discovered.length === 0) {
    // Rethrown as it came, so the reason survives all the way to the student.
    throw firstError ?? new Error('The knowledge map came back empty.');
  }

  const gaps = await findGaps(provider, understanding, discovered);
  const merged = mergeNew(discovered, gaps);
  const { map, repairs } = buildGraph(merged);

  return {
    value: promoteRequiredPrerequisites(map),
    ms: Date.now() - started,
    calls: calls + 1,
    repaired,
    gapsFound: merged.length - discovered.length,
    repairs: [...repairs, ...fixes, ...failures],
  };
}

/**
 * Groups the portal's topics into calls.
 *
 * A task with no topic interpretations still gets one call covering everything,
 * because a map of nothing is not an acceptable answer to a task that exists.
 */
function chunkTopics(understanding: TaskUnderstanding, size: number): number[][] {
  const indexes = understanding.topicInterpretations.map((topic) => topic.index);

  if (indexes.length === 0) {
    return [[]];
  }

  const chunks: number[][] = [];

  for (let start = 0; start < indexes.length; start += size) {
    chunks.push(indexes.slice(start, start + size));
  }

  return chunks;
}

/**
 * The gap pass is allowed to fail without taking the run with it.
 *
 * A map without its second look is worse, not broken - and losing a good first
 * answer because the audit of it timed out would be a poor trade.
 */
async function findGaps(
  provider: AiProvider,
  understanding: TaskUnderstanding,
  nodes: KnowledgeNode[],
): Promise<KnowledgeNode[]> {
  try {
    const result = await provider.complete({
      system: GAPS_SYSTEM,
      user: buildGapsPrompt(understanding, nodes),
      schema: z.object({ nodes: z.array(knowledgeNodeSchema.omit({ priority: true, depth: true })) }),
      schemaName: 'MissingKnowledgeNodes',
      temperature: 0.5,
      model: 'reasoning',
      // Additions only, so a fraction of the map's budget.
      maxTokens: 2500,
      timeoutMs: 120_000,
    });

    // A node found by asking "what is missing?" came from nowhere but this
     // pass, so it is supporting by construction. Leaving it to the model to
     // label correctly would put a fact at the mercy of an opinion.
    // A node found by asking "what is missing?" came from nowhere but this
    // pass, so it is supporting by construction. Leaving it to the model to
    // label correctly would put a fact at the mercy of an opinion.
    return sanitiseNodes(result.value.nodes as LooseNode[]).nodes.map((node) => ({
      ...node,
      category: node.category === 'optional' ? 'optional' : 'supporting',
    }));
  } catch {
    return [];
  }
}

/** Additions only. A gap pass that renames what already exists has added nothing. */
function mergeNew(existing: KnowledgeNode[], additions: KnowledgeNode[]): KnowledgeNode[] {
  const ids = new Set(existing.map((node) => node.id));
  const titles = new Set(existing.map((node) => node.title.trim().toLowerCase()));
  const merged = [...existing];

  for (const addition of additions) {
    if (ids.has(addition.id) || titles.has(addition.title.trim().toLowerCase())) {
      continue;
    }
    ids.add(addition.id);
    titles.add(addition.title.trim().toLowerCase());
    merged.push(addition);
  }

  return merged;
}
