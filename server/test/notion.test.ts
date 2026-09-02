import type { KnowledgeMap, TaskUnderstanding } from '@brotomap/shared';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { buildRoadmapPage, type NotionBlock } from '../src/notion/blocks.js';
import { NotionError, createRoadmapPage, normaliseId } from '../src/notion/client.js';
import type { Env } from '../src/config/env.js';

/**
 * The Notion export, without Notion.
 *
 * What matters here is the shape of what is sent and the wording of what comes
 * back. Notion's failures are almost all setup mistakes with a specific fix,
 * and a student who is told "400" learns nothing.
 */

const ENV: Env = {
  NODE_ENV: 'test',
  PORT: 8787,
  AI_MODEL: 'test-model',
  ALLOWED_ORIGINS: '',
  WEEKLY_HOURS: 25,
  CACHE_DIR: '.cache',
  AI_MAX_TOKENS: 3000,
  NOTION_TOKEN: 'ntn_test',
  NOTION_PARENT_PAGE_ID: '1234567890abcdef1234567890abcdef',
  allowedOrigins: [],
};

const UNDERSTANDING: TaskUnderstanding = {
  moduleTitle: 'Module 26',
  taskTitle: 'Basics of JavaScript',
  domain: 'web',
  stack: ['JavaScript'],
  summary: 'Learn the fundamentals.',
  learningObjectives: ['Explain var, let and const'],
  requirements: [
    { id: 'R1', text: 'Understand data types.', kind: 'learn', source: 'explicit', fromTopicIndexes: [1] },
    {
      id: 'R2',
      text: 'Reason about the event loop.',
      kind: 'learn',
      source: 'implicit',
      reason: 'Promises need it.',
      fromTopicIndexes: [2],
    },
  ],
  deliverables: [],
  topicInterpretations: [],
  project: { present: false, fromTopicIndexes: [] },
  assumedKnowledge: [],
  ambiguities: ['Which Node version is expected?'],
};

function node(id: string, category: 'explicit' | 'supporting' | 'optional'): KnowledgeMap['nodes'][number] {
  return {
    id,
    title: id,
    parentId: null,
    level: 'topic',
    category,
    difficulty: 'basic',
    summary: `About ${id}.`,
    whyItMatters: `Needed for ${id}.`,
    status: 'learn',
    effortMinutes: 30,
    prerequisites: [],
    coversRequirements: [],
    coversTopicIndexes: [],
    resources: [],
    priority: 'P0',
    depth: 0,
  };
}

const KNOWLEDGE: KnowledgeMap = {
  nodes: [node('t-syntax', 'explicit'), node('t-hoisting', 'supporting')],
  sequence: ['t-syntax', 't-hoisting'],
  brokenEdges: [],
  totals: {
    nodeCount: 2,
    effortMinutes: 60,
    byCategory: { explicit: 1, supporting: 1, optional: 0 },
    byDifficulty: { basic: 2, medium: 0, advanced: 0 },
  },
};

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('the page that gets built', () => {
  const page = buildRoadmapPage('Module 26', 'Basics of JavaScript', UNDERSTANDING, KNOWLEDGE);

  it('is titled after the task and the module', () => {
    expect(page.title).toBe('Basics of JavaScript — Module 26');
  });

  it('turns the learning order into checkboxes', () => {
    // The reason to prefer a page to a document: it becomes a record of what
    // has been learned rather than of what was assigned.
    const todos = page.blocks.filter((block) => block.type === 'to_do');

    expect(todos).toHaveLength(KNOWLEDGE.sequence.length);
  });

  it('keeps what the task did not say, with the reason it matters', () => {
    const text = JSON.stringify(page.blocks);

    expect(text).toContain('What the task did not say');
    expect(text).toContain('Needed for t-hoisting.');
  });

  it('carries the requirements, marking the implied ones', () => {
    const text = JSON.stringify(page.blocks);

    expect(text).toContain('R1');
    expect(text).toContain('(implied)');
  });

  it('never exceeds what Notion accepts in one rich text value', () => {
    const long = { ...UNDERSTANDING, summary: 'x'.repeat(5000) };
    const built = buildRoadmapPage('M', 'T', long, KNOWLEDGE);

    for (const content of JSON.stringify(built.blocks).matchAll(/"content":"(.*?)"/g)) {
      expect((content[1] ?? '').length).toBeLessThanOrEqual(2000);
    }
  });
});

