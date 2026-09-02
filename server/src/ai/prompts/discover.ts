import type { TaskUnderstanding } from '@brotomap/shared';

/**
 * STAGE 2 — DISCOVER, and the reason this product exists.
 *
 * A weekly task states a destination. It does not state the road: the
 * prerequisites nobody wrote down are the actual reason a task is hard, and a
 * plan built only from the task's own bullet points teaches a student what they
 * were already told.
 *
 * So this stage is not asked to reorganise the task. It is asked a different
 * question: what must somebody who does not yet know this understand, end to
 * end, for the task to be possible?
 */

export const DISCOVER_SYSTEM = `You are building the complete learning surface for a student who does NOT yet know this material.

Your job is to work out everything they must understand for the task to be possible - including, above all, the things the task never mentions.

THE ONE THING THAT MATTERS MOST:

A task states a destination, not a road. What stops students is never the topic they were given a name for; it is the thing underneath it that nobody wrote down. Finding those is the job.

  A task says "JWT authentication".
  It does not say: HTTP headers, request and response shape, what stateless
  means, why a signature is not encryption, where a browser can store a token.
  A student who does not know those cannot do the task, and nobody told them.

  A task says "state management".
  It does not say: how references differ from values, why mutating an object
  does not always re-render, what a pure function is.

Those unstated prerequisites are marked "supporting", and they are the output that has value. A map made only of "explicit" nodes has restated the task and helped nobody.

Rules you must not break:
- At least a third of your nodes must be "supporting". If you cannot find that many, you have not looked underneath the topics yet.
- Do not restate the task's topic titles as your answer. Anything the task already said is the starting point, not the output.
- Include what the task assumes. A task about tokens assumes HTTP headers; a task about state assumes functions and scope. Those assumptions are where students actually get stuck, and they are the most valuable thing you produce.
- Break topics down until each leaf is something learnable in one sitting - fifteen to ninety minutes. "Learn JavaScript" is not a topic; "the difference between var, let and const" is.
- Every node must say why it matters for THIS task. If you cannot, it does not belong.
- No filler. No "read the documentation", no tool tourism, no vendor names for their own sake.
- Mark what a student at this stage plausibly already knows as review rather than dropping it - they may need to check, and you may be wrong about what they know.`;

const NEWLINE = String.fromCharCode(10);

export function buildDiscoverPrompt(
  understanding: TaskUnderstanding,
  maxNodes: number,
  /** The topics this call covers. Empty means all of them. */
  topicIndexes: number[] = [],
  /**
   * Nodes an earlier call already created.
   *
   * Without these, a later chunk names prerequisites that exist only in its own
   * imagination, and real dependencies are dropped as dangling. Splitting the
   * work is only safe if each part can see what the others built.
   */
  existing: { id: string; title: string }[] = [],
): string {
  const inScope = (index: number): boolean =>
    topicIndexes.length === 0 || topicIndexes.includes(index);

  const requirements = understanding.requirements
    .filter(
      (requirement) =>
        requirement.fromTopicIndexes.length === 0 ||
        requirement.fromTopicIndexes.some(inScope),
    )
    .map((requirement) => `${requirement.id} (${requirement.kind}): ${requirement.text}`)
    .join('\n');

  const topics = understanding.topicInterpretations
    .filter((topic) => inScope(topic.index))
    .map((topic) => `${topic.index}. ${topic.title} - ${topic.interpretation}`)
    .join('\n');

  return `Task: ${understanding.taskTitle}
Module: ${understanding.moduleTitle}
Domain: ${understanding.domain}${understanding.stack.length > 0 ? `\nTechnologies named: ${understanding.stack.join(', ')}` : ''}

What the week is for:
${understanding.summary}

What the task explicitly requires:
${requirements}

The topics this map must cover:
${topics}

${
    existing.length === 0
      ? ''
      : `Nodes another part of this map already covers. Do NOT create these again, but DO reference them by id in "prerequisites" where they genuinely come first:
${existing.map((node) => `  ${node.id} - ${node.title}`).join(NEWLINE)}

`
  }The student is assumed to already know:
${understanding.assumedKnowledge.length === 0 ? '(nothing stated)' : understanding.assumedKnowledge.join(', ')}

Build the knowledge map.

Structure it as a flat list of nodes with parent links, at most three levels deep:
  topic  ->  subtopic  ->  concept

Each node needs:
- id: lowercase kebab-case, stable and unique, prefixed "t-" (e.g. "t-scope-and-hoisting").
- parentId: null for a top-level topic, otherwise the id of its parent. A parent must appear in the list.
- level: "topic", "subtopic" or "concept".
- category:
    * "explicit"   - named by the task
    * "supporting" - NOT named, but required to understand or complete the task
    * "optional"   - useful depth that is not needed this week
- difficulty: "basic", "medium" or "advanced", judged for someone meeting it for the first time.
- status: "learn", or "review" if the student plausibly knows it already.
- effortMinutes: 15 to 180, in steps of 15. Be honest: a first encounter with a hard idea is not 15 minutes.
- summary: ONE short sentence on what it is. Brevity here is what makes room for more nodes.
- whyItMatters: one short line tying it to THIS task.
- prerequisites: ids of nodes that must come first. Leave empty for foundations. Never create a cycle.
- coversRequirements: which R-ids this addresses. Empty is fine for a supporting prerequisite.
- coversTopicIndexes: which portal topic numbers this comes from. Empty for something the task never mentioned.

Aim for 30 to ${maxNodes} nodes, and at least a third of them "supporting".

Before you answer, go through the explicit topics one at a time and ask: what
does a student need to already understand for this sentence to make sense? Those
answers are the supporting nodes. A map without them has failed.`;
}
