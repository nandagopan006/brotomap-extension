import { ACTIVE_MARKERS, SELECTORS } from '../config/selectors.js';
import {
  CATEGORY_ATTRIBUTE_HINTS,
  NON_TECHNICAL_TERMS,
  PATTERNS,
  TECHNICAL_TERMS,
  isChipLabel,
  matchesAny,
} from '../config/taxonomy.js';
import { attributeText, readLine, readText } from '../dom/text.js';
import type { DetectionSignal, TaskCandidate } from '../../types/index.js';

/**
 * CLASSIFICATION — which card is the technical task?
 *
 * Identification is by category and structure, never by subject. The card in
 * the spec's own example is titled with a technology and carries no category
 * word at all, while its three siblings name their categories — so elimination
 * has to be a first-class path, not an afterthought.
 *
 * When the evidence does not single out exactly one card, this refuses to
 * choose. A confidently wrong pick would produce a beautiful roadmap for the
 * wrong task, and the student would only find out on Friday.
 */

export interface CardEvidence {
  technicalTerm: string | null;
  nonTechnicalTerm: string | null;
  fromAttribute: boolean;
  fromLabel: boolean;
  hasTopicStructure: boolean;
}

export interface ExaminedCard {
  element: Element;
  title: string;
  evidence: CardEvidence;
  classification: 'technical' | 'non-technical' | 'unknown';
}

/**
 * The card's own name.
 *
 * A card usually carries meta text as well ("Due Friday", "Not submitted"), and
 * that must not end up in the task title we display and later send to the AI.
 * A heading or link inside the card is the title; the whole card text is the
 * fallback.
 */
function cardTitle(card: Element): string {
  const heading = card.querySelector('h1, h2, h3, h4, h5, [role="heading"]');
  const headingText = heading ? readLine(heading) : '';

  if (headingText.length >= 3 && headingText.length <= 200) {
    return headingText;
  }

  // The live portal renders card titles as plain divs with no heading tag, so
  // there is often nothing semantic to find. The title is then the longest leaf
  // in the card - but chips have to be excluded first, because a status button
  // can easily be longer than the name it sits beside.
  let longest = '';
  let longestIncludingChips = '';

  for (const element of Array.from(card.querySelectorAll('*'))) {
    if (element.children.length > 0) {
      continue;
    }

    const text = readLine(element);

    if (text.length > longestIncludingChips.length) {
      longestIncludingChips = text;
    }

    if (!isChipLabel(text) && text.length > longest.length) {
      longest = text;
    }
  }

  if (longest.length >= 3) {
    return longest.slice(0, 200);
  }

  if (longestIncludingChips.length >= 3) {
    return longestIncludingChips.slice(0, 200);
  }

  return readLine(card).slice(0, 200);
}

export function examine(card: Element): ExaminedCard {
  const title = cardTitle(card);
  const body = readText(card);
  const attributes = attributeText(card, CATEGORY_ATTRIBUTE_HINTS);

  const attributeTechnical =
    matchesAny(attributes, TECHNICAL_TERMS) !== null || PATTERNS.technicalRoute.test(attributes);

  const labelElement =
    SELECTORS.categoryLabel.length > 0 ? card.querySelector(SELECTORS.categoryLabel.join(',')) : null;
  const labelText = labelElement ? readLine(labelElement) : '';

  // Matched against the whole card, not just its title: a portal states the
  // category in a badge beside the name at least as often as in the name.
  const technicalTerm =
    matchesAny(labelText, TECHNICAL_TERMS) ??
    matchesAny(body, TECHNICAL_TERMS) ??
    (attributeTechnical ? 'technical' : null);

  const nonTechnicalTerm =
    matchesAny(labelText, NON_TECHNICAL_TERMS) ??
    matchesAny(body, NON_TECHNICAL_TERMS) ??
    matchesAny(attributes, NON_TECHNICAL_TERMS);

  const evidence: CardEvidence = {
    technicalTerm,
    nonTechnicalTerm,
    fromAttribute: attributeTechnical,
    fromLabel: matchesAny(labelText, TECHNICAL_TERMS) !== null || matchesAny(body, TECHNICAL_TERMS) !== null,
    hasTopicStructure: PATTERNS.topicCount.test(body) || countTopicHeadings(body) >= 2,
  };

  return { element: card, title, evidence, classification: classifyOne(evidence) };
}

function countTopicHeadings(text: string): number {
  return text.split('\n').filter((line) => PATTERNS.topicHeading.test(line)).length;
}

function classifyOne(evidence: CardEvidence): ExaminedCard['classification'] {
  // An explicit technical marker outranks a non-technical word appearing
  // incidentally in the same card.
  if (evidence.technicalTerm !== null) {
    return 'technical';
  }
  if (evidence.nonTechnicalTerm !== null) {
    return 'non-technical';
  }
  return 'unknown';
}

function signalsFor(card: ExaminedCard, viaExclusion: boolean): DetectionSignal[] {
  const signals: DetectionSignal[] = [];

  if (card.evidence.fromAttribute) {
    signals.push('category-attribute');
  }
  if (card.evidence.fromLabel || (card.evidence.technicalTerm !== null && !card.evidence.fromAttribute)) {
    signals.push('category-label');
  }
  if (card.evidence.hasTopicStructure) {
    signals.push('structure-signature');
  }
  if (viaExclusion) {
    signals.push('category-exclusion');
  }

  return signals;
}

