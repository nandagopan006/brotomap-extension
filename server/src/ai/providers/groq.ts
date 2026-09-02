import { modelFor, type Env } from '../../config/env.js';
import { parseAs, schemaForPrompt } from '../json.js';
import { AiError, type AiProvider, type CompletionRequest, type CompletionResult } from '../provider.js';

/**
 * GROQ — the only file in the project that knows a vendor exists.
 *
 * No SDK: the API is OpenAI-compatible and Node has fetch, so a dependency here
 * would buy nothing and would have to be trusted with the key.
 */

const ENDPOINT = 'https://api.groq.com/openai/v1/chat/completions';
const MODELS_ENDPOINT = 'https://api.groq.com/openai/v1/models';

/** Below this an answer is too short to be worth returning. */
const MIN_TOKENS = 1500;

function isOverBudget(status: number, body: string): boolean {
  return status === 413 || /request too large|tokens per minute|TPM/i.test(body);
}

const DEFAULTS = {
  timeoutMs: 45_000,
  maxAttempts: 3,
  backoffMs: 800,
} as const;

interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

interface ChatResponse {
  choices?: { message?: { content?: string } }[];
  error?: { message?: string; code?: string };
}

export function createGroqProvider(env: Env): AiProvider {
  const key = env.AI_API_KEY;

  return {
    name: 'groq',
    configured: typeof key === 'string' && key.length > 0,

    async complete<T>(request: CompletionRequest<T>): Promise<CompletionResult<T>> {
      if (key === undefined || key.length === 0) {
        throw new AiError(
          'no-credentials',
          'No AI key is configured. Add AI_API_KEY to server/.env.',
          false,
        );
      }

      const started = Date.now();
      const model = modelFor(env, request.model);
      const deadline = started + (request.timeoutMs ?? DEFAULTS.timeoutMs);
      const maxTokens = request.maxTokens ?? env.AI_MAX_TOKENS;

      const messages: ChatMessage[] = [
        { role: 'system', content: request.system },
        { role: 'user', content: withSchema(request) },
      ];

      let calls = 0;
      let lastReason = '';

      // Two rounds: the answer, then one repair told exactly what was wrong.
      // A model that cannot produce the shape twice will not produce it on the
      // third attempt either, and the student is waiting.
      for (let round = 0; round < 2; round += 1) {
        const text = await send(key, model, messages, deadline, maxTokens);
        calls += 1;

        const parsed = parseAs(request.schema, text);

        if (parsed.ok) {
          return { value: parsed.value, ms: Date.now() - started, calls, repaired: round > 0 };
        }

        lastReason = parsed.reason;

        if (env.NODE_ENV !== 'production') {
          // The reason a first answer failed is the most useful signal there is
          // for improving a prompt, and it is invisible unless it is said.
          console.warn(`[ai] repairing ${request.schemaName}: ${parsed.reason.slice(0, 400)}`);
        }
        messages.push({ role: 'assistant', content: text.slice(0, 4000) });
        messages.push({
          role: 'user',
          content: `${parsed.reason}\n\nReturn the corrected JSON object only. No prose, no code fences.`,
        });
      }

      throw new AiError('invalid-output', `The model could not produce valid ${request.schemaName}. ${lastReason}`, true);
    },
  };
}

/** The shape, restated where the model will actually read it. */
function withSchema<T>(request: CompletionRequest<T>): string {
  const schema = schemaForPrompt(request.schema);

  if (schema === '') {
    return request.user;
  }

  return `${request.user}

Return a single JSON object matching this JSON Schema for ${request.schemaName}.
Return the object only: no prose, no explanation, no code fences.

${schema}`;
}

async function send(
  key: string,
  model: string,
  messages: ChatMessage[],
  deadline: number,
  maxTokens: number,
): Promise<string> {
  let lastError: AiError | null = null;

  for (let attempt = 0; attempt < DEFAULTS.maxAttempts; attempt += 1) {
    if (Date.now() >= deadline) {
      throw new AiError('timeout', 'The AI provider took too long to answer.', true);
    }

    try {
      return await postOnce(key, model, messages, deadline, { jsonMode: true, maxTokens });
    } catch (error) {
      if (!(error instanceof AiError) || !error.retryable) {
        throw error;
      }

      lastError = error;

      // The provider's own figure when it gave one, an exponential backoff
      // otherwise, and never past the deadline.
      const wait = error.retryAfterMs ?? DEFAULTS.backoffMs * 2 ** attempt;
      const remaining = deadline - Date.now();

      if (wait > remaining) {
        throw error;
      }

      await sleep(wait);
    }
  }

  throw lastError ?? new AiError('unavailable', 'The AI provider could not be reached.', true);
}

interface PostOptions {
  /** Ask the provider to enforce JSON. Dropped on retry when it refuses. */
  jsonMode: boolean;
  maxTokens: number;
}

