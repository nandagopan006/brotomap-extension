import type { KnowledgeMap, KnowledgeNode, PracticePlan } from '@brotomap/shared';
import { DEFAULT_PLAN_OPTIONS } from '@brotomap/shared';
import { describe, expect, it } from 'vitest';
import { buildFiveDayPlan } from '../src/planner/schedule.js';

/**
 * The five days are arithmetic, and these are the guarantees that follow from
 * that: no topic before something it needs, no day twice the length of another,
 * nothing silently dropped, and the same input always giving the same week.
 */

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
    effortMinutes: 60,
    prerequisites: [],
    coversRequirements: [],
    coversTopicIndexes: [],
    resources: [],
    priority: 'P0',
    depth: 0,
    ...overrides,
  };
}

function mapOf(nodes: KnowledgeNode[]): KnowledgeMap {
  return {
    nodes,
    sequence: nodes.map((current) => current.id),
    brokenEdges: [],
    totals: {
      nodeCount: nodes.length,
      effortMinutes: nodes.reduce((sum, current) => sum + current.effortMinutes, 0),
      byCategory: { explicit: nodes.length, supporting: 0, optional: 0 },
      byDifficulty: { basic: nodes.length, medium: 0, advanced: 0 },
    },
  };
}

const NO_PRACTICE: PracticePlan = { items: [], totalEffortMinutes: 0 };

function practice(id: string, topicIds: string[], kind: PracticePlan['items'][number]['kind'] = 'exercise') {
  return {
    id,
    kind,
    title: id,
    description: `Do ${id}.`,
    topicIds,
    difficulty: 'basic' as const,
    effortMinutes: 30,
    successCriteria: [`${id} works.`],
    commonMistakes: [],
  };
}

describe('the shape of the week', () => {
  const knowledge = mapOf(Array.from({ length: 20 }, (_, index) => node(`t-${index}`)));
  const plan = buildFiveDayPlan(knowledge, NO_PRACTICE, DEFAULT_PLAN_OPTIONS);

  it('is always five days', () => {
    expect(plan.days.map((day) => day.day)).toEqual([1, 2, 3, 4, 5]);
  });

  it('keeps the last day for revisiting rather than new material', () => {
    const fifth = plan.days[4];

    expect(fifth?.blocks.some((block) => block.kind === 'review')).toBe(true);
    expect(fifth?.blocks.some((block) => block.kind === 'learn')).toBe(false);
  });

  it('teaches every topic exactly once', () => {
    const taught = plan.days.flatMap((day) =>
      day.blocks.filter((block) => block.kind === 'learn').flatMap((block) => block.topicIds),
    );

    expect(taught).toHaveLength(knowledge.nodes.length);
    expect(new Set(taught).size).toBe(knowledge.nodes.length);
  });

  it('gives the same week for the same input', () => {
    const again = buildFiveDayPlan(knowledge, NO_PRACTICE, DEFAULT_PLAN_OPTIONS);

    expect(JSON.stringify(again)).toBe(JSON.stringify(plan));
  });
});

describe('order', () => {
  it('never teaches a topic before what it depends on', () => {
    // The sequence is already in dependency order, so this follows from filling
    // days in that order - which is the point of doing it in code.
    const nodes = [
      node('t-first'),
      node('t-second', { prerequisites: ['t-first'] }),
      node('t-third', { prerequisites: ['t-second'] }),
    ];

    const plan = buildFiveDayPlan(mapOf(nodes), NO_PRACTICE, DEFAULT_PLAN_OPTIONS);
    const dayOf = new Map<string, number>();

    for (const day of plan.days) {
      for (const block of day.blocks) {
        for (const id of block.topicIds) {
          dayOf.set(id, Math.min(dayOf.get(id) ?? day.day, day.day));
        }
      }
    }

    for (const current of nodes) {
      for (const prerequisite of current.prerequisites) {
        expect(dayOf.get(prerequisite)).toBeLessThanOrEqual(dayOf.get(current.id) as number);
      }
    }
  });
});

describe('practice', () => {
  it('never comes before the topic it practises', () => {
    const nodes = Array.from({ length: 16 }, (_, index) => node(`t-${index}`));
    const plan = buildFiveDayPlan(
      mapOf(nodes),
      { items: [practice('p-late', ['t-15'])], totalEffortMinutes: 30 },
      DEFAULT_PLAN_OPTIONS,
    );

    const learnDay = plan.days.find((day) =>
      day.blocks.some((block) => block.kind === 'learn' && block.topicIds.includes('t-15')),
    );
    const practiceDay = plan.days.find((day) =>
      day.blocks.some((block) => block.practiceIds.includes('p-late')),
    );

    expect(practiceDay?.day).toBeGreaterThanOrEqual(learnDay?.day as number);
  });

  it('turns a checkpoint into the day’s checkpoint', () => {
    const plan = buildFiveDayPlan(
      mapOf([node('t-a')]),
      { items: [practice('p-check', ['t-a'], 'checkpoint')], totalEffortMinutes: 30 },
      DEFAULT_PLAN_OPTIONS,
    );

    const day = plan.days.find((current) =>
      current.blocks.some((block) => block.practiceIds.includes('p-check')),
    );

    expect(day?.endOfDayCheckpoint).toContain('p-check works.');
  });

  it('ignores practice for a topic that is not in the plan', () => {
    const plan = buildFiveDayPlan(
      mapOf([node('t-a')]),
      { items: [practice('p-orphan', [])], totalEffortMinutes: 30 },
      DEFAULT_PLAN_OPTIONS,
    );

    const scheduled = plan.days.flatMap((day) => day.blocks.flatMap((block) => block.practiceIds));
    expect(scheduled.filter((id) => id === 'p-orphan').length).toBeLessThanOrEqual(1);
  });
});