/**
 * Evidence weights.
 *
 * Elimination scores as highly as a stated label on purpose: when every other
 * card names a non-technical category, the remaining one is identified by a
 * complete partition, not by a guess.
 */
function scoreFor(card: ExaminedCard, viaExclusion: boolean): number {
  let score = 0;

  if (card.evidence.fromAttribute) {
    score += 0.8;
  } else if (card.evidence.technicalTerm !== null) {
    score += 0.6;
  }

  if (viaExclusion) {
    score += 0.6;
  }

  if (card.evidence.hasTopicStructure) {
    score += 0.3;
  }

  return Math.min(1, Number(score.toFixed(2)));
}

export function toCandidate(card: ExaminedCard, chosen: boolean, viaExclusion: boolean): TaskCandidate {
  const candidate: TaskCandidate = {
    title: card.title.slice(0, 200),
    classification: card.classification,
    score: chosen ? scoreFor(card, viaExclusion) : card.classification === 'non-technical' ? 0 : 0.1,
    matchedSignals: chosen
      ? signalsFor(card, viaExclusion)
      : card.classification === 'non-technical'
        ? ['category-exclusion']
        : [],
  };

  const label = card.evidence.technicalTerm ?? card.evidence.nonTechnicalTerm;
  return label === null ? candidate : { ...candidate, categoryLabel: label };
}

/**
 * Which card the portal is currently showing.
 *
 * Needed because Brotomap only plans technical tasks: if the student is looking
 * at Personal Development or Communication, the honest answer is to say so, not
 * to quietly swap their task for a different one.
 *
 * Selection is read from an accessible marker when the portal exposes one, and
 * otherwise from the fact that a selected card simply looks different - the one
 * card whose border, outline, shadow or background differs from all the others.
 * Returns null when nothing distinguishes them, which is the safe answer: the
 * caller then falls back to opening the technical task.
 */
export function findSelectedCard(cards: ExaminedCard[]): ExaminedCard | null {
  for (const card of cards) {
    for (const marker of ACTIVE_MARKERS) {
      if (card.element.matches(marker)) {
        return card;
      }
    }
  }

  const signatures = cards.map((card) => selectionSignature(card.element));
  const counts = new Map<string, number>();

  for (const signature of signatures) {
    counts.set(signature, (counts.get(signature) ?? 0) + 1);
  }

  // Exactly two looks, one of them belonging to a single card: that card is the
  // odd one out, and the odd one out is the selected one.
  if (counts.size !== 2 || cards.length < 3) {
    return null;
  }

  const uniqueIndex = signatures.findIndex((signature) => counts.get(signature) === 1);
  return uniqueIndex === -1 ? null : (cards[uniqueIndex] ?? null);
}

function selectionSignature(element: Element): string {
  try {
    const style = element.ownerDocument.defaultView?.getComputedStyle(element);

    if (style === undefined) {
      return '';
    }

    return [
      style.borderColor,
      style.borderWidth,
      style.outlineColor,
      style.boxShadow,
      style.backgroundColor,
    ].join('|');
  } catch {
    return '';
  }
}

export type Decision =
  | { kind: 'chosen'; card: ExaminedCard; score: number; signals: DetectionSignal[]; viaExclusion: boolean }
  | { kind: 'ambiguous'; contenders: ExaminedCard[] }
  | { kind: 'none' };

/**
 * Four ways to arrive at exactly one card, in order of how much we trust them.
 * Anything short of exactly one is reported as ambiguous, never guessed.
 */
export function decide(cards: ExaminedCard[]): Decision {
  const choose = (card: ExaminedCard, viaExclusion: boolean): Decision => ({
    kind: 'chosen',
    card,
    score: scoreFor(card, viaExclusion),
    signals: signalsFor(card, viaExclusion),
    viaExclusion,
  });

  const technical = cards.filter((card) => card.classification === 'technical');

  // 1. Exactly one card says it is technical.
  if (technical.length === 1) {
    return choose(technical[0] as ExaminedCard, false);
  }

  // 2. Several say so — the topic structure breaks the tie.
  if (technical.length > 1) {
    const structured = technical.filter((card) => card.evidence.hasTopicStructure);
    return structured.length === 1 ? choose(structured[0] as ExaminedCard, false) : { kind: 'ambiguous', contenders: technical };
  }

  const unknown = cards.filter((card) => card.classification === 'unknown');

  // 3. Nothing is labelled technical, and exactly one card is not labelled at
  //    all: the others declared themselves, so this is the technical task.
  if (unknown.length === 1) {
    return choose(unknown[0] as ExaminedCard, true);
  }

  // 4. Several unlabelled cards — only topic structure can single one out.
  if (unknown.length > 1) {
    const structured = unknown.filter((card) => card.evidence.hasTopicStructure);
    return structured.length === 1 ? choose(structured[0] as ExaminedCard, true) : { kind: 'ambiguous', contenders: unknown };
  }

  return { kind: 'none' };
}

export function confidenceFor(score: number): 'high' | 'medium' | 'low' {
  if (score >= 0.8) {
    return 'high';
  }
  return score >= 0.5 ? 'medium' : 'low';
}