describe('page ids, copied from wherever', () => {
  it('accepts the bare form Notion puts in a URL', () => {
    expect(normaliseId('1234567890abcdef1234567890abcdef')).toBe(
      '12345678-90ab-cdef-1234-567890abcdef',
    );
  });

  it('accepts one that already has dashes', () => {
    expect(normaliseId('12345678-90ab-cdef-1234-567890abcdef')).toBe(
      '12345678-90ab-cdef-1234-567890abcdef',
    );
  });

  it('leaves something that is not an id alone, so the error names it', () => {
    expect(normaliseId('not-an-id')).toBe('not-an-id');
  });
});

describe('sending it', () => {
  function ok(body: unknown): Response {
    return new Response(JSON.stringify(body), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  }

  it('creates the page, then appends the rest a hundred at a time', async () => {
    // Notion takes at most 100 children per request, and a roadmap is longer.
    const many: NotionBlock[] = Array.from({ length: 250 }, () => ({
      object: 'block',
      type: 'paragraph',
      paragraph: { rich_text: [] },
    }));

    const fetchMock = vi
      .fn()
      .mockImplementation(() => Promise.resolve(ok({ id: 'page-1', url: 'https://notion.so/page-1' })));
    vi.stubGlobal('fetch', fetchMock);

    const created = await createRoadmapPage(ENV, { title: 'T', blocks: many });

    expect(created.url).toBe('https://notion.so/page-1');
    // One create plus two appends: 100 + 100 + 50.
    expect(fetchMock).toHaveBeenCalledTimes(3);

    const [, first] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(JSON.parse(String(first.body)).children).toHaveLength(100);
  });

  it('pins the API version, because Notion changes behaviour by version', async () => {
    const fetchMock = vi.fn().mockImplementation(() => Promise.resolve(ok({ id: 'p', url: 'u' })));
    vi.stubGlobal('fetch', fetchMock);

    await createRoadmapPage(ENV, { title: 'T', blocks: [] });

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect((init.headers as Record<string, string>)['notion-version']).toBe('2022-06-28');
  });

  it('refuses before sending anything when Notion is not configured', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    await expect(
      createRoadmapPage({ ...ENV, NOTION_TOKEN: undefined }, { title: 'T', blocks: [] }),
    ).rejects.toThrow(NotionError);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe('failures that are really setup mistakes', () => {
  function fails(status: number, body: string) {
    return vi
      .fn()
      .mockImplementation(() =>
        Promise.resolve(new Response(body, { status, headers: { 'content-type': 'application/json' } })),
      );
  }

  it('a page the integration was never given says how to give it', async () => {
    // By far the commonest mistake, and the one whose fix is least guessable.
    vi.stubGlobal('fetch', fails(404, '{"message":"Could not find page"}'));

    await expect(createRoadmapPage(ENV, { title: 'T', blocks: [] })).rejects.toThrow(
      /Connections/,
    );
  });

  it('a rejected token names the file to check', async () => {
    vi.stubGlobal('fetch', fails(401, '{"message":"API token is invalid"}'));

    await expect(createRoadmapPage(ENV, { title: 'T', blocks: [] })).rejects.toThrow(
      /server\/\.env/,
    );
  });

  it('a rate limit is retryable, a bad token is not', async () => {
    vi.stubGlobal('fetch', fails(429, '{}'));
    await expect(createRoadmapPage(ENV, { title: 'T', blocks: [] })).rejects.toMatchObject({
      retryable: true,
    });

    vi.stubGlobal('fetch', fails(401, '{}'));
    await expect(createRoadmapPage(ENV, { title: 'T', blocks: [] })).rejects.toMatchObject({
      retryable: false,
    });
  });
});
