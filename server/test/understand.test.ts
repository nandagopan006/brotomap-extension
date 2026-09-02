import { taskUnderstandingSchema, type ExtractedTechnicalTask } from '@brotomap/shared';
import { describe, expect, it } from 'vitest';
import { extractJson, parseAs, schemaForPrompt } from '../src/ai/json.js';
import { AiError, type AiProvider, type CompletionRequest } from '../src/ai/provider.js';
import { runUnderstand } from '../src/ai/stages/understand.js';
import { UNDERSTAND_SYSTEM, buildUnderstandPrompt } from '../src/ai/prompts/understand.js';

/**
 * The AI stage, tested without the AI.
 *
 * A test that calls a live model tests the model, not the code, and does it
 * slowly and differently every time. What matters here is that a valid answer
 * is accepted, an invalid one is repaired rather than trusted, and a model that
 * will not comply fails loudly instead of returning something half-shaped.
 */

const TASK: ExtractedTechnicalTask = {
  source: 'brototype',
  extractedAt: '2026-09-01T09:00:00.000Z',
  pageUrl: 'https://student.brototype.com/tasks/module/details',
  module: { title: 'Module 26', isCurrent: true },
  task: { category: 'technical', title: 'Basics of JavaScript', declaredTopicCount: 2 },
  topics: [
    {
      index: 1,
      title: 'JavaScript Basics',
      content:
        'a). Understand syntax, variables and data types.\nb). Learn operators.\nWrite a short description about this task.',
      sections: [],
      links: [],
      attachments: [],
      expansion: 'already-visible',
      complete: true,
    },
    {
      index: 2,
      title: 'Asynchronous Programming',
      content: 'a). Learn async/await and promises.\nb). Understand modules.',
      sections: [],
      links: [],
      attachments: [],
      expansion: 'expanded-by-us',
      complete: true,
    },
  ],
  links: [],
  attachments: [],
  detection: {
    confidence: 'medium',
    score: 0.6,
    matchedSignals: ['category-label'],
    candidates: [],
    warnings: [],
    interactionCount: 2,
  },
  stats: { topicCount: 2, totalChars: 170, truncated: false },
};

const VALID_ANSWER = {
  moduleTitle: 'wrong on purpose',
  taskTitle: 'wrong on purpose',
  domain: 'frontend fundamentals',
  stack: ['JavaScript'],
  summary: 'Learn the fundamentals of the language and asynchronous work.',
  learningObjectives: ['Explain the difference between var, let and const'],
  requirements: [
    {
      id: 'R1',
      text: 'Understand syntax, variables and data types.',
      kind: 'learn',
      source: 'explicit',
      fromTopicIndexes: [1],
    },
    {
      id: 'R2',
      text: 'Be able to reason about the event loop.',
      kind: 'learn',
      source: 'implicit',
      reason: 'Promises cannot be understood without it.',
      fromTopicIndexes: [2],
    },
  ],
  deliverables: ['A short description for each topic'],
  topicInterpretations: [
    { index: 1, title: 'JavaScript Basics', interpretation: 'Read and write basic code.', isProject: false },
    {
      index: 2,
      title: 'Asynchronous Programming',
      interpretation: 'Reason about work that finishes later.',
      isProject: false,
    },
  ],
  project: { present: false, fromTopicIndexes: [] },
  assumedKnowledge: ['Using a code editor'],
  ambiguities: [],
};

/** A provider that answers with whatever the test wants, in order. */
function fakeProvider(replies: string[]): { provider: AiProvider; prompts: string[] } {
  const prompts: string[] = [];

  const provider: AiProvider = {
    name: 'fake',
    configured: true,
    async complete<T>(request: CompletionRequest<T>) {
      let calls = 0;

      for (const reply of replies) {
        calls += 1;
        prompts.push(request.user);
        const parsed = parseAs(request.schema, reply);

        if (parsed.ok) {
          return { value: parsed.value, ms: 1, calls, repaired: calls > 1 };
        }
      }

      throw new AiError('invalid-output', 'The model could not produce valid output.', true);
    },
  };

  return { provider, prompts };
}

