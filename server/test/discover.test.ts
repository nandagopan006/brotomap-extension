import { z } from 'zod';
import type { KnowledgeNode, TaskUnderstanding } from '@brotomap/shared';
import { describe, expect, it } from 'vitest';
import { AiError, type AiProvider, type CompletionRequest } from '../src/ai/provider.js';
import { runDiscover } from '../src/ai/stages/discover.js';
import { DISCOVER_SYSTEM, buildDiscoverPrompt } from '../src/ai/prompts/discover.js';
import { buildGapsPrompt } from '../src/ai/prompts/gaps.js';

/**
 * The knowledge stage, without the model.
 *
 * What is worth testing here is not what the model says - that is judged by
 * reading a real map - but what happens around it: that the gap pass adds
 * rather than duplicates, that its findings are labelled by where they came
 * from, and that losing the gap pass does not lose the map.
 */

const UNDERSTANDING: TaskUnderstanding = {
  moduleTitle: 'Module 26',
  taskTitle: 'Basics of JavaScript',
  domain: 'web development',
  stack: ['JavaScript'],
  summary: 'Learn the fundamentals of the language.',
  learningObjectives: ['Explain var, let and const'],
  requirements: [
    { id: 'R1', text: 'Understand syntax and data types.', kind: 'learn', source: 'explicit', fromTopicIndexes: [1] },
  ],
  deliverables: ['A description per topic'],
  topicInterpretations: [
    { index: 1, title: 'JavaScript Basics', interpretation: 'Read and write basic code.', isProject: false },
  ],
  project: { present: false, fromTopicIndexes: [] },
  assumedKnowledge: ['Using an editor'],
  ambiguities: [],
};

function node(id: string, overrides: Partial<KnowledgeNode> = {}): KnowledgeNode {
  return {
    id,
    title: id,
    parentId: null,
    level: 'topic',
    category: 'explicit',
    difficulty: 'basic',
    summary: `About ${id}.`,
    whyItMatters: `Needed for ${id}.`,
    status: 'learn',
    effortMinutes: 30,
    prerequisites: [],
    coversRequirements: [],
    coversTopicIndexes: [],
    resources: [],
    ...overrides,
  };
}

/** Answers the discover call with one set of nodes and the gap call with another. */
function provider(first: KnowledgeNode[], gaps: KnowledgeNode[] | 'fail'): AiProvider {
  let call = 0;

  return {
    name: 'fake',
    configured: true,
    async complete<T>(request: CompletionRequest<T>) {
      call += 1;

      if (call > 1 && gaps === 'fail') {
        throw new AiError('unavailable', 'gap pass failed', true);
      }

      const nodes = call === 1 ? first : (gaps as KnowledgeNode[]);
      const parsed = request.schema.safeParse({ nodes });

      if (!parsed.success) {
        throw new AiError('invalid-output', 'bad shape', false);
      }

      return { value: parsed.data, ms: 1, calls: 1, repaired: false };
    },
  };
}

describe('the prompts', () => {
  it('put unstated prerequisites first, with a worked example', () => {
    expect(DISCOVER_SYSTEM).toMatch(/supporting/i);
    expect(DISCOVER_SYSTEM).toMatch(/a third/i);
    // A rule stated abstractly gets agreed with and ignored; an example gets copied.
    expect(DISCOVER_SYSTEM).toMatch(/HTTP headers/);
  });

  it('carry the requirements and topics into the discover call', () => {
    const prompt = buildDiscoverPrompt(UNDERSTANDING, 70);

    expect(prompt).toContain('R1');
    expect(prompt).toContain('JavaScript Basics');
  });

  it('show the gap pass what already exists, so it can only add', () => {
    const prompt = buildGapsPrompt(UNDERSTANDING, [node('t-syntax'), node('t-types')]);

    expect(prompt).toContain('t-syntax');
    expect(prompt).toContain('t-types');
    expect(prompt).toMatch(/what is missing|get stuck/i);
  });
});

