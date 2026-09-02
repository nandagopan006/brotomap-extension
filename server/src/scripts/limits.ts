import { loadEnv } from '../config/env.js';
import { listModels } from '../ai/providers/groq.js';

/**
 * What each model will actually let us ask for.
 *
 * A per-minute token budget decides the shape of the pipeline: whether a
 * knowledge map can be one call or has to be several. That figure is not in the
 * model list - it comes back in the rate-limit headers of a real request - so
 * this sends the smallest possible one to each model and reads them.
 */

interface Limits {
  model: string;
  tokensPerMinute: number | null;
  /** What is left in the current window - the number that decides if a run works now. */
  tokensLeft: number | null;
  requestsPerMinute: number | null;
  error?: string;
}

async function probe(key: string, model: string): Promise<Limits> {
  try {
    const response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: { authorization: `Bearer ${key}`, 'content-type': 'application/json' },
      body: JSON.stringify({
        model,
        messages: [{ role: 'user', content: 'hi' }],
        max_completion_tokens: 1,
      }),
    });

    const number = (header: string): number | null => {
      const raw = response.headers.get(header);
      return raw === null ? null : Number(raw.replace(/[^0-9.]/g, ''));
    };

    if (!response.ok && response.status !== 429) {
      return {
        model,
        tokensPerMinute: number('x-ratelimit-limit-tokens'),
        tokensLeft: number('x-ratelimit-remaining-tokens'),
        requestsPerMinute: number('x-ratelimit-limit-requests'),
        error: `${response.status}`,
      };
    }

    return {
      model,
      tokensPerMinute: number('x-ratelimit-limit-tokens'),
      tokensLeft: number('x-ratelimit-remaining-tokens'),
      requestsPerMinute: number('x-ratelimit-limit-requests'),
    };
  } catch (error) {
    return {
      model,
      tokensPerMinute: null,
      tokensLeft: null,
      requestsPerMinute: null,
      error: error instanceof Error ? error.message : 'failed',
    };
  }
}

async function main(): Promise<void> {
  const env = loadEnv();

  if (env.AI_API_KEY === undefined) {
    throw new Error('No AI_API_KEY in server/.env.');
  }

  // Chat models only: transcription and guard models cannot answer a prompt.
  const models = (await listModels(env)).filter(
    (model) => !/whisper|prompt-guard|orpheus|tts/i.test(model),
  );

  console.log(`\nProbing ${models.length} chat models for their per-minute budgets...\n`);
  console.log('  tokens/min    left now   req/min   model');

  const results: Limits[] = [];

  for (const model of models) {
    const limits = await probe(env.AI_API_KEY, model);
    results.push(limits);
    console.log(
      `  ${String(limits.tokensPerMinute ?? '?').padStart(10)}   ${String(limits.tokensLeft ?? '?').padStart(9)}   ${String(limits.requestsPerMinute ?? '?').padStart(7)}   ${model}${limits.error === undefined ? '' : `  (${limits.error})`}`,
    );
  }

  const best = results
    .filter((limits) => limits.error === undefined && limits.tokensPerMinute !== null)
    .sort((left, right) => (right.tokensPerMinute ?? 0) - (left.tokensPerMinute ?? 0))[0];

  console.log(
    best === undefined
      ? '\nNo model reported a budget.\n'
      : `\nMost room: ${best.model} at ${best.tokensPerMinute} tokens/min.\n` +
          `A knowledge map needs roughly 7000 in one request, so anything at or above that can do it in a single call.\n`,
  );
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
