import type { KnowledgeNode } from '@brotomap/shared';
import { describe, expect, it } from 'vitest';
import { buildGraph, promoteRequiredPrerequisites, topologicalOrder } from '../src/planner/graph.js';

/**
 * The graph is where hoping stops.
 *
 * A model can say what depends on what; it cannot be trusted to order fifty
 * nodes consistently. These tests are the guarantees the rest of the pipeline
 * is allowed to assume: the order respects every dependency, the same input
 * gives the same output, and nothing a model gets wrong can crash a run.
 */

function node(id: string, overrides: Partial<KnowledgeNode> = {}): KnowledgeNode {
  return {
    id,
    title: id,
    parentId: null,
    level: 'topic',
    category: 'explicit',
    difficulty: 'medium',
    summary: `About ${id}.`,
    whyItMatters: `Needed for ${id}.`,
    status: 'learn',
    effortMinutes: 60,
    prerequisites: [],
    coversRequirements: [],
    coversTopicIndexes: [],
    resources: [],
    ...overrides,
  };
}

/** Position in the finished sequence, for asserting "before". */
function positions(sequence: string[]): Map<string, number> {
  return new Map(sequence.map((id, index) => [id, index]));
}

describe('ordering', () => {
  it('never places a node before something it depends on', () => {
    const nodes = [
      node('t-c', { prerequisites: ['t-b'] }),
      node('t-a'),
      node('t-b', { prerequisites: ['t-a'] }),
    ];

    const { map } = buildGraph(nodes);
    const at = positions(map.sequence);

    expect(at.get('t-a')).toBeLessThan(at.get('t-b') as number);
    expect(at.get('t-b')).toBeLessThan(at.get('t-c') as number);
  });

  it('holds for a deep chain and a wide fan-out', () => {
    const chain = Array.from({ length: 12 }, (_, index) =>
      node(`t-${index}`, index === 0 ? {} : { prerequisites: [`t-${index - 1}`] }),
    );
    const fan = Array.from({ length: 8 }, (_, index) => node(`f-${index}`, { prerequisites: ['t-0'] }));

    const { map } = buildGraph([...fan, ...chain]);
    const at = positions(map.sequence);

    for (const current of map.nodes) {
      for (const prerequisite of current.prerequisites) {
        expect(at.get(prerequisite)).toBeLessThan(at.get(current.id) as number);
      }
    }
  });

  it('teaches foundations before detail when several are ready at once', () => {
    const nodes = [
      node('t-advanced', { difficulty: 'advanced' }),
      node('t-basic', { difficulty: 'basic' }),
      node('t-optional', { category: 'optional' }),
    ];

    const { map } = buildGraph(nodes);

    expect(map.sequence[0]).toBe('t-basic');
    expect(map.sequence.at(-1)).toBe('t-optional');
  });

  it('is deterministic', () => {
    const nodes = [
      node('t-b', { prerequisites: ['t-a'] }),
      node('t-a'),
      node('t-d', { prerequisites: ['t-b', 't-c'] }),
      node('t-c', { prerequisites: ['t-a'] }),
    ];

    const first = buildGraph(nodes).map.sequence;
    const second = buildGraph([...nodes].reverse()).map.sequence;

    expect(first).toEqual(second);
  });

  it('orders every node exactly once', () => {
    const nodes = Array.from({ length: 30 }, (_, index) =>
      node(`t-${index}`, index % 3 === 0 ? {} : { prerequisites: [`t-${index - (index % 3)}`] }),
    );

    const { map } = buildGraph(nodes);

    expect(map.sequence).toHaveLength(nodes.length);
    expect(new Set(map.sequence).size).toBe(nodes.length);
  });
});

describe('what a model gets wrong', () => {
  it('breaks a cycle, reports it, and still produces an order', () => {
    const nodes = [
      node('t-a', { prerequisites: ['t-c'] }),
      node('t-b', { prerequisites: ['t-a'] }),
      node('t-c', { prerequisites: ['t-b'] }),
    ];

    const { map, repairs } = buildGraph(nodes);

    expect(map.brokenEdges).toHaveLength(1);
    expect(map.sequence).toHaveLength(3);
    expect(repairs.join(' ')).toMatch(/cycle/i);
  });

  it('leaves no dangling prerequisite behind after breaking a cycle', () => {
    const nodes = [
      node('t-a', { prerequisites: ['t-b'] }),
      node('t-b', { prerequisites: ['t-a'] }),
    ];

    const { map } = buildGraph(nodes);
    const at = positions(map.sequence);

    for (const current of map.nodes) {
      for (const prerequisite of current.prerequisites) {
        expect(at.get(prerequisite)).toBeLessThan(at.get(current.id) as number);
      }
    }
  });

  it('drops a prerequisite that does not exist rather than failing', () => {
    const { map, repairs } = buildGraph([node('t-a', { prerequisites: ['t-imaginary'] })]);

    expect(map.nodes[0]?.prerequisites).toEqual([]);
    expect(repairs.join(' ')).toContain('t-imaginary');
  });

  it('treats a node with a missing parent as a top-level topic', () => {
    const { map, repairs } = buildGraph([node('t-a', { parentId: 't-gone' })]);

    expect(map.nodes[0]?.parentId).toBeNull();
    expect(repairs.join(' ')).toContain('t-gone');
  });

  it('removes a duplicate id', () => {
    const { map, repairs } = buildGraph([node('t-a'), node('t-a', { title: 'again' })]);

    expect(map.nodes).toHaveLength(1);
    expect(repairs.join(' ')).toContain('t-a');
  });

  it('ignores a node that requires itself', () => {
    const { map } = buildGraph([node('t-a', { prerequisites: ['t-a'] })]);

    expect(map.nodes[0]?.prerequisites).toEqual([]);
    expect(map.sequence).toEqual(['t-a']);
  });
});

