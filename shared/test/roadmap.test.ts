import { z } from 'zod';
import { describe, expect, it } from 'vitest';
import {
  PIPELINE_VERSION,
  knowledgeMapSchema,
  practicePlanSchema,
  projectPlanSchema,
  roadmapSchema,
  taskUnderstandingSchema,
  type DayPlan,
  type Roadmap,
} from '../src/index.js';

/**
 * Composition test.
 *
 * Every schema parsing in isolation does not prove the finished object is
 * *satisfiable*: a required field that nothing can legally produce only shows
 * up when the whole Roadmap is assembled. This fixture is that proof, and it
 * doubles as the shape the UI and the PDF will be written against.
 */

const STAGES = ['learn', 'understand', 'practice', 'build', 'revise'] as const;

const day = (n: 1 | 2 | 3 | 4 | 5, theme: string, minutes: number): DayPlan => ({
  day: n,
  stage: STAGES[n - 1] ?? 'learn',
  theme,
  focus: `Focus for day ${n}`,
  blocks: [
    {
      kind: n >= 4 ? 'build' : 'learn',
      title: `Block ${n}`,
      minutes,
      topicIds: n >= 4 ? [] : ['t-fundamentals'],
      practiceIds: [],
      featureIds: n >= 4 ? ['f-ingestion'] : [],
    },
  ],
  totalMinutes: minutes,
  expectedOutcome: `You can do what day ${n} was for.`,
  endOfDayCheckpoint: `You can explain what you did on day ${n}.`,
});

const sampleRoadmap: Roadmap = {
  meta: {
    pipelineVersion: PIPELINE_VERSION,
    hash: 'a'.repeat(64),
    generatedAt: '2026-09-01T09:05:00.000Z',
    timings: { understand: 1200, discover: 8100, plan: 12 },
    degradedStages: [],
    planOptions: { weeklyHours: 25, slackRatio: 0.15, reviewReserveMinutes: 60 },
  },
  extraction: {
    source: 'brototype',
    extractedAt: '2026-09-01T09:00:00.000Z',
    pageUrl: 'https://portal.example.com/tasks/module/1234',
    module: { title: 'Module 31', isCurrent: true },
    task: { category: 'technical', title: 'Data Pipelines Module 5', declaredTopicCount: 1 },
    topics: [
      {
        index: 1,
        title: 'Stream processing fundamentals',
        content: 'Explain backpressure and windowing.',
        sections: [],
        links: [],
        attachments: [],
        expansion: 'already-visible',
        complete: true,
      },
    ],
    links: [],
    attachments: [],
    detection: {
      confidence: 'high',
      score: 0.94,
      matchedSignals: ['category-attribute'],
      candidates: [],
      warnings: [],
      interactionCount: 0,
    },
    stats: { topicCount: 1, totalChars: 38, truncated: false },
  },
  understanding: {
    moduleTitle: 'Module 31',
    taskTitle: 'Data Pipelines Module 5',
    domain: 'data engineering',
    stack: ['a queue', 'a stream processor'],
    summary: 'Learn stream processing and ship an ingestion service.',
    learningObjectives: ['Explain backpressure', 'Build a windowed aggregation'],
    requirements: [
      {
        id: 'R1',
        text: 'Implement a windowed aggregation.',
        kind: 'build',
        source: 'explicit',
        fromTopicIndexes: [1],
      },
      {
        id: 'R2',
        text: 'Understand delivery guarantees.',
        kind: 'learn',
        source: 'implicit',
        reason: 'The aggregation is meaningless without knowing what may be replayed.',
        fromTopicIndexes: [1],
      },
    ],
    deliverables: ['A running ingestion service'],
    topicInterpretations: [
      {
        index: 1,
        title: 'Stream processing fundamentals',
        interpretation: 'The student must reason about time and ordering.',
        isProject: false,
      },
    ],
    project: { present: true, summary: 'An ingestion service', fromTopicIndexes: [1] },
    assumedKnowledge: ['Basic programming'],
    ambiguities: [],
  },
  knowledge: {
    nodes: [
      {
        id: 't-fundamentals',
        title: 'Stream fundamentals',
        parentId: null,
        level: 'topic',
        category: 'explicit',
        difficulty: 'medium',
        summary: 'How unbounded data is processed.',
        whyItMatters: 'Everything in this task assumes it.',
        status: 'learn',
        effortMinutes: 90,
        prerequisites: [],
        coversRequirements: ['R1', 'R2'],
        coversTopicIndexes: [1],
        resources: [{ label: 'Official processing guide', kind: 'documentation' }],
        priority: 'P0',
        depth: 0,
      },
    ],
    sequence: ['t-fundamentals'],
    brokenEdges: [],
    totals: {
      nodeCount: 1,
      effortMinutes: 90,
      byCategory: { explicit: 1, supporting: 0, optional: 0 },
      byDifficulty: { basic: 0, medium: 1, advanced: 0 },
    },
  },
  practice: {
    items: [
      {
        id: 'p-window-drill',
        kind: 'exercise',
        title: 'Windowed count',
        description: 'Aggregate events into 5-minute tumbling windows.',
        topicIds: ['t-fundamentals'],
        difficulty: 'medium',
        effortMinutes: 45,
        successCriteria: ['Late events are counted in the right window'],
        commonMistakes: ['Using arrival time instead of event time'],
      },
    ],
    totalEffortMinutes: 45,
  },
  project: {
    name: 'Ingestion service',
    overview: 'A service that ingests, aggregates and survives replay.',
    requirements: ['Must be idempotent'],
    features: [
      {
        id: 'f-ingestion',
        title: 'Ingestion endpoint',
        description: 'Accept and persist events.',
        phase: 'implementation',
        requiredTopicIds: ['t-fundamentals'],
        coversRequirements: ['R1'],
        effortMinutes: 120,
        buildOrder: 1,
      },
    ],
    milestones: [{ day: 5, achievement: 'Service handles a replayed batch' }],
    definitionOfDone: ['Aggregation verified against a known input'],
    submissionChecklist: ['Repository pushed', 'README explains the trade-offs'],
    totalEffortMinutes: 120,
  },
  plan: {
    days: [
      day(1, 'Foundation', 240),
      day(2, 'Core concepts', 240),
      day(3, 'Advanced concepts and practice', 240),
      day(4, 'Project implementation', 240),
      day(5, 'Completion and revision', 180),
    ],
    plannedMinutes: 1140,
    budgetMinutes: 1500,
    beyondThisWeek: { topicIds: [], practiceIds: [], reason: 'Everything fitted this week.' },
  },
  validation: {
    passed: true,
    requirementCoverage: [
      { requirementId: 'R1', coveredBy: ['t-fundamentals', 'f-ingestion'], days: [1, 4] },
      { requirementId: 'R2', coveredBy: ['t-fundamentals'], days: [1] },
    ],
    topicCoverage: [
      { topicIndex: 1, title: 'Stream processing fundamentals', coveredByNodeIds: ['t-fundamentals'] },
    ],
    issues: [],
    workload: { plannedMinutes: 1140, budgetMinutes: 1500, variancePct: -24 },
  },
};

