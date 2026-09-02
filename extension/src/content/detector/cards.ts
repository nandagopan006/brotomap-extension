import { isModuleLabelOnly } from '../config/taxonomy.js';
import { NOISE_TAGS, SELECTORS } from '../config/selectors.js';
import { elementCount, readLine, signatureOf } from '../dom/text.js';

/**
 * CARD DISCOVERY — finding the repeated groups a portal renders lists with.
 *
 * No portal-specific CSS is required. A list of task cards is, structurally, a
 * set of sibling elements that share a tag and class shape and each carry a
 * modest amount of text. That is true of every portal that has ever rendered a
 * list, and it survives a redesign that renames every class.
 *
 * The module list has exactly the same shape, so groups are classified: module
 * items are short and match the module pattern, task cards are longer.
 */

export type GroupKind = 'modules' | 'tasks' | 'other';

export interface CardGroup {
  parent: Element;
  signature: string;
  members: Element[];
  kind: GroupKind;
  score: number;
  /**
   * Position in the document.
   *
   * The module list page shows four modules' task lists at once, all equally
   * category-labelled, so evidence alone cannot choose between them. The one
   * for the module the student is actually looking at comes first.
   */
  order: number;
}

/** Guard rails so a pathological page cannot hang the content script. */
const LIMITS = {
  maxElementsScanned: 6000,
  maxGroups: 200,
  minMembers: 2,
  maxMembers: 60,
  maxMemberElements: 400,
} as const;

function isReadable(element: Element): boolean {
  return !NOISE_TAGS.has(element.tagName) && elementCount(element) <= LIMITS.maxMemberElements;
}

function classify(members: Element[], texts: string[]): { kind: GroupKind; score: number } {
  const nonEmpty = texts.filter((text) => text.length > 0);

  if (nonEmpty.length < LIMITS.minMembers) {
    return { kind: 'other', score: 0 };
  }

  const averageLength = nonEmpty.reduce((sum, text) => sum + text.length, 0) / nonEmpty.length;
  const moduleLike = nonEmpty.filter(isModuleLabelOnly).length / nonEmpty.length;
  const distinct = new Set(nonEmpty).size / nonEmpty.length;

  // Module items: nearly all of them are *nothing but* a module label.
  if (moduleLike >= 0.6 && averageLength <= 60) {
    return { kind: 'modules', score: 0.5 + moduleLike * 0.5 };
  }

  // Task cards: a handful of items, each a sentence-ish label, all different.
  const plausible =
    averageLength >= 6 &&
    averageLength <= 300 &&
    distinct >= 0.75 &&
    members.length >= LIMITS.minMembers &&
    members.length <= LIMITS.maxMembers;

  if (!plausible) {
    return { kind: 'other', score: 0 };
  }

  const sizeFit = members.length <= 12 ? 1 : 12 / members.length;
  const lengthFit = averageLength >= 12 && averageLength <= 200 ? 1 : 0.6;
  const linkFit = members.some((member) => member.querySelector('a') ?? member.closest('a')) ? 1 : 0.85;

  return { kind: 'tasks', score: 0.4 * sizeFit + 0.3 * lengthFit + 0.3 * linkFit };
}

/**
 * Every plausible repeated group on the page, best first.
 * Both kinds are returned: the caller needs the module list as well.
 */
export function findGroups(root: ParentNode): CardGroup[] {
  const groups: CardGroup[] = [];
  const parents = Array.from(root.querySelectorAll('*')).slice(0, LIMITS.maxElementsScanned);

  for (const parent of parents) {
    if (NOISE_TAGS.has(parent.tagName) || parent.children.length < LIMITS.minMembers) {
      continue;
    }

    const bySignature = new Map<string, Element[]>();

    for (const child of Array.from(parent.children)) {
      if (!isReadable(child)) {
        continue;
      }
      const signature = signatureOf(child);
      const bucket = bySignature.get(signature);
      if (bucket) {
        bucket.push(child);
      } else {
        bySignature.set(signature, [child]);
      }
    }

    for (const [signature, members] of bySignature) {
      if (members.length < LIMITS.minMembers || groups.length >= LIMITS.maxGroups) {
        continue;
      }

      const texts = members.map((member) => readLine(member));
      const { kind, score } = classify(members, texts);

      if (kind !== 'other') {
        groups.push({ parent, signature, members, kind, score, order: groups.length });
      }
    }
  }

  return groups.sort((a, b) => b.score - a.score);
}

/**
 * The task list.
 *
 * Configured selectors win when present; otherwise the best-scoring structural
 * group is used. Nested groups are resolved by preferring the outer one, which
 * is the element a student would call "the card".
 */
export function findTaskGroup(root: ParentNode, groups: CardGroup[]): CardGroup | null {
  const configured = SELECTORS.taskCard.length > 0 ? Array.from(root.querySelectorAll(SELECTORS.taskCard.join(','))) : [];

  if (configured.length >= LIMITS.minMembers) {
    const first = configured[0];
    return {
      parent: first?.parentElement ?? (root as Element),
      signature: 'configured',
      members: configured,
      kind: 'tasks',
      score: 1,
      order: -1,
    };
  }

  const taskGroups = groups.filter((group) => group.kind === 'tasks');
  const best = taskGroups[0];

  if (!best) {
    return null;
  }

  // Prefer an ancestor group over one nested inside it: the outer element is
  // the whole card, the inner one is usually just its title row.
  const outer = taskGroups.find(
    (group) =>
      group !== best &&
      group.score >= best.score * 0.8 &&
      group.members.some((member) => member.contains(best.members[0] ?? null)),
  );

  return outer ?? best;
}

export function findModuleGroup(groups: CardGroup[]): CardGroup | null {
  return groups.find((group) => group.kind === 'modules') ?? null;
}
