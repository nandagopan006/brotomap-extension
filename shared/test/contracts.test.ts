import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  extractedTechnicalTaskSchema,
  extractionOutcomeSchema,
  generateRequestSchema,
  idSchema,
  type ExtractedTechnicalTask,
} from '../src/index.js';

/**
 * A realistic extraction result.
 *
 * The technology here is deliberately NOT one of the examples in the spec: the
 * contracts must be indifferent to what the week's subject happens to be.
 */
const sampleTask: ExtractedTechnicalTask = {
  source: 'brototype',
  extractedAt: '2026-09-01T09:00:00.000Z',
  pageUrl: 'https://portal.example.com/tasks/module/1234',
  module: { sourceId: 'm-1234', title: 'Module 31', isCurrent: true },
  task: {
    sourceId: 't-9911',
    category: 'technical',
    title: 'Data Pipelines Module 5',
    description: 'Build and reason about batch data pipelines.',
    declaredTopicCount: 2,
  },
  topics: [
    {
      index: 1,
      title: 'Stream processing fundamentals',
      content: 'Explain backpressure, windowing and at-least-once delivery.',
      sections: [
        {
          heading: 'Requirements',
          kind: 'requirements',
          content: 'Implement a windowed aggregation.',
          items: ['Handle late events', 'Document the trade-offs'],
        },
      ],
      links: [{ label: 'Reference guide', url: 'https://example.com/guide', kind: 'reference' }],
      attachments: [],
      expansion: 'already-visible',
      complete: true,
    },
    {
      index: 2,
      title: 'Capstone: ingestion service',
      content: 'Build an ingestion service that survives replay.',
      sections: [{ kind: 'project', content: 'Deliver a working service with tests.' }],
      links: [],
      attachments: [{ name: 'spec.pdf', accessible: false }],
      expansion: 'expanded-by-us',
      complete: true,
    },
  ],
  links: [],
  attachments: [],
  detection: {
    confidence: 'high',
    score: 0.94,
    matchedSignals: ['category-attribute', 'structure-signature'],
    candidates: [
      {
        title: 'Data Pipelines Module 5',
        categoryLabel: 'Technical',
        classification: 'technical',
        score: 0.94,
        matchedSignals: ['category-attribute', 'structure-signature'],
      },
      {
        title: 'Communication Task - Module 31',
        categoryLabel: 'Communication',
        classification: 'non-technical',
        score: 0.02,
        matchedSignals: ['category-exclusion'],
      },
    ],
    warnings: [],
    interactionCount: 1,
  },
  stats: { topicCount: 2, totalChars: 214, truncated: false },
};

describe('extraction contract', () => {
  it('accepts a well-formed technical task', () => {
    expect(() => extractedTechnicalTaskSchema.parse(sampleTask)).not.toThrow();
  });

  it('rejects a task with no topics', () => {
    const result = extractedTechnicalTaskSchema.safeParse({ ...sampleTask, topics: [] });
    expect(result.success).toBe(false);
  });

  it('rejects a non-technical category reaching this layer', () => {
    const result = extractedTechnicalTaskSchema.safeParse({
      ...sampleTask,
      task: { ...sampleTask.task, category: 'communication' },
    });
    expect(result.success).toBe(false);
  });

  it('rejects a blank task title', () => {
    const result = extractedTechnicalTaskSchema.safeParse({
      ...sampleTask,
      task: { ...sampleTask.task, title: '   ' },
    });
    expect(result.success).toBe(false);
  });
});

describe('extraction outcome', () => {
  it('can express an honest refusal to guess', () => {
    const outcome = extractionOutcomeSchema.parse({
      status: 'failed',
      reason: 'technical-task-ambiguous',
      message: 'Technical task could not be confidently identified.',
      candidates: sampleTask.detection.candidates,
      retryable: true,
    });
    expect(outcome.status).toBe('failed');
  });

  it('carries the task on success', () => {
    const outcome = extractionOutcomeSchema.parse({ status: 'ok', task: sampleTask });
    expect(outcome.status === 'ok' && outcome.task.topics).toHaveLength(2);
  });
});

describe('api contract', () => {
  it('accepts a generate request with partial options', () => {
    const parsed = generateRequestSchema.parse({
      task: sampleTask,
      options: { weeklyHours: 20 },
    });
    expect(parsed.options?.weeklyHours).toBe(20);
  });

  it('rejects an out-of-range weekly budget', () => {
    const result = generateRequestSchema.safeParse({
      task: sampleTask,
      options: { weeklyHours: 500 },
    });
    expect(result.success).toBe(false);
  });
});

describe('id convention', () => {
  it.each(['t-state-management', 'f-ingestion-service', 'p-drill-1'])('accepts %s', (id) => {
    expect(idSchema.safeParse(id).success).toBe(true);
  });

  it.each(['Not Kebab', 'has_underscore', '-leading', ''])('rejects %s', (id) => {
    expect(idSchema.safeParse(id).success).toBe(false);
  });
});

/**
 * RULE 2 guard.
 *
 * No technology name may appear in application code. Technologies are runtime
 * data that change every week; the moment one is written into a source file,
 * detection silently stops working the week the subject changes.
 * Comments are exempt — they explain the rule.
 */
describe('no hard-coded technology names', () => {
  const srcDir = fileURLToPath(new URL('../src/', import.meta.url));
  const forbidden = /\b(react|redux|zustand|mobx|mongodb|express|nodejs|node\.js|jwt)\b/i;

  const files = readdirSync(srcDir, { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith('.ts'))
    .map((entry) => entry.name);

  it('finds source files to check', () => {
    expect(files.length).toBeGreaterThan(0);
  });

  it.each(files)('%s contains no technology name outside comments', (file) => {
    const code = readFileSync(join(srcDir, file), 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/\/\/.*$/gm, '');
    expect(code).not.toMatch(forbidden);
  });
});
