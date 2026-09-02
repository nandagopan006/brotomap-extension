import { PRIORITY_LABELS } from '@brotomap/shared';
import type {
  FiveDayPlan,
  KnowledgeMap,
  KnowledgeNode,
  PracticePlan,
  TaskUnderstanding,
} from '@brotomap/shared';

/**
 * The roadmap, as Notion blocks.
 *
 * A PDF is a record of what you were told to learn. A Notion page can be a
 * record of what you have learned, which is worth more for the same content:
 * the learning order becomes checkboxes, and the week's progress is visible
 * without anybody writing a progress tracker.
 */

/** Notion refuses a rich text value longer than this. */
const MAX_TEXT = 1900;

export interface NotionBlock {
  object: 'block';
  type: string;
  [key: string]: unknown;
}

function text(content: string, bold = false): unknown {
  return {
    type: 'text',
    text: { content: content.slice(0, MAX_TEXT) },
    annotations: bold ? { bold: true } : undefined,
  };
}

function heading(content: string): NotionBlock {
  return { object: 'block', type: 'heading_2', heading_2: { rich_text: [text(content)] } };
}

function paragraph(content: string): NotionBlock {
  return { object: 'block', type: 'paragraph', paragraph: { rich_text: [text(content)] } };
}

function bullet(parts: unknown[]): NotionBlock {
  return { object: 'block', type: 'bulleted_list_item', bulleted_list_item: { rich_text: parts } };
}

function todo(parts: unknown[]): NotionBlock {
  return { object: 'block', type: 'to_do', to_do: { rich_text: parts, checked: false } };
}

function callout(content: string): NotionBlock {
  return {
    object: 'block',
    type: 'callout',
    callout: { rich_text: [text(content)], icon: { type: 'emoji', emoji: '📌' } },
  };
}

export interface RoadmapPage {
  title: string;
  blocks: NotionBlock[];
}

function heading3(content: string): NotionBlock {
  return { object: 'block', type: 'heading_3', heading_3: { rich_text: [text(content)] } };
}

/** A checkbox, indented under its parent topic. */
function nested(node: KnowledgeNode, depth: number): unknown[] {
  const priority = node.priority ?? 'P2';

  const label = [
    `${priority} ${PRIORITY_LABELS[priority]}`,
    node.difficulty,
    ...(node.category === 'supporting' ? ['not in the task'] : []),
  ].join(', ');

  return [text(`${'— '.repeat(Math.min(depth, 3))}${node.title}`), text(`  (${label})`)];
}

export function buildRoadmapPage(
  moduleTitle: string,
  taskTitle: string,
  understanding: TaskUnderstanding,
  knowledge: KnowledgeMap,
  practice?: PracticePlan,
  plan?: FiveDayPlan,
): RoadmapPage {
  const byId = new Map(knowledge.nodes.map((node) => [node.id, node]));
  const supporting = knowledge.nodes.filter((node) => node.category === 'supporting');
  const hours = (knowledge.totals.effortMinutes / 60).toFixed(1);

  const blocks: NotionBlock[] = [
    callout(`${moduleTitle} · ${knowledge.totals.nodeCount} things to learn · about ${hours} hours`),
    paragraph(understanding.summary),

    heading('Learning objectives'),
    ...understanding.learningObjectives.map((objective) => bullet([text(objective)])),

    heading(`What the task requires (${understanding.requirements.length})`),
    ...understanding.requirements.map((requirement) =>
      bullet([
        text(`${requirement.id} `, true),
        text(requirement.text),
        ...(requirement.source === 'implicit' ? [text(' (implied)')] : []),
      ]),
    ),
  ];

  // The part worth reading first: nothing here was named by the task.
  if (supporting.length > 0) {
    blocks.push(heading(`What the task did not say (${supporting.length})`));

    for (const node of supporting) {
      blocks.push(bullet([text(`${node.title} — `, true), text(node.whyItMatters)]));
    }
  }

  // The week, day by day, as checkboxes. This is the reason to prefer a page to
  // a document: the plan becomes something you tick off as you go.
  if (plan !== undefined) {
    blocks.push(heading('The five days'));

    for (const day of plan.days) {
      blocks.push(heading3(`Day ${day.day} · ${day.stage.toUpperCase()} — ${day.theme}`));
      blocks.push(paragraph(day.focus));

      for (const block of day.blocks) {
        if (block.kind === 'learn') {
          for (const id of block.topicIds) {
            const node = byId.get(id);
            if (node !== undefined) {
              blocks.push(todo([text(node.title)]));
            }
          }
          continue;
        }

        const item = practice?.items.find((entry) => entry.id === block.practiceIds[0]);
        blocks.push(todo([text(`${block.title}`, true)]));

        if (item !== undefined) {
          blocks.push(paragraph(item.description));
        } else if (block.notes !== undefined) {
          blocks.push(paragraph(block.notes));
        }
      }

      blocks.push(paragraph(`Expected outcome: ${day.expectedOutcome}`));
      blocks.push(paragraph(`Done when: ${day.endOfDayCheckpoint}`));
    }
  }

  // Every topic, nested under its parent, so the shape of the subject is
  // visible rather than flattened into a list of fifty things.
  blocks.push(heading('Everything to learn'));

  const render = (parentId: string | null, depth: number): void => {
    for (const node of knowledge.nodes.filter((entry) => entry.parentId === parentId)) {
      blocks.push(todo(nested(node, depth)));
      render(node.id, depth + 1);
    }
  };

  render(null, 0);

  if (understanding.ambiguities.length > 0) {
    blocks.push(heading('Unclear in the task'));
    blocks.push(...understanding.ambiguities.map((item) => bullet([text(item)])));
  }

  return { title: `${taskTitle} — ${moduleTitle}`, blocks };
}
