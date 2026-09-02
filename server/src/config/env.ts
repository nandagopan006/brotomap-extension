import { z } from 'zod';

/**
 * Environment loading and validation.
 *
 * Why validate env at all: a missing or misspelled key otherwise fails deep
 * inside an AI call, minutes later, as a confusing 401. Here it fails at start-up
 * with a sentence that says exactly what to fix.
 *
 * The AI provider key lives ONLY here. It is never sent to the extension, never
 * logged, and never included in a response body.
 */

/**
 * An empty line in a .env file means "not set", not "set to nothing".
 *
 * `AI_MODEL_REASONING=` with nothing after it is how .env.example ships, and
 * treating that as a one-character-minimum string refused to start the server
 * over a variable that is optional by design.
 */
const optionalText = z.preprocess(
  (value) => (typeof value === 'string' && value.trim() === '' ? undefined : value),
  z.string().min(1).optional(),
);

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(8787),

  /**
   * Provider credentials.
   *
   * Optional on purpose: the server must be able to boot without a key during
   * Phases 2–4, when the extension needs /api/health but no AI call is made.
   * A generate request without credentials fails with AI_UNAVAILABLE — a clear
   * error at the point of use, rather than a server that refuses to start.
   */
  AI_API_KEY: optionalText,
  AI_MODEL: z.string().min(1),
  /** Second model id for the reasoning-heavy stages. Defaults to AI_MODEL. */
  AI_MODEL_REASONING: optionalText,

  /**
   * Ceiling on one answer.
   *
   * Not a cost control: providers count prompt + this figure against a
   * tokens-per-minute limit, so setting it generously made a single request
   * exceed a free tier's entire minute by itself. It has to leave room for the
   * prompt beneath whatever the plan allows.
   */
  AI_MAX_TOKENS: z.coerce.number().int().min(500).max(32_000).default(3000),

  /** Comma-separated. In dev this is the unpacked extension's chrome-extension:// origin. */
  ALLOWED_ORIGINS: z.string().default(''),

  /** Default study budget; a student can override it per run from the UI. */
  WEEKLY_HOURS: z.coerce.number().min(5).max(70).default(25),

  /**
   * Notion, when the student wants the roadmap as a page they can tick off.
   *
   * Optional throughout: no token means the export is simply not offered, which
   * is a feature being absent rather than the server refusing to start.
   */
  NOTION_TOKEN: optionalText,
  NOTION_PARENT_PAGE_ID: optionalText,

  /** Where prompt/response pairs and generated roadmaps are cached (dev debugging). */
  CACHE_DIR: z.string().default('.cache'),
});

export type Env = z.infer<typeof envSchema> & { allowedOrigins: string[] };

/**
 * The .env this package owns, resolved from this file's own location.
 *
 * Deliberately NOT relative to process.cwd(): the server can be started from
 * the repo root, from server/, or by an editor, and all three must read the
 * same file. env.ts lives at server/src/config/, so ../../.env is server/.env.
 */
const ENV_FILE = new URL('../../.env', import.meta.url);

/**
 * Reads server/.env (Node's own loader - no dependency) and validates it.
 * Throws a readable error listing every missing or invalid variable.
 */
export function loadEnv(): Env {
  try {
    process.loadEnvFile(ENV_FILE);
  } catch {
    // No .env file: fall back to real environment variables (CI, hosting).
  }

  const parsed = envSchema.safeParse(process.env);

  if (!parsed.success) {
    const problems = parsed.error.issues
      .map((issue) => `  - ${issue.path.join('.')}: ${issue.message}`)
      .join('\n');
    throw new Error(
      `Invalid server environment.\n${problems}\n\nCopy server/.env.example to server/.env and fill it in.`,
    );
  }

  const allowedOrigins = parsed.data.ALLOWED_ORIGINS.split(',')
    .map((origin) => origin.trim())
    .filter((origin) => origin.length > 0);

  return { ...parsed.data, allowedOrigins };
}

/** Both halves are needed: a token with nowhere to write is not configured. */
export function hasNotion(env: Env): boolean {
  return (
    typeof env.NOTION_TOKEN === 'string' &&
    env.NOTION_TOKEN.length > 0 &&
    typeof env.NOTION_PARENT_PAGE_ID === 'string' &&
    env.NOTION_PARENT_PAGE_ID.length > 0
  );
}

/** True when it is safe to write prompts and raw model output to disk. */
export function isDebugLoggingAllowed(env: Env): boolean {
  return env.NODE_ENV !== 'production';
}

/**
 * Whether the AI provider can actually be called.
 * Reported by /api/health so the extension can say "add your key" instead of
 * failing mid-pipeline.
 */
export function hasAiCredentials(env: Env): boolean {
  return typeof env.AI_API_KEY === 'string' && env.AI_API_KEY.length > 0;
}

/** The model id for a stage. Reasoning stages fall back to the default model. */
export function modelFor(env: Env, kind: 'fast' | 'reasoning'): string {
  return kind === 'reasoning' ? (env.AI_MODEL_REASONING ?? env.AI_MODEL) : env.AI_MODEL;
}
