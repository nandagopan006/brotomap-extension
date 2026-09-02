import express, { type Request, type Response } from 'express';
import { z } from 'zod';
import {
  MAX_REQUEST_BYTES,
  PIPELINE_VERSION,
  extractedTechnicalTaskSchema,
  DEFAULT_PLAN_OPTIONS,
  fiveDayPlanSchema,
  knowledgeMapSchema,
  practicePlanSchema,
  taskUnderstandingSchema,
  type FiveDayPlan,
  type KnowledgeMap,
  type PracticePlan,
  type TaskUnderstanding,
} from '@brotomap/shared';
import { hasAiCredentials, hasNotion, loadEnv, modelFor } from './config/env.js';
import { buildRoadmapPage } from './notion/blocks.js';
import { NotionError, createRoadmapPage } from './notion/client.js';
import { createGroqProvider } from './ai/providers/groq.js';
import { runDiscover } from './ai/stages/discover.js';
import { runPractice } from './ai/stages/practice.js';
import { runUnderstand } from './ai/stages/understand.js';
import { buildFiveDayPlan } from './planner/schedule.js';
import { cors } from './http/cors.js';
import { describe, errorHandler, notFound } from './http/errors.js';
import { rateLimit } from './http/rateLimit.js';
import { cacheKey, readCache, writeCache } from './services/cache.js';
import { Jobs } from './services/jobs.js';

/**
 * THE SERVER
 *
 * It exists for one reason: the AI key must not ship inside an extension.
 * Everything else is in service of that - it holds the key, it talks to the
 * provider, and it hands back validated objects.
 *
 * Routes do HTTP and nothing else. They never build a prompt and never reach
 * for a provider directly.
 */

const env = loadEnv();
const provider = createGroqProvider(env);
const app = express();

app.disable('x-powered-by');
app.use(cors(env));
app.use(express.json({ limit: MAX_REQUEST_BYTES }));

app.get('/api/health', (_request: Request, response: Response) => {
  response.json({
    ok: true,
    pipelineVersion: PIPELINE_VERSION,
    // The model, never the key.
    model: modelFor(env, 'fast'),
    aiConfigured: hasAiCredentials(env),
    // The extension offers the export only when there is somewhere to export to.
    notionConfigured: hasNotion(env),
  });
});

/**
 * One stage, on demand.
 *
 * Running a stage in isolation is what keeps the pipeline debuggable: when a
 * roadmap comes out wrong, "was it this stage?" has to be answerable in one
 * request rather than by reading a whole run.
 */
app.post(
  '/api/stage/understand',
  rateLimit(20, 10 * 60 * 1000),
  (request: Request, response: Response) => {
    void (async () => {
      const parsed = extractedTechnicalTaskSchema.safeParse(request.body);

      if (!parsed.success) {
        response.status(400).json({
          error: {
            code: 'BAD_REQUEST',
            message: 'The extracted task did not match the expected shape.',
            retryable: false,
          },
        });
        return;
      }

      // The cache key covers the task and the pipeline version, so editing a
      // prompt invalidates it and re-reading an unchanged task is free.
      const key = cacheKey('understand', parsed.data);
      const cached = await readCache<TaskUnderstanding>(env, 'understand', key);

      if (cached !== null && request.query['force'] !== '1') {
        response.json({
          ok: true,
          understanding: cached,
          meta: { ms: 0, calls: 0, repaired: false, cached: true },
        });
        return;
      }

      try {
        const result = await runUnderstand(provider, parsed.data);
        await writeCache(env, 'understand', key, result.value);

        response.json({
          ok: true,
          understanding: result.value,
          meta: { ms: result.ms, calls: result.calls, repaired: result.repaired, cached: false },
        });
      } catch (error) {
        const { status, body } = describe(error);
        response.status(status).json(body);
      }
    })();
  },
);

/**
 * Stage 2: the knowledge map.
 *
 * Takes the extracted task rather than an understanding, so the caller never
 * has to hold intermediate state - and stage 1 is cached, so asking for the map
 * twice costs one call, not two.
 */
