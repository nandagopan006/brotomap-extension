import type { NextFunction, Request, Response } from 'express';
import type { Env } from '../config/env.js';

/**
 * Who may talk to this server.
 *
 * The extension holds no host permission for localhost, so the browser decides
 * on the strength of these headers alone. That makes the allow-list the only
 * thing standing between this server and any page the student happens to open,
 * so it is an allow-list and never a wildcard.
 *
 * In development any chrome-extension:// origin is accepted, because Chrome
 * assigns the id when the unpacked extension is loaded and it changes. In
 * production ALLOWED_ORIGINS must name it exactly.
 */
export function cors(env: Env) {
  return (request: Request, response: Response, next: NextFunction): void => {
    const origin = request.headers.origin;

    if (typeof origin === 'string' && isAllowed(origin, env)) {
      response.setHeader('access-control-allow-origin', origin);
      response.setHeader('vary', 'origin');
      response.setHeader('access-control-allow-headers', 'content-type');
      response.setHeader('access-control-allow-methods', 'GET, POST, OPTIONS');
      response.setHeader('access-control-max-age', '600');
    }

    if (request.method === 'OPTIONS') {
      response.status(204).end();
      return;
    }

    next();
  };
}

function isAllowed(origin: string, env: Env): boolean {
  if (env.allowedOrigins.includes(origin)) {
    return true;
  }

  return env.NODE_ENV !== 'production' && origin.startsWith('chrome-extension://');
}
