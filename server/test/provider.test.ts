import { z } from 'zod';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AiError } from '../src/ai/provider.js';
import { createGroqProvider } from '../src/ai/providers/groq.js';
import { describe as describeError } from '../src/http/errors.js';
import type { Env } from '../src/config/env.js';

/**
 * The provider's failure paths, without a network.
 *
 * These are the paths a student actually meets - a wrong key, a decommissioned
 * model, a rate limit - and they are the ones a live test can never trigger on
 * purpose. Each has to produce a message that says what to do next.
 */

const ENV: Env = {
  NODE_ENV: 'test',
  PORT: 8787,
  AI_API_KEY: 'test-key',
  AI_MODEL: 'openai/gpt-oss-20b',
  ALLOWED_ORIGINS: '',
  WEEKLY_HOURS: 25,
  CACHE_DIR: '.cache',
  AI_MAX_TOKENS: 3000,
  allowedOrigins: [],
};

const schema = z.object({ answer: z.string() });

function reply(content: string, status = 200): Response {
  return new Response(JSON.stringify({ choices: [{ message: { content } }] }), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

function failure(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

/**
 * A Response body can only be read once, so every stub must build a fresh one.
 * Reusing a single object made a retry look like a network failure and sent the
 * provider round its retry loop - a test artefact, but a convincing one.
 */
function always(build: () => Response) {
  return vi.fn().mockImplementation(() => Promise.resolve(build()));
}

function ask(timeoutMs = 5000) {
  return createGroqProvider(ENV).complete({
    system: 'be helpful',
    user: 'answer',
    schema,
    schemaName: 'Answer',
    temperature: 0,
    model: 'fast',
    timeoutMs,
  });
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('a working call', () => {
  it('returns the parsed value', async () => {
    vi.stubGlobal('fetch', always(() => reply('{"answer":"yes"}')));

    const result = await ask();

    expect(result.value.answer).toBe('yes');
    expect(result.calls).toBe(1);
    expect(result.repaired).toBe(false);
  });

  it('does not send the key in the body, only the header', async () => {
    const fetchMock = always(() => reply('{"answer":"yes"}'));
    vi.stubGlobal('fetch', fetchMock);

    await ask();

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(String(init.body)).not.toContain('test-key');
    expect((init.headers as Record<string, string>)['authorization']).toContain('test-key');
  });
});

describe('when the model will not produce the shape', () => {
  it('repairs once, telling the model exactly what was wrong', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(reply('{"answer":42}'))
      .mockResolvedValueOnce(reply('{"answer":"fixed"}'));
    vi.stubGlobal('fetch', fetchMock);

    const result = await ask();

    expect(result.value.answer).toBe('fixed');
    expect(result.repaired).toBe(true);

    const [, second] = fetchMock.mock.calls[1] as [string, RequestInit];
    expect(String(second.body)).toContain('answer');
  });

  it('gives up after one repair rather than looping', async () => {
    const fetchMock = always(() => reply('not json at all'));
    vi.stubGlobal('fetch', fetchMock);

    await expect(ask()).rejects.toThrow(AiError);
    // One answer, one repair. Not a third attempt at a model that has already
    // shown it will not comply.
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});

describe('provider failures become advice', () => {
  it('a rejected key says which file to check', async () => {
    vi.stubGlobal('fetch', always(() => failure(401, { error: { message: 'invalid api key' } })));

    await expect(ask()).rejects.toMatchObject({
      failure: 'no-credentials',
      retryable: false,
      message: expect.stringContaining('server/.env'),
    });
  });

  it('a decommissioned model says how to find a working one', async () => {
    vi.stubGlobal(
      'fetch',
      always(() => failure(400, { error: { message: 'The model `x` has been decommissioned' } })),
    );

    await expect(ask()).rejects.toMatchObject({
      failure: 'model-not-found',
      retryable: false,
      message: expect.stringContaining('npm run models'),
    });
  });

  it('a rate limit is retried before it is reported', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(failure(429, { error: { message: 'slow down' } }))
      .mockResolvedValueOnce(reply('{"answer":"eventually"}'));
    vi.stubGlobal('fetch', fetchMock);

    const result = await ask();

    expect(result.value.answer).toBe('eventually');
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('an empty answer is a failure, not an empty result', async () => {
    vi.stubGlobal('fetch', always(() => reply('')));

    // Short deadline: an empty answer is treated as transient and retried, and
    // the point here is that it eventually fails rather than returning nothing.
    await expect(ask(900)).rejects.toThrow(AiError);
  });
});

describe('the provider refusing its own JSON mode', () => {
  it('retries without it rather than failing', async () => {
    // Observed live: a truncated answer is reported as "failed to validate
    // JSON" with an empty body. The schema is in the prompt and the reply is
    // validated here anyway, so the mode is a convenience, not the guarantee.
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(failure(400, { error: { code: 'json_validate_failed' } }))
      .mockResolvedValueOnce(reply('{"answer":"without json mode"}'));
    vi.stubGlobal('fetch', fetchMock);

    const result = await ask();

    expect(result.value.answer).toBe('without json mode');

    const [, retry] = fetchMock.mock.calls[1] as [string, RequestInit];
    expect(String(retry.body)).not.toContain('response_format');
  });
});

describe('no credentials at all', () => {
  it('fails before reaching the network', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    const provider = createGroqProvider({ ...ENV, AI_API_KEY: undefined });

    expect(provider.configured).toBe(false);
    await expect(
      provider.complete({
        system: 's',
        user: 'u',
        schema,
        schemaName: 'Answer',
        temperature: 0,
        model: 'fast',
      }),
    ).rejects.toMatchObject({ failure: 'no-credentials' });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe('errors that leave the server', () => {
  it('never carry a stack trace', () => {
    const { body } = describeError(new Error('secret internal detail at /home/user/thing.ts:42'));

    expect(JSON.stringify(body)).not.toContain('secret internal detail');
    expect(body.error.code).toBe('INTERNAL');
  });

  it('explain an oversized request in terms of what should have been sent', () => {
    const { status, body } = describeError({ status: 413 });

    expect(status).toBe(413);
    expect(body.error.message).toMatch(/never page html/i);
  });

  it('map an AI failure onto a sensible status', () => {
    expect(describeError(new AiError('rate-limited', 'slow down', true)).status).toBe(429);
    expect(describeError(new AiError('timeout', 'too slow', true)).status).toBe(504);
    expect(describeError(new AiError('no-credentials', 'no key', false)).status).toBe(503);
  });
});