describe('the gap pass', () => {
  it('adds what is new', async () => {
    const result = await runDiscover(
      provider([node('t-syntax')], [node('t-hoisting'), node('t-scope')]),
      UNDERSTANDING,
    );

    expect(result.value.nodes).toHaveLength(3);
    expect(result.gapsFound).toBe(2);
  });

  it('labels its findings supporting, whatever the model called them', async () => {
    // A node found by asking "what is missing?" came from nowhere but this
    // pass. That is a fact about its origin, not an opinion to be trusted to.
    const result = await runDiscover(
      provider([node('t-syntax')], [node('t-hoisting', { category: 'explicit' })]),
      UNDERSTANDING,
    );

    const hoisting = result.value.nodes.find((current) => current.id === 't-hoisting');
    expect(hoisting?.category).toBe('supporting');
  });

  it('does not add a node that already exists, by id or by title', async () => {
    const result = await runDiscover(
      provider(
        [node('t-syntax', { title: 'Syntax' })],
        [node('t-syntax'), node('t-different-id', { title: 'syntax' })],
      ),
      UNDERSTANDING,
    );

    expect(result.value.nodes).toHaveLength(1);
    expect(result.gapsFound).toBe(0);
  });

  it('failing does not take the map with it', async () => {
    // A map without its second look is worse, not broken. Losing a good first
    // answer because the audit of it timed out would be a poor trade.
    const result = await runDiscover(provider([node('t-syntax'), node('t-types')], 'fail'), UNDERSTANDING);

    expect(result.value.nodes).toHaveLength(2);
    expect(result.gapsFound).toBe(0);
  });
});

describe('what the stage guarantees regardless of the model', () => {
  it('orders the map and fills in what code decides', async () => {
    const result = await runDiscover(
      provider(
        [
          node('t-advanced', { prerequisites: ['t-basic'] }),
          node('t-basic'),
          node('t-extra', { category: 'optional' }),
        ],
        [],
      ),
      UNDERSTANDING,
    );

    const at = new Map(result.value.sequence.map((id, index) => [id, index]));
    expect(at.get('t-basic')).toBeLessThan(at.get('t-advanced') as number);

    const byId = new Map(result.value.nodes.map((current) => [current.id, current]));
    expect(byId.get('t-extra')?.priority).toBe('P3');
    expect(byId.get('t-basic')?.depth).toBe(0);
    expect(result.value.totals.nodeCount).toBe(3);
  });

  it('promotes a supporting node that a required node depends on', async () => {
    const result = await runDiscover(
      provider([node('t-explicit', { prerequisites: ['t-hidden'] })], [node('t-hidden')]),
      UNDERSTANDING,
    );

    const hidden = result.value.nodes.find((current) => current.id === 't-hidden');
    expect(hidden?.category).toBe('supporting');
    expect(hidden?.priority).toBe('P0');
  });

  it('reports what it had to repair rather than hiding it', async () => {
    const result = await runDiscover(
      provider([node('t-a', { prerequisites: ['t-nowhere'] })], []),
      UNDERSTANDING,
    );

    expect(result.repairs.join(' ')).toContain('t-nowhere');
  });
});

describe('the answer schema', () => {
  it('does not ask the model for anything code decides', async () => {
    // priority and depth are facts about the graph, not opinions about the
    // subject. Asking for them would invite a wrong answer worth ignoring.
    let seen: unknown = null;

    const capture: AiProvider = {
      name: 'fake',
      configured: true,
      async complete<T>(request: CompletionRequest<T>) {
        seen ??= z.toJSONSchema(request.schema as z.ZodType<unknown>, { io: 'input' });
        const parsed = request.schema.safeParse({ nodes: [node('t-a')] });
        if (!parsed.success) throw new AiError('invalid-output', 'bad', false);
        return { value: parsed.data, ms: 1, calls: 1, repaired: false };
      },
    };

    await runDiscover(capture, UNDERSTANDING);

    expect(JSON.stringify(seen)).not.toContain('priority');
    expect(JSON.stringify(seen)).not.toContain('depth');
  });
});
