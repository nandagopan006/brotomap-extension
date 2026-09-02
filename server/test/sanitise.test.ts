import { knowledgeNodeSchema } from '@brotomap/shared';
import { describe, expect, it } from 'vitest';
import { sanitiseNodes, type LooseNode } from '../src/ai/sanitise.js';

/**
 * Coercing a nearly-right answer instead of throwing it away.
 *
 * A live run failed with "nodes.12.id: ids are lowercase kebab-case" and lost a
 * forty-node map over two capital letters. Format is a convention we invented
 * and can enforce ourselves; meaning is the only thing worth rejecting for.
 */

function loose(overrides: Partial<LooseNode> = {}): LooseNode {
  return {
    id: 't-thing',
    title: 'Thing',
    parentId: null,
    level: 'topic',
    category: 'explicit',
    difficulty: 'basic',
    summary: 'About the thing.',
    whyItMatters: 'Needed for the task.',
    status: 'learn',
    effortMinutes: 30,
    prerequisites: [],
    coversRequirements: [],
    coversTopicIndexes: [],
    resources: [],
    ...overrides,
  };
}

describe('ids', () => {
  it('rewrites the format the model got wrong', () => {
    const { nodes, fixes } = sanitiseNodes([loose({ id: 't-ES6_Classes' })]);

    expect(nodes[0]?.id).toBe('t-es6-classes');
    expect(fixes.join(' ')).toMatch(/rewrote 1 id/i);
  });

  it('rewrites references so a renamed id stays connected', () => {
    // The failure this prevents: renaming an id without renaming what points at
    // it turns a real dependency into a dangling one.
    const { nodes } = sanitiseNodes([
      loose({ id: 't-Basics' }),
      loose({ id: 't-Advanced', parentId: 't-Basics', prerequisites: ['t-Basics'] }),
    ]);

    expect(nodes[1]?.parentId).toBe('t-basics');
    expect(nodes[1]?.prerequisites).toEqual(['t-basics']);
  });

  it('keeps two nodes apart when their ids clean up to the same thing', () => {
    const { nodes } = sanitiseNodes([loose({ id: 'Scope Types' }), loose({ id: 'scope-types' })]);

    expect(nodes[0]?.id).toBe('scope-types');
    expect(nodes[1]?.id).toBe('scope-types-2');
  });

  it('falls back to the title when an id cleans up to nothing', () => {
    const { nodes } = sanitiseNodes([loose({ id: '???', title: 'Event Loop' })]);

    expect(nodes[0]?.id).toBe('event-loop');
  });

  it('leaves a reference to a node it has not seen alone', () => {
    // Whether that node exists is a question about the whole graph, and this
    // function only ever sees one call's worth of it. Answering here deleted
    // real dependencies that spanned two calls; the graph builder answers it
    // once, with everything in front of it.
    const { nodes } = sanitiseNodes([loose({ prerequisites: ['t-Elsewhere'] })]);

    expect(nodes[0]?.prerequisites).toEqual(['t-elsewhere']);
  });
});

describe('values a model gets approximately right', () => {
  it('clamps an impossible effort rather than discarding the node', () => {
    const { nodes, fixes } = sanitiseNodes([loose({ effortMinutes: 600 })]);

    expect(nodes[0]?.effortMinutes).toBe(240);
    expect(fixes.join(' ')).toContain('600 minutes');
  });

  it('leaves a plausible estimate alone', () => {
    // 37 minutes is inside the allowed range. The prompt asks for steps of 15
    // because tidy numbers read better, but rounding a plausible estimate that
    // is already usable would be correcting something that is not wrong.
    expect(sanitiseNodes([loose({ effortMinutes: 37 })]).nodes[0]?.effortMinutes).toBe(37);
  });

  it('lifts an implausibly small estimate to the floor', () => {
    // One minute is not an estimate of anything. Five is the least the schema
    // allows, and a node kept at the floor is better than a node discarded.
    expect(sanitiseNodes([loose({ effortMinutes: 1 })]).nodes[0]?.effortMinutes).toBe(5);
  });

  it('keeps only requirement references that mean something', () => {
    const { nodes } = sanitiseNodes([
      loose({ coversRequirements: ['R1', 'r2', '3', 'requirement four', 'R1'] }),
    ]);

    expect(nodes[0]?.coversRequirements).toEqual(['R1', 'R2']);
  });

  it('drops a topic index that is not a topic number', () => {
    const { nodes } = sanitiseNodes([loose({ coversTopicIndexes: [1, 0, -2, 3.5, 4] })]);

    expect(nodes[0]?.coversTopicIndexes).toEqual([1, 4]);
  });

  it('fills in prose the model left blank', () => {
    const { nodes } = sanitiseNodes([loose({ summary: '   ', whyItMatters: '' })]);

    expect(nodes[0]?.summary.length).toBeGreaterThan(0);
    expect(nodes[0]?.whyItMatters.length).toBeGreaterThan(0);
  });
});

describe('what is not worth saving', () => {
  it('drops a node with no title, because it says nothing', () => {
    const { nodes, fixes } = sanitiseNodes([loose(), loose({ title: '  ' })]);

    expect(nodes).toHaveLength(1);
    expect(fixes.join(' ')).toMatch(/no title/i);
  });
});

describe('the result', () => {
  it('always satisfies the strict schema', () => {
    // The point of the exercise: whatever came in, what comes out is valid.
    const { nodes } = sanitiseNodes([
      loose({ id: 'T-Weird_ID!!', effortMinutes: 999, coversRequirements: ['nope'] }),
      loose({ id: 'another one', parentId: 'T-Weird_ID!!', summary: '' }),
    ]);

    for (const node of nodes) {
      expect(knowledgeNodeSchema.safeParse(node).success).toBe(true);
    }
  });
});
