import {
  fiveDayPlanSchema,
  knowledgeMapSchema,
  practicePlanSchema,
  taskUnderstandingSchema,
  type ExtractedTechnicalTask,
  type FiveDayPlan,
  type KnowledgeMap,
  type PracticePlan,
  type TaskUnderstanding,
} from '@brotomap/shared';
import { z } from 'zod';

/**
 * Talking to the local server.
 *
 * The extension never holds the AI key and never calls a provider: it hands the
 * extracted task to a server on this machine and gets back a validated object.
 * That is the whole reason the server exists.
 *
 * This runs in the roadmap tab rather than the service worker, because the
 * worker is terminated when idle and a pipeline run outlives it.
 */

const DEFAULT_BASE_URL = 'http://localhost:8787';

const understandResponseSchema = z.object({
  ok: z.literal(true),
  understanding: taskUnderstandingSchema,
  meta: z.object({ ms: z.number(), calls: z.number(), repaired: z.boolean() }),
});

const errorResponseSchema = z.object({
  error: z.object({ code: z.string(), message: z.string(), retryable: z.boolean() }),
});

export interface ApiFailure {
  ok: false;
  code: string;
  message: string;
  retryable: boolean;
}

export type UnderstandResult =
  | { ok: true; understanding: TaskUnderstanding; ms: number; repaired: boolean }
  | ApiFailure;

const knowledgeResponseSchema = z.object({
  ok: z.literal(true),
  understanding: taskUnderstandingSchema,
  knowledge: knowledgeMapSchema,
  meta: z.object({ ms: z.number(), cached: z.boolean().optional(), gapsFound: z.number().optional() }),
});

export type KnowledgeResult =
  | {
      ok: true;
      understanding: TaskUnderstanding;
      knowledge: KnowledgeMap;
      ms: number;
      cached: boolean;
      gapsFound: number;
    }
  | ApiFailure;

/**
 * Stages 1 and 2 in one request.
 *
 * The server holds the intermediate understanding and caches it, so asking for
 * the map does not mean the caller has to carry state between two calls.
 */
const jobStartSchema = z.object({ ok: z.literal(true), jobId: z.string().min(1) });

const jobStateSchema = z.object({
  ok: z.literal(true),
  job: z.discriminatedUnion('status', [
    z.object({ status: z.literal('running'), startedAt: z.number(), detail: z.string() }),
    z.object({
      status: z.literal('done'),
      finishedAt: z.number(),
      ms: z.number(),
      value: z.object({
        understanding: taskUnderstandingSchema,
        knowledge: knowledgeMapSchema,
        practice: practicePlanSchema,
        plan: fiveDayPlanSchema,
        cached: z.boolean(),
        gapsFound: z.number(),
      }),
    }),
    z.object({
      status: z.literal('failed'),
      code: z.string(),
      message: z.string(),
      retryable: z.boolean(),
    }),
  ]),
});

export type JobState = z.infer<typeof jobStateSchema>['job'];

/**
 * Hands the work over and gets a ticket back.
 *
 * The point of the ticket: nothing in the browser has to stay alive while the
 * pipeline runs. The popup can close, the worker can be killed, Chrome can be
 * restarted - the answer is waiting on the server whenever anything asks again.
 */
export async function startRoadmap(
  task: ExtractedTechnicalTask,
  baseUrl = DEFAULT_BASE_URL,
): Promise<{ ok: true; jobId: string } | ApiFailure> {
  const result = await post(`${baseUrl}/api/roadmap/start`, task);

  if (!result.ok) {
    return result.failure;
  }

  const parsed = jobStartSchema.safeParse(result.body);

  return parsed.success
    ? { ok: true, jobId: parsed.data.jobId }
    : { ok: false, code: 'BAD_RESPONSE', message: 'The server returned something unexpected.', retryable: true };
}

export async function readRoadmapJob(
  jobId: string,
  baseUrl = DEFAULT_BASE_URL,
): Promise<{ ok: true; job: JobState } | ApiFailure> {
  let response: Response;

  try {
    response = await fetch(`${baseUrl}/api/roadmap/job/${jobId}`);
  } catch {
    return {
      ok: false,
      code: 'SERVER_UNREACHABLE',
      message: 'The Brotomap server is not running. Start it with "npm run server" and try again.',
      retryable: true,
    };
  }

  const body: unknown = await response.json().catch(() => null);
  const parsed = jobStateSchema.safeParse(body);

  if (parsed.success) {
    return { ok: true, job: parsed.data.job };
  }

  const error = errorResponseSchema.safeParse(body);

  return error.success
    ? { ok: false, ...error.data.error }
    : { ok: false, code: 'BAD_RESPONSE', message: 'The server returned something unexpected.', retryable: true };
}

