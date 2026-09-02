import { z } from 'zod';

/**
 * Turning a model's text into a typed object.
 *
 * A model returns text. Text is not data until something has checked it, and
 * "it looked like JSON" is not a check. Everything here exists so that the rest
 * of the pipeline can never receive a shape it did not ask for.
 */

/**
 * Pulls the JSON out of a reply.
 *
 * Models wrap objects in prose and code fences even when told not to, so the
 * fences are stripped and the outermost balanced object is taken. Failing that,
 * the caller gets a repair round-trip rather than a crash.
 */
export function extractJson(text: string): string | null {
  const withoutFences = text
    .replace(/^\s*```(?:json)?\s*/i, '')
    .replace(/\s*```\s*$/, '')
    .trim();

  if (withoutFences.startsWith('{') && withoutFences.endsWith('}')) {
    return withoutFences;
  }

  const start = withoutFences.indexOf('{');

  if (start === -1) {
    return null;
  }

  let depth = 0;
  let inString = false;
  let escaped = false;

  for (let index = start; index < withoutFences.length; index += 1) {
    const character = withoutFences[index];

    if (escaped) {
      escaped = false;
      continue;
    }

    if (character === '\\') {
      escaped = true;
      continue;
    }

    if (character === '"') {
      inString = !inString;
      continue;
    }

    if (inString) {
      continue;
    }

    if (character === '{') {
      depth += 1;
    } else if (character === '}') {
      depth -= 1;

      if (depth === 0) {
        return withoutFences.slice(start, index + 1);
      }
    }
  }

  return null;
}

export interface ParseFailure {
  ok: false;
  /** Phrased for the model, not for a log: this text is fed back as the repair prompt. */
  reason: string;
}

export type ParseResult<T> = { ok: true; value: T } | ParseFailure;

export function parseAs<T>(schema: z.ZodType<T>, text: string): ParseResult<T> {
  const json = extractJson(text);

  if (json === null) {
    return { ok: false, reason: 'The reply contained no JSON object.' };
  }

  let raw: unknown;

  try {
    raw = JSON.parse(json);
  } catch (error) {
    return {
      ok: false,
      reason: `The JSON could not be parsed: ${error instanceof Error ? error.message : 'unknown error'}.`,
    };
  }

  const parsed = schema.safeParse(raw);

  if (parsed.success) {
    return { ok: true, value: parsed.data };
  }

  return { ok: false, reason: describeIssues(parsed.error) };
}

/**
 * Says what is wrong in terms the model can act on.
 *
 * A zod dump is precise and unusable; "requirements.0.id: requirement ids look
 * like \"R1\"" gets the field fixed on the next attempt.
 */
function describeIssues(error: z.ZodError): string {
  const issues = error.issues
    .slice(0, 12)
    .map((issue) => `- ${issue.path.join('.') || '(root)'}: ${issue.message}`)
    .join('\n');

  return `The JSON did not match the required shape:\n${issues}`;
}

/**
 * The schema, written out for the prompt.
 *
 * Stating the shape in the prompt does more for compliance than any response
 * format flag, and it costs one function call.
 */
export function schemaForPrompt(schema: z.ZodType<unknown>): string {
  try {
    return JSON.stringify(z.toJSONSchema(schema, { io: 'input' }), null, 2);
  } catch {
    return '';
  }
}