app.post(
  '/api/stage/discover',
  rateLimit(20, 10 * 60 * 1000),
  (request: Request, response: Response) => {
    void (async () => {
      const parsed = extractedTechnicalTaskSchema.safeParse(request.body);

      if (!parsed.success) {
        response.status(400).json({
          error: {
            code: 'BAD_REQUEST',
            message: 'The extracted task did not match the expected shape.',
            retryable: false,
          },
        });
        return;
      }

      try {
        const understandKey = cacheKey('understand', parsed.data);
        let understanding = await readCache<TaskUnderstanding>(env, 'understand', understandKey);

        if (understanding === null) {
          const stage1 = await runUnderstand(provider, parsed.data);
          understanding = stage1.value;
          await writeCache(env, 'understand', understandKey, understanding);
        }

        const discoverKey = cacheKey('discover', understanding);
        const cached = await readCache<KnowledgeMap>(env, 'discover', discoverKey);

        if (cached !== null && request.query['force'] !== '1') {
          response.json({ ok: true, understanding, knowledge: cached, meta: { ms: 0, cached: true } });
          return;
        }

        const stage2 = await runDiscover(provider, understanding);
        await writeCache(env, 'discover', discoverKey, stage2.value);

        response.json({
          ok: true,
          understanding,
          knowledge: stage2.value,
          meta: {
            ms: stage2.ms,
            calls: stage2.calls,
            repaired: stage2.repaired,
            gapsFound: stage2.gapsFound,
            repairs: stage2.repairs,
            cached: false,
          },
        });
      } catch (error) {
        const { status, body } = describe(error);
        response.status(status).json(body);
      }
    })();
  },
);

interface RoadmapResult {
  understanding: TaskUnderstanding;
  knowledge: KnowledgeMap;
  practice: PracticePlan;
  plan: FiveDayPlan;
  cached: boolean;
  gapsFound: number;
}

/**
 * Practice is allowed to fail without taking the roadmap with it.
 *
 * A roadmap with topics and no exercises is worth having; losing the topics
 * because the exercises could not be written is not a trade worth making.
 */
async function practiceOrNone(
  understanding: TaskUnderstanding,
  knowledge: KnowledgeMap,
): Promise<PracticePlan> {
  const key = cacheKey('practice', knowledge);
  const cached = await readCache<PracticePlan>(env, 'practice', key);

  if (cached !== null) {
    return cached;
  }

  try {
    const result = await runPractice(provider, understanding, knowledge);
    await writeCache(env, 'practice', key, result.value);
    return result.value;
  } catch (error) {
    console.warn('[practice] skipped:', error instanceof Error ? error.message : error);
    return { items: [], totalEffortMinutes: 0 };
  }
}

const roadmapJobs = new Jobs<RoadmapResult>();

/**
 * Start the pipeline and answer at once with a ticket.
 *
 * Nothing in an extension survives a minute reliably, so nothing is asked to.
 * The work finishes here whether or not anybody is still listening.
 */
app.post(
  '/api/roadmap/start',
  rateLimit(20, 10 * 60 * 1000),
  (request: Request, response: Response) => {
    const parsed = extractedTechnicalTaskSchema.safeParse(request.body);

    if (!parsed.success) {
      response.status(400).json({
        error: {
          code: 'BAD_REQUEST',
          message: 'The extracted task did not match the expected shape.',
          retryable: false,
        },
      });
      return;
    }

    const task = parsed.data;

    const jobId = roadmapJobs.start(
      `Understanding "${task.task.title}"…`,
      async (progress) => {
        const understandKey = cacheKey('understand', task);
        let understanding = await readCache<TaskUnderstanding>(env, 'understand', understandKey);

        if (understanding === null) {
          const stage1 = await runUnderstand(provider, task);
          understanding = stage1.value;
          await writeCache(env, 'understand', understandKey, understanding);
        }

        progress('Building the knowledge map…');

        const discoverKey = cacheKey('discover', understanding);
        const cached = await readCache<KnowledgeMap>(env, 'discover', discoverKey);

        const knowledge = cached ?? (await runDiscover(provider, understanding)).value;

        if (cached === null) {
          await writeCache(env, 'discover', discoverKey, knowledge);
        }

        progress('Writing the practice…');
        const practice = await practiceOrNone(understanding, knowledge);

        // Pure arithmetic, so it is not worth caching and never worth an
        // apology: the same map and the same practice always give this week.
        const plan = buildFiveDayPlan(knowledge, practice, DEFAULT_PLAN_OPTIONS);

        return { understanding, knowledge, practice, plan, cached: cached !== null, gapsFound: 0 };
      },
      (error) => {
        const { body } = describe(error);
        return body.error;
      },
    );

    response.json({ ok: true, jobId });
  },
);

/** How that ticket is getting on. Cheap enough to ask about every second. */
app.get('/api/roadmap/job/:jobId', (request: Request, response: Response) => {
  const id = request.params['jobId'];
  const job = roadmapJobs.get(typeof id === 'string' ? id : '');

  if (job === null) {
    response.status(404).json({
      error: {
        code: 'NO_SUCH_JOB',
        message: 'That roadmap is no longer available. Generate it again.',
        retryable: true,
      },
    });
    return;
  }

  response.json({ ok: true, job });
});

