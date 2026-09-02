import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { PIPELINE_VERSION } from '@brotomap/shared';
import type { Env } from '../config/env.js';

/**
 * A disk cache for stage results.
 *
 * Two reasons it earns its place. Free provider tiers rate limit hard, and
 * re-running a stage on unchanged input to look at the UI again is the fastest
 * way to hit that limit. And a cached run is a reproducible one: the same task
 * gives the same object, so a bug found in the UI can be looked at twice.
 *
 * Keyed on the input and the pipeline version, so changing a prompt or a schema
 * invalidates everything that depended on it.
 */

export function cacheKey(stage: string, input: unknown): string {
  return createHash('sha256')
    .update(`${PIPELINE_VERSION}\u0000${stage}\u0000${JSON.stringify(input)}`)
    .digest('hex')
    .slice(0, 32);
}

function pathFor(env: Env, stage: string, key: string): string {
  return join(env.CACHE_DIR, stage, `${key}.json`);
}

export async function readCache<T>(env: Env, stage: string, key: string): Promise<T | null> {
  try {
    return JSON.parse(await readFile(pathFor(env, stage, key), 'utf8')) as T;
  } catch {
    // A miss and an unreadable file are the same thing: run the stage.
    return null;
  }
}

export async function writeCache(env: Env, stage: string, key: string, value: unknown): Promise<void> {
  const file = pathFor(env, stage, key);

  try {
    await mkdir(dirname(file), { recursive: true });
    await writeFile(file, JSON.stringify(value, null, 2), 'utf8');
  } catch {
    // A cache that cannot be written is a slower server, not a broken one.
  }
}
