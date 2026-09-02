import type { NextFunction, Request, Response } from 'express';
import { AiError } from '../ai/provider.js';

/**
 * Every failure leaves this server as JSON, and never as a stack trace.
 *
 * Express answers an unknown route with an HTML page by default, which the
 * extension cannot parse - so a typo in a path arrived as "the server returned
 * something unexpected" instead of "no such route". Its default error handler
 * is worse: in development it returns the stack, which is exactly what the
 * specification says never to expose.
 */

export interface ApiErrorBody {
  error: { code: string; message: string; retryable: boolean };
}

export function notFound(_request: Request, response: Response): void {
  response.status(404).json({
    error: { code: 'NOT_FOUND', message: 'No such endpoint.', retryable: false },
  } satisfies ApiErrorBody);
}

export function errorHandler(
  error: unknown,
  _request: Request,
  response: Response,
  _next: NextFunction,
): void {
  if (response.headersSent) {
    return;
  }

  const { status, body } = describe(error);
  response.status(status).json(body);
}

export function describe(error: unknown): { status: number; body: ApiErrorBody } {
  if (error instanceof AiError) {
    return { status: statusForAi(error), body: { error: { code: codeFor(error), message: error.message, retryable: error.retryable } } };
  }

  // Thrown by the body parser when a request exceeds the limit.
  if (isHttpError(error) && error.status === 413) {
    return {
      status: 413,
      body: {
        error: {
          code: 'PAYLOAD_TOO_LARGE',
          message: 'That task is too large to send. Only extracted task text should be sent, never page HTML.',
          retryable: false,
        },
      },
    };
  }

  if (isHttpError(error) && error.status === 400) {
    return {
      status: 400,
      body: { error: { code: 'BAD_REQUEST', message: 'The request body was not valid JSON.', retryable: false } },
    };
  }

  return {
    status: 500,
    body: { error: { code: 'INTERNAL', message: 'Something went wrong on the server.', retryable: true } },
  };
}

function codeFor(error: AiError): string {
  return error.failure.toUpperCase().replace(/-/g, '_');
}

function statusForAi(error: AiError): number {
  switch (error.failure) {
    case 'no-credentials':
    case 'model-not-found':
      return 503;
    case 'rate-limited':
      return 429;
    case 'timeout':
      return 504;
    default:
      return 502;
  }
}

function isHttpError(error: unknown): error is { status: number } {
  return typeof error === 'object' && error !== null && typeof (error as { status?: unknown }).status === 'number';
}
