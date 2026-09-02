import type {
  DayPlan,
  DayStage,
  FiveDayPlan,
  KnowledgeMap,
  KnowledgeNode,
  PlanBlock,
  PlanOptions,
  PracticePlan,
} from '@brotomap/shared';

/**
 * THE FIVE DAYS — pure code, no AI.
 *
 * The week follows a teaching progression, not an even division of topics:
 *
 *   1  learn       meet the material: what these things are
 *   2  understand  how they fit together, and why they work that way
 *   3  practice    use them
 *   4  build       make something with them
 *   5  revise      close the gaps, then finish the task
 *
 * Learning a thing and understanding it are different activities, and a plan
 * that runs them together does neither. The dependency order does the splitting
 * for us: it already puts foundations first, so the front of the sequence is
 * exactly what day one is for.
 *
 * Effort estimates balance the days and are never shown. A student does not
 * need to be told a topic takes forty-five minutes; they need to know what to
 * do today, and that today is not twice as long as yesterday.
 */

const STAGES: Record<number, DayStage> = {
  1: 'learn',
  2: 'understand',
  3: 'practice',
  4: 'build',
  5: 'revise',
};

export function buildFiveDayPlan(
  knowledge: KnowledgeMap,
  practice: PracticePlan,
  options: PlanOptions,
): FiveDayPlan {
  const byId = new Map(knowledge.nodes.map((node) => [node.id, node]));
  const budgetMinutes = Math.round(options.weeklyHours * 60);
  const usable = Math.round(budgetMinutes * (1 - options.slackRatio));

  const ordered = knowledge.sequence
    .map((id) => byId.get(id))
    .filter((node): node is KnowledgeNode => node !== undefined);

  const { scheduled, deferred } = fitToWeek(ordered, usable - options.reviewReserveMinutes);
  const { learn, understand } = splitTeaching(scheduled);
  const { drills, applied } = splitPractice(practice);

  const days: DayPlan[] = [
    buildDay(1, learn, [], practice),
    buildDay(2, understand, [], practice),
    buildDay(3, [], drills, practice),
    buildDay(4, [], applied, practice),
    buildDay(5, [], [], practice),
  ];

  return {
    days,
    plannedMinutes: days.reduce((sum, day) => sum + day.totalMinutes, 0),
    budgetMinutes,
    beyondThisWeek: {
      topicIds: deferred.map((node) => node.id),
      practiceIds: [],
      reason:
        deferred.length === 0
          ? 'Everything fitted this week.'
          : 'Optional depth, left out so the required work fits five days.',
    },
  };
}

/**
 * What fits, and what has to wait.
 *
 * Overflow is resolved by dropping optional depth first and never by quietly
 * overfilling a day: a plan that cannot be finished is not a plan, and a
 * student who falls behind on day two stops trusting the whole thing.
 */
function fitToWeek(
  ordered: KnowledgeNode[],
  capacity: number,
): { scheduled: KnowledgeNode[]; deferred: KnowledgeNode[] } {
  const total = ordered.reduce((sum, node) => sum + node.effortMinutes, 0);

  if (total <= capacity) {
    return { scheduled: ordered, deferred: [] };
  }

  const scheduled: KnowledgeNode[] = [];
  const deferred: KnowledgeNode[] = [];
  let used = 0;

  for (const node of ordered) {
    // Optional depth is what gives way when the week is full.
    if (node.priority === 'P3' && used + node.effortMinutes > capacity) {
      deferred.push(node);
      continue;
    }

    scheduled.push(node);
    used += node.effortMinutes;
  }

  return { scheduled, deferred };
}

/**
 * Day one meets the material, day two makes sense of it.
 *
 * Split by effort rather than by count, so neither day is twice the other, and
 * along the dependency order, which already puts foundations first - so the
 * front of the sequence is precisely what "learn the basics" means here.
 */
function splitTeaching(scheduled: KnowledgeNode[]): {
  learn: KnowledgeNode[];
  understand: KnowledgeNode[];
} {
  const total = scheduled.reduce((sum, node) => sum + node.effortMinutes, 0);
  const half = total / 2;

  const learn: KnowledgeNode[] = [];
  const understand: KnowledgeNode[] = [];
  let used = 0;

  for (const node of scheduled) {
    // `learn.length === 0` guards a first topic longer than half the week,
    // which would otherwise leave day one empty.
    if (used < half || learn.length === 0) {
      learn.push(node);
      used += node.effortMinutes;
    } else {
      understand.push(node);
    }
  }

  return { learn, understand };
}

/**
 * Day three practises, day four builds.
 *
 * Drills and recall checks are practice; anything applied is what you build
 * with what you now know.
 */
function splitPractice(practice: PracticePlan): {
  drills: PracticePlan['items'];
  applied: PracticePlan['items'];
} {
  const drills = practice.items.filter(
    (item) => item.kind === 'drill' || item.kind === 'question' || item.kind === 'checkpoint',
  );
  const applied = practice.items.filter((item) => !drills.includes(item));

  // A week of nothing but drills would leave day four empty; moving the longest
  // one across is better than a blank day.
  if (applied.length === 0 && drills.length > 1) {
    const longest = [...drills].sort((left, right) => right.effortMinutes - left.effortMinutes)[0];

    if (longest !== undefined) {
      return { drills: drills.filter((item) => item !== longest), applied: [longest] };
    }
  }

  return { drills, applied };
}

