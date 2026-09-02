import type { NextFunction, Request, Response } from 'express';

/**
 * A ceiling on how often the pipeline can be triggered.
 *
 * Not a defence against an attacker - this server listens on localhost. It is a
 * defence against a loop: a retry that retries itself can empty a free tier's
 * daily quota in a minute, and the student finds out when their roadmap stops
 * working for a day.
 */

interface Window {
  count: number;
  resetAt: number;
}

export function rateLimit(max: number, windowMs: number) {
  const windows = new Map<string, Window>();

  return (request: Request, response: Response, next: NextFunction): void => {
    const now = Date.now();
    const key = request.ip ?? 'local';
    const current = windows.get(key);

    if (current === undefined || now > current.resetAt) {
      windows.set(key, { count: 1, resetAt: now + windowMs });
      next();
      return;
    }

    if (current.count >= max) {
      const seconds = Math.ceil((current.resetAt - now) / 1000);
      response.status(429).json({
        error: {
          code: 'RATE_LIMITED',
          message: `Too many requests. Try again in ${seconds}s.`,
          retryable: true,
        },
      });
      return;
    }

    current.count += 1;
    next();
  };
}