const notionResponseSchema = z.object({ ok: z.literal(true), url: z.string() });

/**
 * Sends the finished roadmap to Notion.
 *
 * The roadmap goes over rather than the task: the page must say exactly what
 * the student read, and regenerating it to build the page would risk a page
 * that quietly differs from the screen it came from.
 */
export async function saveToNotion(
  payload: {
    moduleTitle: string;
    taskTitle: string;
    understanding: TaskUnderstanding;
    knowledge: KnowledgeMap;
    practice?: PracticePlan;
    plan?: FiveDayPlan;
  },
  baseUrl = DEFAULT_BASE_URL,
): Promise<{ ok: true; url: string } | ApiFailure> {
  const result = await post(`${baseUrl}/api/roadmap/notion`, payload);

  if (!result.ok) {
    return result.failure;
  }

  const parsed = notionResponseSchema.safeParse(result.body);

  return parsed.success
    ? { ok: true, url: parsed.data.url }
    : { ok: false, code: 'BAD_RESPONSE', message: 'The server returned something unexpected.', retryable: true };
}

export async function requestKnowledgeMap(
  task: ExtractedTechnicalTask,
  baseUrl = DEFAULT_BASE_URL,
): Promise<KnowledgeResult> {
  const result = await post(`${baseUrl}/api/stage/discover`, task);

  if (!result.ok) {
    return result.failure;
  }

  const parsed = knowledgeResponseSchema.safeParse(result.body);

  return parsed.success
    ? {
        ok: true,
        understanding: parsed.data.understanding,
        knowledge: parsed.data.knowledge,
        ms: parsed.data.meta.ms,
        cached: parsed.data.meta.cached ?? false,
        gapsFound: parsed.data.meta.gapsFound ?? 0,
      }
    : {
        ok: false,
        code: 'BAD_RESPONSE',
        message: 'The server returned something unexpected.',
        retryable: true,
      };
}

/** One place that knows how this server reports success and failure. */
async function post(
  url: string,
  body: unknown,
): Promise<{ ok: true; body: unknown } | { ok: false; failure: ApiFailure }> {
  let response: Response;

  try {
    response = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
  } catch {
    // The commonest failure by far, and the one with the clearest fix.
    return {
      ok: false,
      failure: {
        ok: false,
        code: 'SERVER_UNREACHABLE',
        message: 'The Brotomap server is not running. Start it with "npm run server" and try again.',
        retryable: true,
      },
    };
  }

  const parsedBody: unknown = await response.json().catch(() => null);

  if (response.ok) {
    return { ok: true, body: parsedBody };
  }

  const error = errorResponseSchema.safeParse(parsedBody);

  return {
    ok: false,
    failure: error.success
      ? { ok: false, ...error.data.error }
      : {
          ok: false,
          code: 'SERVER_ERROR',
          message: `The server returned ${response.status}.`,
          retryable: true,
        },
  };
}

export async function requestUnderstanding(
  task: ExtractedTechnicalTask,
  baseUrl = DEFAULT_BASE_URL,
): Promise<UnderstandResult> {
  let response: Response;

  try {
    response = await fetch(`${baseUrl}/api/stage/understand`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(task),
    });
  } catch {
    // The commonest failure by far, and the one with the clearest fix.
    return {
      ok: false,
      code: 'SERVER_UNREACHABLE',
      message: 'The Brotomap server is not running. Start it with "npm run server" and try again.',
      retryable: true,
    };
  }

  const body: unknown = await response.json().catch(() => null);

  if (response.ok) {
    const parsed = understandResponseSchema.safeParse(body);

    return parsed.success
      ? {
          ok: true,
          understanding: parsed.data.understanding,
          ms: parsed.data.meta.ms,
          repaired: parsed.data.meta.repaired,
        }
      : {
          ok: false,
          code: 'BAD_RESPONSE',
          message: 'The server returned something unexpected.',
          retryable: true,
        };
  }

  const parsed = errorResponseSchema.safeParse(body);

  return parsed.success
    ? { ok: false, ...parsed.data.error }
    : {
        ok: false,
        code: 'SERVER_ERROR',
        message: `The server returned ${response.status}.`,
        retryable: true,
      };
}