function buildDay(
  day: DayPlan['day'],
  learning: KnowledgeNode[],
  items: PracticePlan['items'],
  practice: PracticePlan,
): DayPlan {
  const stage = STAGES[day] ?? 'learn';
  const blocks: PlanBlock[] = [];

  if (learning.length > 0) {
    blocks.push({
      kind: 'learn',
      title: stage === 'learn' ? 'Learn' : 'Understand',
      minutes: learning.reduce((sum, node) => sum + node.effortMinutes, 0),
      topicIds: learning.map((node) => node.id),
      practiceIds: [],
      featureIds: [],
    });
  }

  for (const item of items) {
    blocks.push({
      kind: item.kind === 'checkpoint' ? 'checkpoint' : stage === 'build' ? 'build' : 'practice',
      title: item.title,
      minutes: item.effortMinutes,
      topicIds: item.topicIds,
      practiceIds: [item.id],
      featureIds: [],
      notes: item.description,
    });
  }

  if (stage === 'revise') {
    blocks.push({
      kind: 'review',
      title: 'Revisit the week and finish the task',
      minutes: 60,
      topicIds: [],
      practiceIds: [],
      featureIds: [],
      notes:
        'Go back over anything still unclear, redo the hardest exercise without looking at your answer, then complete and submit the task.',
    });
  }

  return {
    day,
    stage,
    theme: themeFor(stage, learning, items),
    focus: focusFor(stage, learning, items),
    blocks,
    totalMinutes: blocks.reduce((sum, block) => sum + block.minutes, 0),
    expectedOutcome: outcomeFor(stage, learning, items),
    endOfDayCheckpoint: checkpointFor(stage, learning, items, practice),
  };
}

/** Named after what is on it, not after a template. */
function themeFor(stage: DayStage, learning: KnowledgeNode[], items: PracticePlan['items']): string {
  const roots = learning.filter((node) => node.parentId === null);
  const named = (roots.length > 0 ? roots : learning).slice(0, 2).map((node) => node.title);

  switch (stage) {
    case 'learn':
      return named.length === 0 ? 'Learn the fundamentals' : `Learn — ${named.join(' and ')}`;
    case 'understand':
      return named.length === 0 ? 'Understand how it fits together' : `Understand — ${named.join(' and ')}`;
    case 'practice':
      return 'Practice';
    case 'build':
      return items.length === 0 ? 'Apply it to the task' : `Build — ${items[0]?.title ?? ''}`;
    default:
      return 'Revise and finish';
  }
}

function focusFor(stage: DayStage, learning: KnowledgeNode[], items: PracticePlan['items']): string {
  const essential = learning.filter((node) => node.priority === 'P0').length;
  const unstated = learning.filter((node) => node.category === 'supporting').length;

  switch (stage) {
    case 'learn':
      return [
        `${learning.length} topics`,
        essential > 0 ? `${essential} you cannot skip` : null,
        unstated > 0 ? `${unstated} the task never mentioned` : null,
      ]
        .filter((part): part is string => part !== null)
        .join(' · ');
    case 'understand':
      return `${learning.length} topics — how they connect, and why they work the way they do.`;
    case 'practice':
      return items.length === 0
        ? 'Redo the parts you were least sure about.'
        : `${items.length} exercises. Type them out rather than reading them.`;
    case 'build':
      return items.length === 0
        ? 'Put the week together into what the task asks for.'
        : 'Use what you learned on something that has to actually work.';
    default:
      return 'Nothing new. Close the gaps you found, then submit.';
  }
}

/** What the student should be able to do by the end of the day. */
function outcomeFor(
  stage: DayStage,
  learning: KnowledgeNode[],
  items: PracticePlan['items'],
): string {
  const first = learning[0]?.title;

  switch (stage) {
    case 'learn':
      return first === undefined
        ? 'You know what the week is about.'
        : `You can say what each of these is and why it exists, starting with ${first}.`;
    case 'understand':
      return 'You can explain how these pieces fit together, rather than repeating a definition back.';
    case 'practice':
      return items.length === 0
        ? 'You have written code for the parts you were least sure about.'
        : 'You have working code for each exercise, written without copying an answer.';
    case 'build':
      return 'You have built something that runs and uses what you learned this week.';
    default:
      return 'The task is finished and submitted, and you could explain any part of it.';
  }
}

function checkpointFor(
  stage: DayStage,
  learning: KnowledgeNode[],
  items: PracticePlan['items'],
  practice: PracticePlan,
): string {
  if (stage === 'revise') {
    return 'You explained the hardest idea of the week out loud, without notes, and the task is submitted.';
  }

  const checkpoint =
    items.find((item) => item.kind === 'checkpoint') ??
    practice.items.find((item) => item.kind === 'checkpoint');

  if (checkpoint !== undefined && (stage === 'practice' || stage === 'build')) {
    return checkpoint.successCriteria[0] ?? checkpoint.title;
  }

  const hardest = [...learning].sort((left, right) => right.effortMinutes - left.effortMinutes)[0];

  return hardest === undefined
    ? 'You are ready for tomorrow.'
    : `You can explain ${hardest.title} without looking it up.`;
}
