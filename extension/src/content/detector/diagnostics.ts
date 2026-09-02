import { isPortalTaskUrl } from '../config/portal.js';
import { readLine } from '../dom/text.js';
import { findGroups, findModuleGroup } from './cards.js';
import { examine } from './classify.js';
import { detectModule } from './module.js';
import { detectTechnicalTask } from './index.js';
import { findToggles } from '../extractor/expand.js';
import { discoverTopics, linkedPanels, parseTopic } from '../extractor/topics.js';

/**
 * A self-report of what the detector actually saw.
 *
 * Detection failures on a page nobody can share are otherwise diagnosed by
 * guesswork. One click produces this instead: the groups found, how each was
 * classified, and what the cards said. No page content beyond short labels, no
 * personal data, nothing that needs the page itself to be handed over.
 */
export function describePage(doc: Document, url = doc.location?.href ?? ''): string {
  const lines: string[] = [];
  const add = (text: string): void => void lines.push(text);

  add('BROTOMAP DIAGNOSTIC');
  add(`url            : ${safeUrl(url)}`);
  add(`portal url     : ${isPortalTaskUrl(url) ? 'yes' : 'no'}`);
  add(`elements       : ${doc.body ? doc.body.querySelectorAll('*').length : 0}`);

  if (!doc.body) {
    return lines.join('\n');
  }

  const groups = findGroups(doc.body);
  const moduleGroup = findModuleGroup(groups);
  const moduleContext = detectModule(doc, moduleGroup);

  add(`module         : ${moduleContext ? `"${moduleContext.title}"` : 'NOT FOUND'}`);

  const result = detectTechnicalTask(doc, url);
  add(`result         : ${result.status}`);
  add(
    result.status === 'ok'
      ? `task           : "${result.taskTitle}" (${result.detection.confidence}, ${result.detection.matchedSignals.join(', ')})`
      : `reason         : ${result.reason}`,
  );

  // Topic-level report: the question that matters when a topic comes back
  // empty is whether there was anything to click, and this answers it without
  // touching the page.
  const topics = discoverTopics(doc);
  add('');
  add(`topics found   : ${topics.length}`);

  for (const topic of topics) {
    const parsed = parseTopic(topic.element, topic.index, linkedPanels(topic.element));
    const toggles = findToggles(topic.element);
    const first = toggles[0];

    add(
      `  [${topic.index}] chars=${parsed.content.length} toggles=${toggles.length}` +
        (first === undefined
          ? ''
          : ` first=<${first.tagName.toLowerCase()}${
              first.getAttribute('aria-expanded') === null
                ? ''
                : ` aria-expanded=${first.getAttribute('aria-expanded')}`
            }> "${truncate(readLine(first), 30)}"`) +
        ` panels=${linkedPanels(topic.element).length}`,
    );
  }

  add('');
  add(`repeated groups: ${groups.length}`);

  for (const [index, group] of groups.slice(0, 8).entries()) {
    const cards = group.kind === 'tasks' ? group.members.map(examine) : [];
    const evidence = cards.filter(
      (card) => card.evidence.technicalTerm !== null || card.evidence.nonTechnicalTerm !== null,
    ).length;

    add('');
    add(`[${index}] kind=${group.kind} score=${group.score.toFixed(2)} members=${group.members.length}`);
    add(`    signature=${group.signature}`);
    if (group.kind === 'tasks') {
      add(`    cards stating a category: ${evidence}/${cards.length}`);
    }

    for (const member of group.members.slice(0, 6)) {
      add(`    - ${truncate(readLine(member), 90)}`);
    }
  }

  return lines.join('\n');
}

function truncate(text: string, max: number): string {
  return text.length <= max ? text : `${text.slice(0, max)}…`;
}

/** Drops the query string: ids in it identify the student's own records. */
function safeUrl(url: string): string {
  try {
    const parsed = new URL(url);
    return `${parsed.origin}${parsed.pathname}`;
  } catch {
    return url;
  }
}
