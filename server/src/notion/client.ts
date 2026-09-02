import type { Env } from '../config/env.js';
import type { NotionBlock, RoadmapPage } from './blocks.js';

/**
 * Writing a page to Notion.
 *
 * No SDK, for the same reason as the AI provider: it is a JSON API, Node has
 * fetch, and a dependency here would have to be trusted with a token.
 */

const API = 'https://api.notion.com/v1';

/** Pinned deliberately: Notion changes behaviour by version, not by date. */
const VERSION = '2022-06-28';

/** Notion accepts at most this many child blocks per request. */
const BLOCK_LIMIT = 100;

export class NotionError extends Error {
  constructor(
    message: string,
    readonly retryable: boolean,
  ) {
    super(message);
    this.name = 'NotionError';
  }
}

interface CreatedPage {
  id: string;
  url: string;
}

export async function createRoadmapPage(env: Env, page: RoadmapPage): Promise<CreatedPage> {
  if (env.NOTION_TOKEN === undefined || env.NOTION_PARENT_PAGE_ID === undefined) {
    throw new NotionError('Notion is not configured. Add NOTION_TOKEN and NOTION_PARENT_PAGE_ID to server/.env.', false);
  }

  const [first, ...rest] = chunk(page.blocks);

  const created = await call<CreatedPage>(env.NOTION_TOKEN, 'POST', '/pages', {
    parent: { page_id: normaliseId(env.NOTION_PARENT_PAGE_ID) },
    properties: {
      title: { title: [{ type: 'text', text: { content: page.title.slice(0, 200) } }] },
    },
    children: first ?? [],
  });

  // A roadmap is far more than a hundred blocks, and Notion takes them a
  // hundred at a time. The page exists after the first call; the rest is filled
  // in, in order, so a failure halfway leaves a short page rather than none.
  for (const batch of rest) {
    await call(env.NOTION_TOKEN, 'PATCH', `/blocks/${created.id}/children`, { children: batch });
  }

  return created;
}

function chunk(blocks: NotionBlock[]): NotionBlock[][] {
  const batches: NotionBlock[][] = [];

  for (let index = 0; index < blocks.length; index += BLOCK_LIMIT) {
    batches.push(blocks.slice(index, index + BLOCK_LIMIT));
  }

  return batches.length === 0 ? [[]] : batches;
}

/**
 * Notion ids appear with and without dashes depending on where they were
 * copied from. Both are accepted here so nobody has to know that.
 */
export function normaliseId(raw: string): string {
  const hex = raw.trim().replace(/[^0-9a-fA-F]/g, '');

  if (hex.length !== 32) {
    return raw.trim();
  }

  return [
    hex.slice(0, 8),
    hex.slice(8, 12),
    hex.slice(12, 16),
    hex.slice(16, 20),
    hex.slice(20),
  ].join('-');
}

async function call<T>(token: string, method: string, path: string, body: unknown): Promise<T> {
  let response: Response;

  try {
    response = await fetch(`${API}${path}`, {
      method,
      headers: {
        authorization: `Bearer ${token}`,
        'notion-version': VERSION,
        'content-type': 'application/json',
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(20_000),
    });
  } catch {
    throw new NotionError('Could not reach Notion. Check your connection and try again.', true);
  }

  if (response.ok) {
    return (await response.json()) as T;
  }

  throw describeFailure(response.status, await response.text().catch(() => ''));
}

/**
 * Notion's failures are mostly setup mistakes, and each has a specific fix.
 * Saying which one saves an hour of reading API documentation.
 */
function describeFailure(status: number, body: string): NotionError {
  if (status === 401) {
    return new NotionError('Notion rejected the token. Check NOTION_TOKEN in server/.env.', false);
  }

  if (status === 404 || /could not find/i.test(body)) {
    return new NotionError(
      'Notion cannot see that page. Open it, choose ••• → Connections → Connect to, and pick your integration - an integration only sees pages it has been given.',
      false,
    );
  }

  if (status === 400 && /parent/i.test(body)) {
    return new NotionError(
      'That parent page id does not look right. Copy the 32 characters from the page URL.',
      false,
    );
  }

  if (status === 429) {
    return new NotionError('Notion is rate limiting. Wait a moment and try again.', true);
  }

  return new NotionError(
    status >= 500 ? 'Notion is having trouble. Try again shortly.' : `Notion returned ${status}.`,
    status >= 500,
  );
}
