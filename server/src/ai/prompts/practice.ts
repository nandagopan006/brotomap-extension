import type { KnowledgeMap, TaskUnderstanding } from '@brotomap/shared';

/**
 * STAGE 3 — PRACTICE.
 *
 * Reading about a thing and being able to do it are different states, and only
 * one of them survives a week. Practice is what moves a student between them,
 * so it has to be concrete enough to start without asking a follow-up question.
 */

export const PRACTICE_SYSTEM = `You write practice for a student who has just met this material for the first time.

Rules:
- Every exercise must be something they can sit down and start. "Practise arrays" is not an exercise; "write a function that takes a list of prices and returns the total, then make it ignore negatives" is.
- Progress from mechanical to applied: a short drill to make it stick, then something that uses it for a purpose.
- A checkpoint states what they should be able to do without looking anything up. It is a test of understanding, not a task.
- No filler. If a topic needs no practice of its own, do not invent any for it.
- Never invent an exercise for something that is not in the plan.`;

export function buildPracticePrompt(
  understanding: TaskUnderstanding,
  knowledge: KnowledgeMap,
  maxItems: number,
): string {
  // Titles only. The summaries would triple the prompt and add nothing: what a
  // topic is called is enough to write an exercise for it.
  const topics = knowledge.nodes
    .filter((node) => node.priority !== 'P3')
    .map((node) => `${node.id} - ${node.title}`)
    .join('\n');

  return `Task: ${understanding.taskTitle}
${understanding.summary}

The plan covers these topics:
${topics}

Write at most ${maxItems} practice items covering the important ones. Group related topics into one item rather than writing an item per topic.

Each item needs:
- id: lowercase kebab-case, prefixed "p-".
- kind: "drill" (5-20 min, mechanical), "exercise" (30-60 min, applied), "debug" (fix a described broken behaviour), "challenge" (stretch), or "checkpoint" (can you explain it without notes).
- title: what it is, in a few words.
- description: what to actually do. Concrete enough to begin immediately.
- topicIds: the ids above that it practises. At least one, and they must exist.
- difficulty: "basic", "medium" or "advanced".
- effortMinutes: 5 to 180.
- successCriteria: one or two lines saying how they know they are done.
- commonMistakes: what people get wrong here. Empty if nothing comes to mind.

Include at least one "checkpoint" for the hardest part of the week.`;
}