async function postOnce(
  key: string,
  model: string,
  messages: ChatMessage[],
  deadline: number,
  options: PostOptions,
): Promise<string> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), Math.max(1000, deadline - Date.now()));

  try {
    const response = await fetch(ENDPOINT, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${key}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        model,
        messages,
        temperature: 0.2,
        max_completion_tokens: options.maxTokens,
        // Reasoning models spend tokens thinking before answering. Left high,
        // the thinking consumes the budget the answer needed.
        ...(/gpt-oss|qwen3/i.test(model) ? { reasoning_effort: 'low' } : {}),
        ...(options.jsonMode ? { response_format: { type: 'json_object' } } : {}),
      }),
      signal: controller.signal,
    });

    if (!response.ok) {
      const body = await safeText(response);
      const retryAfter = retryAfterMs(response);

      // The provider refusing its own JSON mode is not a reason to fail: the
      // schema is restated in the prompt and the reply is validated here
      // regardless, so the mode is a convenience, not the guarantee.
      if (options.jsonMode && /json_validate_failed|response_format/i.test(body)) {
        return postOnce(key, model, messages, deadline, { ...options, jsonMode: false });
      }

      // Too large for the plan's per-minute budget. That budget differs by
      // provider and by tier, so the right size is not something to hard-code -
      // ask for a shorter answer and try again, down to a floor below which the
      // answer would be useless anyway.
      if (isOverBudget(response.status, body) && options.maxTokens > MIN_TOKENS) {
        const smaller = Math.max(MIN_TOKENS, Math.floor(options.maxTokens * 0.6));
        return postOnce(key, model, messages, deadline, { ...options, maxTokens: smaller });
      }

      throw describeHttpFailure(response.status, body, model, retryAfter);
    }

    const body = (await response.json()) as ChatResponse;
    const content = body.choices?.[0]?.message?.content;

    if (typeof content !== 'string' || content.length === 0) {
      throw new AiError('invalid-output', 'The AI provider returned an empty answer.', true);
    }

    return content;
  } catch (error) {
    if (error instanceof AiError) {
      throw error;
    }

    if (error instanceof Error && error.name === 'AbortError') {
      throw new AiError('timeout', 'The AI provider took too long to answer.', true);
    }

    throw new AiError(
      'unavailable',
      `Could not reach the AI provider: ${error instanceof Error ? error.message : 'unknown error'}.`,
      true,
    );
  } finally {
    clearTimeout(timer);
  }
}

/** Provider errors, translated once, here, into something a student can act on. */
/** Seconds, or an HTTP date, in a header the provider is not obliged to send. */
function retryAfterMs(response: Response): number | undefined {
  const header = response.headers.get('retry-after');

  if (header === null) {
    return undefined;
  }

  const seconds = Number(header);

  if (Number.isFinite(seconds)) {
    return Math.max(0, seconds * 1000);
  }

  const date = Date.parse(header);
  return Number.isNaN(date) ? undefined : Math.max(0, date - Date.now());
}

function describeHttpFailure(
  status: number,
  body: string,
  model: string,
  retryAfter?: number,
): AiError {
  if (status === 401 || status === 403) {
    return new AiError('no-credentials', 'The AI key was rejected. Check AI_API_KEY in server/.env.', false);
  }

  if (status === 404 || /model.*(not found|does not exist|decommissioned)/i.test(body)) {
    return new AiError(
      'model-not-found',
      `The model "${model}" is not available. Run "npm run models -w @brotomap/server" to see the current list, then set AI_MODEL in server/.env.`,
      false,
    );
  }

  if (status === 429) {
    return new AiError(
      'rate-limited',
      retryAfter === undefined
        ? 'The AI provider is rate limiting. Wait a minute and try again.'
        : `The AI provider is rate limiting. It asked to wait ${Math.ceil(retryAfter / 1000)}s - try again after that.`,
      true,
      retryAfter,
    );
  }

  // A free tier counts prompt + requested answer against a per-minute budget,
  // so this is about the size of one request, not about the account.
  if (isOverBudget(status, body)) {
    return new AiError(
      'rate-limited',
      'The request was larger than the provider allows per minute. Lower AI_MAX_TOKENS in server/.env, or wait a minute and retry.',
      true,
      retryAfter,
    );
  }

  if (status >= 500) {
    return new AiError('unavailable', `The AI provider returned ${status}.`, true);
  }

  return new AiError('unavailable', `The AI provider returned ${status}: ${body.slice(0, 200)}`, false);
}

async function safeText(response: Response): Promise<string> {
  try {
    return await response.text();
  } catch {
    return '';
  }
}

const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, Math.max(0, ms)));

/**
 * The models this key can actually use.
 *
 * Providers rename and decommission models regularly, so the id in .env is a
 * guess until it is checked. `npm run models` prints this list.
 */
export async function listModels(env: Env): Promise<string[]> {
  if (env.AI_API_KEY === undefined) {
    throw new AiError('no-credentials', 'No AI key is configured.', false);
  }

  const response = await fetch(MODELS_ENDPOINT, {
    headers: { authorization: `Bearer ${env.AI_API_KEY}` },
  });

  if (!response.ok) {
    throw describeHttpFailure(response.status, await safeText(response), 'n/a');
  }

  const body = (await response.json()) as { data?: { id?: string }[] };

  return (body.data ?? [])
    .map((entry) => entry.id)
    .filter((id): id is string => typeof id === 'string')
    .sort();
}
