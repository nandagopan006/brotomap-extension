import type { ExtractedTechnicalTask } from '@brotomap/shared';

/**
 * STAGE 1 — UNDERSTAND
 *
 * This stage interprets; it does not yet expand into a curriculum. Its job is
 * to state plainly what the week asks for, and to give every requirement an id
 * that the rest of the pipeline carries forward. Those ids are what make it
 * possible, at the end, to prove that nothing the task asked for was dropped.
 */

export const UNDERSTAND_SYSTEM = `You are analysing a weekly technical task from a software training programme.

You are reading the task, not judging it and not answering it. Report what it asks for.

Rules you must not break:
- Never invent a requirement. If it is not stated and not strictly implied, it does not exist.
- A requirement that is implied rather than stated must be marked implicit and must say why.
- Do not repeat the topic titles back as requirements. A requirement is something the student must do or must be able to do.
- Say when something is genuinely unclear. An honest "this is ambiguous" is worth more than a confident guess.
- Only describe a project if the task actually contains one.`;

export function buildUnderstandPrompt(task: ExtractedTechnicalTask): string {
  const topics = task.topics
    .map((topic) => {
      const body = topic.content.trim();
      const note = topic.complete ? '' : '\n(content could not be fully read)';
      return `### Topic ${topic.index}: ${topic.title}${note}\n${body === '' ? '(no content)' : body}`;
    })
    .join('\n\n');

  return `Module: ${task.module.title}
Technical task: ${task.task.title}
Topics on the portal: ${task.topics.length}${
    task.task.declaredTopicCount === undefined
      ? ''
      : ` (the portal declares ${task.task.declaredTopicCount})`
  }

The task, exactly as the portal states it:

${topics}

Produce:

- summary: one or two sentences saying what this week is for, in plain language.
- domain: the area of software this sits in, in a few words.
- stack: the technologies the task actually names. Empty if it names none.
- learningObjectives: what the student must be able to do by Friday. One line each.
- requirements: everything the task asks for, each with an id "R1", "R2", ... in order.
    * kind: "learn" to understand something, "build" to make something, "submit" for a deliverable, "other" otherwise.
    * source: "explicit" when the task states it, "implicit" when completing the task requires it without saying so.
    * reason: required for implicit requirements. Say what makes it necessary.
    * fromTopicIndexes: which topic numbers it came from. Empty if it applies to the whole task.
- deliverables: what must exist by the end of the week.
- topicInterpretations: for each topic, what it is really asking the student to be able to do.
    * isProject: true only when the topic is a thing to build rather than a subject to study.
- project: present true only if the task contains a project. If it does, summarise it and say which topics describe it.
- assumedKnowledge: what a student reaching this module can reasonably be assumed to know already.
- ambiguities: anything genuinely unclear about what is being asked. Empty if nothing is.`;
}