describe('derived facts', () => {
  it('computes depth from the parent chain', () => {
    const nodes = [
      node('t-root'),
      node('t-child', { parentId: 't-root', level: 'subtopic' }),
      node('t-leaf', { parentId: 't-child', level: 'concept' }),
    ];

    const { map } = buildGraph(nodes);
    const byId = new Map(map.nodes.map((current) => [current.id, current]));

    expect(byId.get('t-root')?.depth).toBe(0);
    expect(byId.get('t-leaf')?.depth).toBe(2);
  });

  it('counts totals from the nodes rather than trusting the model', () => {
    const nodes = [
      node('t-a', { effortMinutes: 60, category: 'explicit', difficulty: 'basic' }),
      node('t-b', { effortMinutes: 30, category: 'supporting', difficulty: 'advanced' }),
    ];

    const { map } = buildGraph(nodes);

    expect(map.totals.effortMinutes).toBe(90);
    expect(map.totals.byCategory.supporting).toBe(1);
    expect(map.totals.byDifficulty.advanced).toBe(1);
  });

  it('labels by category before the graph has its say', () => {
    // buildGraph only knows what kind of thing each node is. Whether something
    // blocks progress is a question about the graph, answered separately.
    const { map } = buildGraph([
      node('t-a'),
      node('t-b', { category: 'supporting' }),
      node('t-c', { category: 'optional' }),
    ]);
    const byId = new Map(map.nodes.map((current) => [current.id, current]));

    expect(byId.get('t-a')?.priority).toBe('P1');
    expect(byId.get('t-b')?.priority).toBe('P2');
    expect(byId.get('t-c')?.priority).toBe('P3');
  });
});

describe('a prerequisite of something required is itself required', () => {
  it('makes a topic others build on P0, and one nothing depends on P1', () => {
    // P0 is about blocking progress, not difficulty.
    const nodes = [
      node('t-foundation'),
      node('t-later', { prerequisites: ['t-foundation'] }),
      node('t-standalone'),
    ];

    const promoted = promoteRequiredPrerequisites(buildGraph(nodes).map);
    const byId = new Map(promoted.nodes.map((current) => [current.id, current]));

    expect(byId.get('t-foundation')?.priority).toBe('P0');
    expect(byId.get('t-standalone')?.priority).toBe('P1');
  });

  it('promotes a supporting node that required work depends on', () => {
    // The task never named it, so the model called it supporting. But the thing
    // that needs it is required, which makes it required too - the inference a
    // model gets subtly wrong and code gets right every time.
    const nodes = [
      node('t-explicit', { category: 'explicit', prerequisites: ['t-hidden'] }),
      node('t-hidden', { category: 'supporting' }),
      node('t-unrelated', { category: 'supporting' }),
    ];

    const promoted = promoteRequiredPrerequisites(buildGraph(nodes).map);
    const byId = new Map(promoted.nodes.map((current) => [current.id, current]));

    expect(byId.get('t-hidden')?.priority).toBe('P0');
    expect(byId.get('t-unrelated')?.priority).toBe('P2');
  });

  it('follows the chain all the way down', () => {
    const nodes = [
      node('t-explicit', { category: 'explicit', prerequisites: ['t-mid'] }),
      node('t-mid', { category: 'supporting', prerequisites: ['t-deep'] }),
      node('t-deep', { category: 'supporting' }),
    ];

    const promoted = promoteRequiredPrerequisites(buildGraph(nodes).map);
    const byId = new Map(promoted.nodes.map((current) => [current.id, current]));

    expect(byId.get('t-deep')?.priority).toBe('P0');
  });
});

describe('topologicalOrder on its own', () => {
  it('returns an empty order for no nodes', () => {
    expect(topologicalOrder([]).order).toEqual([]);
  });
});

/**
 * The guarantee, checked against graphs nobody hand-picked.
 *
 * Hand-written cases test what the author thought of. Random graphs test the
 * claim itself: whatever the model produces, the order respects it.
 */
describe('over many random graphs', () => {
  function randomDag(seed: number, size: number): KnowledgeNode[] {
    // A tiny deterministic generator: a failing case must be reproducible.
    let state = seed;
    const next = (): number => {
      state = (state * 1103515245 + 12345) % 2147483648;
      return state / 2147483648;
    };

    return Array.from({ length: size }, (_, index) => {
      // Only ever depend on an earlier node, which makes a cycle impossible by
      // construction - the property under test is the ordering, not the repair.
      const prerequisites = Array.from({ length: index }, (_, other) => other)
        .filter(() => next() < 0.25)
        .slice(0, 4)
        .map((other) => `t-${other}`);

      return node(`t-${index}`, {
        prerequisites,
        difficulty: (['basic', 'medium', 'advanced'] as const)[Math.floor(next() * 3)] ?? 'medium',
        category: (['explicit', 'supporting', 'optional'] as const)[Math.floor(next() * 3)] ?? 'explicit',
      });
    });
  }

  it.each([1, 7, 13, 42, 99, 1234, 31337])('respects every dependency (seed %i)', (seed) => {
    const nodes = randomDag(seed, 40);
    const { map } = buildGraph(nodes);
    const at = positions(map.sequence);

    expect(map.sequence).toHaveLength(nodes.length);

    for (const current of map.nodes) {
      for (const prerequisite of current.prerequisites) {
        expect(at.get(prerequisite)).toBeLessThan(at.get(current.id) as number);
      }
    }

    // No cycle was possible, so none should have been broken.
    expect(map.brokenEdges).toHaveLength(0);
  });
});
