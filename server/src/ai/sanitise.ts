import { effortMinutesSchema, type KnowledgeNode } from '@brotomap/shared';

/**
 * Turning a nearly-right answer into a right one.
 *
 * A model gets the substance right and the conventions wrong. It writes an id
 * as "t-ES6_Classes", an effort of 200 minutes, a requirement reference of "1"
 * instead of "R1". Rejecting a forty-node map over two capital letters throws
 * away everything of value in it, costs another call, and often fails the same
 * way twice.
 *
 * So the rule is: coerce whatever we can determine ourselves, and reject only
 * when meaning is actually missing. An id is a handle we invented the format
 * for - we can fix it. A node with no title says nothing, and no amount of
 * cleaning will make it say something.
 */

/** What the model may send, before we tidy it. */
export interface LooseNode extends Omit<KnowledgeNode, 'id' | 'parentId' | 'prerequisites'> {
  id: string;
  parentId: string | null;
  prerequisites: string[];
}

export interface SanitiseResult {
  nodes: KnowledgeNode[];
  /** What had to be corrected. Reported, never silent. */
  fixes: string[];
}

const MIN_EFFORT = 5;
const MAX_EFFORT = 240;
const EFFORT_STEP = 15;

/**
 * Format only.
 *
 * Whether a reference points at a node that exists is a question about the
 * graph, and the graph builder already answers it - dropping dangling edges and
 * saying which. Answering it here as well was worse than redundant: sanitising
 * happens per call, so a reference to a node another call had not created yet
 * looked imaginary and was deleted, destroying exactly the cross-call
 * dependency that splitting the work took care to preserve.
 *
 * One question, one place.
 */
export function sanitiseNodes(input: LooseNode[]): SanitiseResult {
  const fixes: string[] = [];
  const withTitles = input.filter((node) => {
    if (node.title.trim().length > 0) {
      return true;
    }
    // Nothing to salvage: a node with no name is not a topic.
    fixes.push('Dropped a node with no title.');
    return false;
  });

  const renames = buildIdMap(withTitles, fixes);

  const nodes = withTitles.map((node) => {
    const id = renames.get(node.id) ?? slug(node.id);
    const parentId = node.parentId === null ? null : (renames.get(node.parentId) ?? slug(node.parentId));

    return {
      ...node,
      id,
      parentId,
      prerequisites: [
        ...new Set(node.prerequisites.map((reference) => renames.get(reference) ?? slug(reference))),
      ],
      effortMinutes: clampEffort(node.effortMinutes, node.title, fixes),
      coversRequirements: keepRequirementIds(node.coversRequirements),
      coversTopicIndexes: node.coversTopicIndexes.filter(
        (index) => Number.isInteger(index) && index >= 1,
      ),
      summary: fallback(node.summary, `About ${node.title}.`),
      whyItMatters: fallback(node.whyItMatters, `Needed for this task.`),
      resources: [],
    } satisfies KnowledgeNode;
  });

  return { nodes, fixes };
}

/**
 * Every id, in our format, with collisions resolved.
 *
 * Built as a whole map first so that references can be rewritten to match:
 * renaming an id without renaming what points at it would turn a real
 * dependency into a dangling one.
 */
function buildIdMap(nodes: LooseNode[], fixes: string[]): Map<string, string> {
  const renames = new Map<string, string>();
  const taken = new Set<string>();
  let corrected = 0;

  for (const node of nodes) {
    let candidate = slug(node.id) || slug(node.title) || 't-node';

    if (candidate !== node.id) {
      corrected += 1;
    }

    if (taken.has(candidate)) {
      let suffix = 2;
      while (taken.has(`${candidate}-${suffix}`)) {
        suffix += 1;
      }
      candidate = `${candidate}-${suffix}`;
    }

    taken.add(candidate);
    renames.set(node.id, candidate);
  }

  if (corrected > 0) {
    fixes.push(`Rewrote ${corrected} id${corrected === 1 ? '' : 's'} into the expected format.`);
  }

  return renames;
}

/** Lowercase kebab-case, and nothing else. */
function slug(value: string): string {
  return value
    .normalize('NFKD')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80)
    .replace(/-+$/, '');
}

/**
 * An effort estimate outside the range is a judgement we can correct; the
 * alternative is discarding a node over a number.
 */
function clampEffort(minutes: number, title: string, fixes: string[]): number {
  if (effortMinutesSchema.safeParse(minutes).success) {
    return minutes;
  }

  const rounded = Math.round(Math.min(MAX_EFFORT, Math.max(MIN_EFFORT, minutes)) / EFFORT_STEP) * EFFORT_STEP;
  const corrected = Math.min(MAX_EFFORT, Math.max(MIN_EFFORT, rounded));

  fixes.push(`"${title}" claimed ${minutes} minutes; used ${corrected}.`);
  return corrected;
}

/** "R1" is a reference to something real; "1" or "requirement one" is not. */
function keepRequirementIds(values: string[]): string[] {
  return [...new Set(values.map((value) => value.trim().toUpperCase()))].filter((value) =>
    /^R\d+$/.test(value),
  );
}

function fallback(value: string, standIn: string): string {
  return value.trim().length > 0 ? value : standIn;
}
