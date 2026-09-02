import type { KnowledgeNode, TaskUnderstanding } from '@brotomap/shared';

/**
 * STAGE 2b — THE GAP PASS.
 *
 * A first answer is systematically too shallow. Not because the model is bad,
 * but because producing a map and auditing a map are different jobs, and doing
 * both at once means doing neither well.
 *
 * So the map is handed back with one question: what is missing that a beginner
 * would get stuck on? That second look is where the prerequisite nobody thought
 * to mention finally appears, and it is the single highest-value call in the
 * pipeline for what it costs.
 */

export const GAPS_SYSTEM = `You are reviewing a learning plan for a student who does not yet know the material.

Your only job is to find what is missing. Someone else has already built the map; you are looking for the gaps that would stop a beginner cold.

Rules:
- Only add what is genuinely missing. Do not restate, rename or reorganise what is already there.
- The gaps that matter most are unstated prerequisites: the thing the plan assumes the student knows, which they do not.
- Be specific. "Learn more about functions" helps nobody; "how closures capture variables, and why a loop variable surprises people" does.
- If the map is genuinely complete, say so by returning no additions. An empty answer is a valid and useful one.
- Never add filler to look thorough.`;

export function buildGapsPrompt(understanding: TaskUnderstanding, nodes: KnowledgeNode[]): string {
  const existing = nodes
    .map((node) => `${node.id} [${node.category}/${node.difficulty}] ${node.title}`)
    .join('\n');

  const requirements = understanding.requirements
    .map((requirement) => `${requirement.id}: ${requirement.text}`)
    .join('\n');

  return `Task: ${understanding.taskTitle}
${understanding.summary}

What the task requires:
${requirements}

The plan that has been built (${nodes.length} nodes):
${existing}

Now answer one question: what would a student who does not know this get stuck on that is not in the list?

Look for:
- prerequisites the plan assumes but never teaches
- a jump in difficulty with nothing between the two steps
- something named in the task that no node actually covers
- a practical mechanic that theory alone will not carry - environment, tooling, or the shape of a real error message

Everything you add is, by definition, something the task did not say: mark it category "supporting" unless it is genuinely optional depth.

Return additions in the same node format:
- id, parentId (an id already in the list above, or null), level, category, difficulty, status
- effortMinutes, summary, whyItMatters
- prerequisites, coversRequirements, coversTopicIndexes, resources

Every addition must be new. If nothing is missing, return an empty list.`;
}
