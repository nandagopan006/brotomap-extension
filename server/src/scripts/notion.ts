import { hasNotion, loadEnv } from '../config/env.js';
import { normaliseId } from '../notion/client.js';

/**
 * Checks the Notion setup and says exactly which step is missing.
 *
 * Notion's failures are all setup mistakes wearing HTTP status codes. Told
 * "404", nobody learns that an integration can only see pages it has been
 * explicitly given. Told that, they fix it in ten seconds.
 */

const VERSION = '2022-06-28';

async function get(token: string, path: string): Promise<{ status: number; body: string }> {
  const response = await fetch(`https://api.notion.com/v1${path}`, {
    headers: { authorization: `Bearer ${token}`, 'notion-version': VERSION },
  });

  return { status: response.status, body: await response.text().catch(() => '') };
}

async function main(): Promise<void> {
  const env = loadEnv();

  console.log('\nChecking your Notion setup...\n');

  if (!hasNotion(env)) {
    console.log('  [ ] NOTION_TOKEN and NOTION_PARENT_PAGE_ID are not both set in server/.env.');
    console.log('\n      Notion -> Developer tools -> Connections -> New connection,');
    console.log('      then copy the secret, and the page id from the page URL.\n');
    process.exitCode = 1;
    return;
  }

  const token = env.NOTION_TOKEN as string;
  const pageId = normaliseId(env.NOTION_PARENT_PAGE_ID as string);

  // 1. Does the token work at all?
  const who = await get(token, '/users/me');

  if (who.status === 401) {
    console.log('  [x] The token was rejected.');
    console.log('\n      Copy it again from the connection\u2019s settings. It starts with "ntn_".\n');
    process.exitCode = 1;
    return;
  }

  if (who.status !== 200) {
    console.log(`  [x] Notion returned ${who.status} for the token check.`);
    console.log(`\n      ${who.body.slice(0, 200)}\n`);
    process.exitCode = 1;
    return;
  }

  const name = (JSON.parse(who.body) as { name?: string }).name ?? 'your connection';
  console.log(`  [ok] Token works. Notion knows it as "${name}".`);

  // 2. Can it see the page it is supposed to write into?
  const page = await get(token, `/pages/${pageId}`);

  if (page.status === 404 || /could not find/i.test(page.body)) {
    console.log('  [x] It cannot see that page.');
    console.log('\n      This is the step everyone misses: open the page in Notion,');
    console.log('      click the ... menu at the top right, choose Connections,');
    console.log(`      then Connect to -> "${name}".`);
    console.log('\n      An integration sees nothing until it is given a page.\n');
    process.exitCode = 1;
    return;
  }

  if (page.status !== 200) {
    console.log(`  [x] Notion returned ${page.status} for the page check.`);
    console.log(`\n      Page id used: ${pageId}`);
    console.log(`      ${page.body.slice(0, 200)}\n`);
    process.exitCode = 1;
    return;
  }

  const title = extractTitle(page.body);
  console.log(`  [ok] It can see the page${title === null ? '' : `: "${title}"`}.`);
  console.log('\nSetup looks right. Press "Save to Notion" in the extension.\n');
}

/** The title lives in whichever property happens to be the title one. */
function extractTitle(body: string): string | null {
  try {
    const properties = (JSON.parse(body) as { properties?: Record<string, unknown> }).properties ?? {};

    for (const value of Object.values(properties)) {
      const parts = (value as { title?: { plain_text?: string }[] }).title;

      if (Array.isArray(parts)) {
        return parts.map((part) => part.plain_text ?? '').join('') || null;
      }
    }
  } catch {
    // A page we cannot read the title of is still a page we can write to.
  }

  return null;
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