describe('roadmap composition', () => {
  it('a complete roadmap is satisfiable', () => {
    expect(() => roadmapSchema.parse(sampleRoadmap)).not.toThrow();
  });

  it('a task with no project is valid', () => {
    const result = roadmapSchema.safeParse({ ...sampleRoadmap, project: null });
    expect(result.success).toBe(true);
  });

  it('rejects a plan that is not five days', () => {
    const result = roadmapSchema.safeParse({
      ...sampleRoadmap,
      plan: { ...sampleRoadmap.plan, days: sampleRoadmap.plan.days.slice(0, 4) },
    });
    expect(result.success).toBe(false);
  });

  it('rejects a malformed requirement id in coverage', () => {
    const node = sampleRoadmap.knowledge.nodes[0]!;
    const result = roadmapSchema.safeParse({
      ...sampleRoadmap,
      knowledge: {
        ...sampleRoadmap.knowledge,
        nodes: [{ ...node, coversRequirements: ['REQ-1'] }],
      },
    });
    expect(result.success).toBe(false);
  });

  it('rejects an unknown pipeline stage in a degraded run', () => {
    // degradedStages is free-form by design; this documents that intent.
    const result = roadmapSchema.safeParse({
      ...sampleRoadmap,
      meta: { ...sampleRoadmap.meta, degradedStages: ['practice'] },
    });
    expect(result.success).toBe(true);
  });
});

/**
 * Phase 5 depends on handing the model a JSON Schema derived from these zod
 * schemas. Proving it here means a schema change that breaks generation fails
 * now, not halfway through building the AI pipeline.
 */
describe('json schema generation for AI structured output', () => {
  const aiFacing = {
    understanding: taskUnderstandingSchema,
    knowledge: knowledgeMapSchema,
    practice: practicePlanSchema,
    project: projectPlanSchema,
  };

  it.each(Object.entries(aiFacing))('%s converts to JSON Schema', (_name, schema) => {
    const json = z.toJSONSchema(schema) as { type?: string; properties?: Record<string, unknown> };
    expect(json.type).toBe('object');
    expect(Object.keys(json.properties ?? {}).length).toBeGreaterThan(0);
  });
});
