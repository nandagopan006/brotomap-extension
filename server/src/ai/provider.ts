import type { z } from 'zod';

/**
 * THE AI BOUNDARY.
 *
 * Everything above this line asks for a typed object and gets one, or gets a
 * typed error. Nothing above this line knows which provider answered, what a
 * token is, or that JSON was ever involved.
 *
 * Only files under ai/providers/ may import a vendor's SDK or hit its URL. That
 * is what makes Groq a choice rather than an architecture.
 */

export type AiFailure =
  | 'no-credentials'
  | 'rate-limited'
  | 'unavailable'
  | 'timeout'
  | 'invalid-output'
  | 'model-not-found';

export class AiError extends Error {
  constructor(
    readonly failure: AiFailure,
    message: string,
    readonly retryable: boolean,
    /**
     * How long the provider asked us to wait, when it said so.
     *
     * A per-minute token budget is not something to guess at: an exponential
     * backoff of a second or two retries straight into the same wall, three
     * times, and then reports failure while the window was still open.
     */
    readonly retryAfterMs?: number,
  ) {
    super(message);
    this.name = 'AiError';
  }
}

export interface CompletionRequest<T> {
  /** Who the model is and what it must never do. */
  system: string;
  /** The task itself. */
  user: string;
  /** The shape the answer must take. Enforced after the call, not hoped for. */
  schema: z.ZodType<T>;
  /** A name for the schema, used in the prompt and in logs. */
  schemaName: string;
  /** Low for extraction and labelling, higher where breadth is wanted. */
  temperature: number;
  /** 'fast' for mechanical work, 'reasoning' where recall matters. */
  model: 'fast' | 'reasoning';
  /** Hard limit on the whole call, including retries. */
  timeoutMs?: number;
  /**
   * Ceiling on this answer, when the default is the wrong size for it.
   *
   * A knowledge map is an order of magnitude longer than a task summary, and
   * one figure for both meant the map was quietly truncated to fit - it came
   * back with 21 nodes because that is what the budget allowed, not because
   * that is what the subject needed.
   */
  maxTokens?: number;
}

export interface CompletionResult<T> {
  value: T;
  /** Real measurements, for the progress the student sees. */
  ms: number;
  /** How many calls it actually took, including any repair. */
  calls: number;
  /** True when the first answer failed validation and had to be repaired. */
  repaired: boolean;
}

export interface AiProvider {
  readonly name: string;
  readonly configured: boolean;
  complete: <T>(request: CompletionRequest<T>) => Promise<CompletionResult<T>>;
}