describe('json handling', () => {
  it('finds the object inside prose and code fences', () => {
    expect(extractJson('```json\n{"a":1}\n```')).toBe('{"a":1}');
    expect(extractJson('Here you go:\n{"a":{"b":2}}\nHope that helps.')).toBe('{"a":{"b":2}}');
  });

  it('is not confused by braces inside strings', () => {
    expect(extractJson('{"a":"} not the end {"}')).toBe('{"a":"} not the end {"}');
  });

  it('returns null when there is no object at all', () => {
    expect(extractJson('I cannot help with that.')).toBeNull();
  });

  it('explains a schema failure in terms the model can act on', () => {
    const result = parseAs(taskUnderstandingSchema, JSON.stringify({ ...VALID_ANSWER, requirements: [{ id: 'REQ-1' }] }));

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toContain('requirements.0.id');
  });

  it('can describe the understanding schema for a prompt', () => {
    const text = schemaForPrompt(taskUnderstandingSchema);

    expect(text).toContain('requirements');
    expect(text).toContain('learningObjectives');
  });
});

describe('the understand prompt', () => {
  it('carries every topic, with its number and content', () => {
    const prompt = buildUnderstandPrompt(TASK);

    expect(prompt).toContain('Topic 1: JavaScript Basics');
    expect(prompt).toContain('Topic 2: Asynchronous Programming');
    expect(prompt).toContain('async/await');
  });

  it('flags a topic whose content could not be read', () => {
    const prompt = buildUnderstandPrompt({
      ...TASK,
      topics: [{ ...(TASK.topics[0] as (typeof TASK.topics)[number]), complete: false }],
    });

    expect(prompt).toContain('could not be fully read');
  });

  it('forbids inventing requirements', () => {
    expect(UNDERSTAND_SYSTEM).toMatch(/never invent/i);
  });
});

describe('running the stage', () => {
  it('returns a validated understanding', async () => {
    const { provider } = fakeProvider([JSON.stringify(VALID_ANSWER)]);

    const result = await runUnderstand(provider, TASK);

    expect(result.value.requirements).toHaveLength(2);
    expect(result.value.project.present).toBe(false);
    expect(result.repaired).toBe(false);
  });

  it('keeps the titles we read from the page, not the ones the model wrote', async () => {
    // The model was told to echo them and got them wrong on purpose here. These
    // are facts already observed; accepting a paraphrase would let it spread
    // through every later stage.
    const { provider } = fakeProvider([JSON.stringify(VALID_ANSWER)]);

    const result = await runUnderstand(provider, TASK);

    expect(result.value.taskTitle).toBe('Basics of JavaScript');
    expect(result.value.moduleTitle).toBe('Module 26');
  });

  it('repairs an invalid answer instead of trusting it', async () => {
    const broken = JSON.stringify({ ...VALID_ANSWER, requirements: [{ id: 'nope', text: '' }] });
    const { provider } = fakeProvider([broken, JSON.stringify(VALID_ANSWER)]);

    const result = await runUnderstand(provider, TASK);

    expect(result.repaired).toBe(true);
    expect(result.value.requirements).toHaveLength(2);
  });

  it('fails loudly when the model will not produce the shape', async () => {
    const { provider } = fakeProvider(['not json', 'still not json']);

    await expect(runUnderstand(provider, TASK)).rejects.toThrow(AiError);
  });

  it('never returns a half-shaped object', async () => {
    // Missing requirements entirely: the schema is the wall, and a stage that
    // cannot clear it must fail rather than hand a gap to the next one.
    const partial = JSON.stringify({ summary: 'Learn JavaScript.', domain: 'frontend' });
    const { provider } = fakeProvider([partial, partial]);

    await expect(runUnderstand(provider, TASK)).rejects.toThrow(/TaskUnderstanding|valid/i);
  });
});
