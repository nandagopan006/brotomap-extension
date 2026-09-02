import { randomUUID } from 'node:crypto';

/**
 * WORK THAT OUTLIVES THE ASKING.
 *
 * The pipeline takes about a minute, most of it waiting out a per-minute token
 * limit. Holding an HTTP request open for that meant something in the browser
 * had to stay alive for a minute too - and in an extension, nothing does. A
 * popup dies when the student clicks away. A service worker dies when it goes
 * idle, and waiting is idleness. Every attempt to find a context that survives
 * produced another way to be killed halfway through.
 *
 * So nothing has to survive. The server takes the work, answers immediately
 * with a ticket, and finishes on its own. The browser asks how it went whenever
 * it happens to be alive. Close the popup, reopen it a minute later, and the
 * answer is simply waiting.
 */

export type Job<T> =
  | { status: 'running'; startedAt: number; detail: string }
  | { status: 'done'; finishedAt: number; ms: number; value: T }
  | { status: 'failed'; code: string; message: string; retryable: boolean };

/** Long enough to look at a roadmap, short enough not to be a memory leak. */
const KEEP_MS = 30 * 60 * 1000;

export interface JobFailure {
  code: string;
  message: string;
  retryable: boolean;
}

export class Jobs<T> {
  private readonly jobs = new Map<string, Job<T>>();

  /**
   * Starts the work and returns a ticket for it.
   *
   * The promise is deliberately not awaited: the caller gets an id now, and the
   * work finishes whether or not anybody is still listening.
   */
  start(
    detail: string,
    work: (progress: (detail: string) => void) => Promise<T>,
    describeFailure: (error: unknown) => JobFailure,
  ): string {
    const id = randomUUID();
    const startedAt = Date.now();

    this.jobs.set(id, { status: 'running', startedAt, detail });

    void work((update) => {
      const current = this.jobs.get(id);

      if (current?.status === 'running') {
        this.jobs.set(id, { ...current, detail: update });
      }
    })
      .then((value) => {
        this.jobs.set(id, { status: 'done', finishedAt: Date.now(), ms: Date.now() - startedAt, value });
      })
      .catch((error: unknown) => {
        // The mapped message is for the student; this is for whoever has to fix
        // it. A job that fails silently on the server is a job nobody can debug.
        console.error('[job] failed:', error);
        this.jobs.set(id, { status: 'failed', ...describeFailure(error) });
      })
      .finally(() => {
        setTimeout(() => this.jobs.delete(id), KEEP_MS).unref?.();
      });

    return id;
  }

  get(id: string): Job<T> | null {
    return this.jobs.get(id) ?? null;
  }
}