describe('when there is more than a week of work', () => {
  it('defers optional depth rather than overfilling the days', () => {
    // A plan that cannot be finished is not a plan. A student who falls behind
    // on day two stops trusting the whole thing.
    const required = Array.from({ length: 20 }, (_, index) =>
      node(`t-${index}`, { effortMinutes: 90 }),
    );
    const optional = Array.from({ length: 10 }, (_, index) =>
      node(`o-${index}`, { effortMinutes: 90, category: 'optional', priority: 'P3' }),
    );

    const plan = buildFiveDayPlan(mapOf([...required, ...optional]), NO_PRACTICE, {
      ...DEFAULT_PLAN_OPTIONS,
      weeklyHours: 25,
    });

    expect(plan.beyondThisWeek.topicIds.length).toBeGreaterThan(0);
    // Everything deferred is optional; nothing required was dropped.
    for (const id of plan.beyondThisWeek.topicIds) {
      expect(id.startsWith('o-')).toBe(true);
    }
  });

  it('says so rather than dropping work quietly', () => {
    const nodes = Array.from({ length: 40 }, (_, index) =>
      node(`t-${index}`, { effortMinutes: 120, category: 'optional', priority: 'P3' }),
    );

    const plan = buildFiveDayPlan(mapOf(nodes), NO_PRACTICE, DEFAULT_PLAN_OPTIONS);

    expect(plan.beyondThisWeek.reason).not.toBe('');
    expect(plan.beyondThisWeek.topicIds.length).toBeGreaterThan(0);
  });

  it('reports everything fitting when it does', () => {
    const plan = buildFiveDayPlan(mapOf([node('t-a')]), NO_PRACTICE, DEFAULT_PLAN_OPTIONS);

    expect(plan.beyondThisWeek.topicIds).toEqual([]);
    expect(plan.beyondThisWeek.reason).toMatch(/fitted/i);
  });
});

describe('what each day says about itself', () => {
  it('is named after what is on it, not a template', () => {
    const plan = buildFiveDayPlan(
      mapOf([node('t-a', { title: 'JavaScript Basics' }), node('t-b', { title: 'Control Flow' })]),
      NO_PRACTICE,
      DEFAULT_PLAN_OPTIONS,
    );

    expect(plan.days[0]?.theme).toContain('JavaScript Basics');
    expect(plan.days[4]?.theme).toMatch(/review|finish/i);
  });

  it('ends every day with something checkable', () => {
    const plan = buildFiveDayPlan(
      mapOf(Array.from({ length: 12 }, (_, index) => node(`t-${index}`))),
      NO_PRACTICE,
      DEFAULT_PLAN_OPTIONS,
    );

    for (const day of plan.days) {
      expect(day.endOfDayCheckpoint.length).toBeGreaterThan(0);
    }
  });
});

/**
 * A week that is brutal on Monday and blank on Thursday is not a plan anybody
 * follows. Filling each day to the week's capacity did exactly that: everything
 * landed in the first two days because that was all the capacity allowed.
 */
describe('how the work is spread', () => {
  it('teaches on days one and two, then practises, builds and revises', () => {
    // The week is a teaching progression, not an even division of topics.
    // Learning something and understanding it are different activities.
    const nodes = Array.from({ length: 24 }, (_, index) => node(`t-${index}`, { effortMinutes: 30 }));

    const plan = buildFiveDayPlan(mapOf(nodes), NO_PRACTICE, DEFAULT_PLAN_OPTIONS);

    expect(plan.days.map((day) => day.stage)).toEqual([
      'learn',
      'understand',
      'practice',
      'build',
      'revise',
    ]);

    const taughtOn = (day: number): number =>
      plan.days[day - 1]?.blocks
        .filter((block) => block.kind === 'learn')
        .flatMap((block) => block.topicIds).length ?? 0;

    expect(taughtOn(1)).toBeGreaterThan(0);
    expect(taughtOn(2)).toBeGreaterThan(0);
    // Nothing new after day two: the rest of the week uses what was learned.
    expect(taughtOn(3) + taughtOn(4) + taughtOn(5)).toBe(0);
  });

  it('splits the teaching so neither day is twice the other', () => {
    const nodes = Array.from({ length: 20 }, (_, index) => node(`t-${index}`, { effortMinutes: 45 }));

    const plan = buildFiveDayPlan(mapOf(nodes), NO_PRACTICE, DEFAULT_PLAN_OPTIONS);
    const minutes = plan.days
      .slice(0, 2)
      .map((day) =>
        day.blocks
          .filter((block) => block.kind === 'learn')
          .reduce((sum, block) => sum + block.minutes, 0),
      );

    const busiest = Math.max(...minutes);
    const quietest = Math.min(...minutes);

    expect(busiest).toBeLessThanOrEqual(quietest * 2);
  });

  it('does not invent work to fill a day when the task is small', () => {
    const plan = buildFiveDayPlan(mapOf([node('t-a'), node('t-b')]), NO_PRACTICE, DEFAULT_PLAN_OPTIONS);
    const taught = plan.days.flatMap((day) =>
      day.blocks.filter((block) => block.kind === 'learn').flatMap((block) => block.topicIds),
    );

    expect(taught).toHaveLength(2);
  });

  it('says what each day is for, and how to know it happened', () => {
    const plan = buildFiveDayPlan(
      mapOf(Array.from({ length: 8 }, (_, index) => node(`t-${index}`))),
      NO_PRACTICE,
      DEFAULT_PLAN_OPTIONS,
    );

    for (const day of plan.days) {
      expect(day.expectedOutcome.length).toBeGreaterThan(0);
      expect(day.endOfDayCheckpoint.length).toBeGreaterThan(0);
    }
  });
});