const notionRequestSchema = z.object({
  moduleTitle: z.string(),
  taskTitle: z.string(),
  understanding: taskUnderstandingSchema,
  knowledge: knowledgeMapSchema,
  practice: practicePlanSchema.optional(),
  plan: fiveDayPlanSchema.optional(),
});

/**
 * The roadmap, as a Notion page.
 *
 * Takes the finished roadmap rather than the task: the page must say exactly
 * what the student read, and re-running the pipeline to produce it would risk
 * a page that quietly differs from the screen it came from.
 */
app.post('/api/roadmap/notion', rateLimit(20, 10 * 60 * 1000), (request: Request, response: Response) => {
  void (async () => {
    const parsed = notionRequestSchema.safeParse(request.body);

    if (!parsed.success) {
      response.status(400).json({
        error: { code: 'BAD_REQUEST', message: 'That roadmap did not match the expected shape.', retryable: false },
      });
      return;
    }

    if (!hasNotion(env)) {
      response.status(503).json({
        error: {
          code: 'NOTION_NOT_CONFIGURED',
          message: 'Notion is not set up. Add NOTION_TOKEN and NOTION_PARENT_PAGE_ID to server/.env.',
          retryable: false,
        },
      });
      return;
    }

    try {
      const page = buildRoadmapPage(
        parsed.data.moduleTitle,
        parsed.data.taskTitle,
        parsed.data.understanding,
        parsed.data.knowledge,
        parsed.data.practice,
        parsed.data.plan,
      );

      const created = await createRoadmapPage(env, page);
      response.json({ ok: true, url: created.url });
    } catch (error) {
      if (error instanceof NotionError) {
        response.status(error.retryable ? 502 : 400).json({
          error: { code: 'NOTION_FAILED', message: error.message, retryable: error.retryable },
        });
        return;
      }

      const { status, body } = describe(error);
      response.status(status).json(body);
    }
  })();
});

app.use(notFound);
app.use(errorHandler);

/**
 * Is something already on our port, and is it us?
 *
 * Binding first and reacting to EADDRINUSE was not good enough: on Windows the
 * listening callback fired anyway, so the terminal said "server on
 * http://localhost:8787" and then "port 8787 is already in use" - two lines
 * that contradict each other. Asking before binding gives one clear answer.
 */
async function whatIsOnThePort(port: number): Promise<'free' | 'brotomap' | 'something-else'> {
  try {
    const response = await fetch(`http://127.0.0.1:${port}/api/health`, {
      signal: AbortSignal.timeout(1500),
    });

    if (!response.ok) {
      return 'something-else';
    }

    const body = (await response.json()) as { pipelineVersion?: unknown };
    return typeof body.pipelineVersion === 'string' ? 'brotomap' : 'something-else';
  } catch (error) {
    // Nothing accepted the connection, which is what a free port looks like.
    return error instanceof Error && /fetch failed|ECONNREFUSED/i.test(error.message)
      ? 'free'
      : 'something-else';
  }
}

async function start(): Promise<void> {
  const occupant = await whatIsOnThePort(env.PORT);

  if (occupant === 'brotomap') {
    // The goal was a Brotomap server on this port. There is one. That is not a
    // failure, and reporting it as one buries the message in npm's error block.
    console.log(
      `Brotomap is already running on http://localhost:${env.PORT} - use that one.
` +
        `To stop it:  netstat -ano | findstr :${env.PORT}   then   taskkill /PID <pid> /F`,
    );
    return;
  }

  if (occupant === 'something-else') {
    console.error(
      `
Port ${env.PORT} is being used by something that is not Brotomap.
` +
        `Set PORT in server/.env to a free port, or free this one:
` +
        `  netstat -ano | findstr :${env.PORT}   then   taskkill /PID <pid> /F
`,
    );
    process.exitCode = 1;
    return;
  }

  const server = app.listen(env.PORT, () => {
    const state = hasAiCredentials(env)
      ? `model ${modelFor(env, 'fast')}`
      : 'NO AI KEY - add AI_API_KEY to server/.env';
    console.log(`Brotomap server on http://localhost:${env.PORT}  (${state})`);
  });

  // Still worth handling: the port can be taken between the check and the bind.
  server.on('error', (error: NodeJS.ErrnoException) => {
    console.error(
      error.code === 'EADDRINUSE'
        ? `
Port ${env.PORT} was taken while starting. Try again.
`
        : `
The server could not start: ${error.message}
`,
    );
    process.exitCode = 1;
  });
}

void start();
