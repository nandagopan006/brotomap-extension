import { PRIORITY_LABELS } from '../types/index.js';
import type {
  FiveDayPlan,
  KnowledgeMap,
  KnowledgeNode,
  PracticePlan,
  TaskUnderstanding,
} from '../types/index.js';

/**
 * The roadmap, rendered once and shown in two places.
 *
 * Two decisions shape it. Topics are nested rather than listed flat, because a
 * subtopic under its parent is understood at a glance and the same subtopic in
 * a numbered list of fifty is not. And no time estimates are shown: they are
 * used to balance the five days and nothing else. A student does not need to be
 * told a topic takes forty-five minutes; they need to know what to do today.
 */

export interface RoadmapProps {
  moduleTitle: string;
  taskTitle: string;
  understanding: TaskUnderstanding;
  knowledge: KnowledgeMap;
  practice?: PracticePlan;
  plan?: FiveDayPlan;
  topicsRead?: number;
  topicsDeclared?: number;
  warnings?: string[];
}

export function RoadmapView({
  moduleTitle,
  taskTitle,
  understanding,
  knowledge,
  practice,
  plan,
  topicsRead,
  topicsDeclared,
  warnings = [],
}: RoadmapProps): React.JSX.Element {
  const byId = new Map(knowledge.nodes.map((node) => [node.id, node]));
  const supporting = knowledge.nodes.filter((node) => node.category === 'supporting');

  return (
    <>
      <h1 style={{ fontSize: 15, marginBottom: 2 }}>{taskTitle}</h1>
      <p className="muted small">
        {moduleTitle}
        {topicsRead === undefined ? '' : ` · read ${topicsRead} task topics`} ·{' '}
        {knowledge.totals.nodeCount} things to learn
      </p>

      {/*
        A roadmap built from two of five topics looks exactly like a roadmap for
        a two-topic task. The only way to tell is to say so.
      */}
      {topicsDeclared !== undefined && topicsRead !== undefined && topicsDeclared !== topicsRead && (
        <div className="status small">
          The portal says this task has {topicsDeclared} topics, but only {topicsRead} could be read.
          This roadmap covers those {topicsRead}. Open the task page so every topic is on screen,
          then generate again.
        </div>
      )}

      {warnings.map((warning) => (
        <div key={warning} className="status small muted">
          {warning}
        </div>
      ))}

      <h2>Summary</h2>
      <p>{understanding.summary}</p>

      {plan !== undefined && <FiveDays plan={plan} byId={byId} practice={practice} />}

      <h2>Everything to learn</h2>
      <p className="muted small">
        Nested by topic. <strong>Must</strong> is required for the task,{' '}
        <em>should</em> is needed to understand it, and the rest is optional depth.
      </p>
      <Outline nodes={knowledge.nodes} parentId={null} />

      <h2>What the task did not say ({supporting.length})</h2>
      {supporting.length === 0 ? (
        <p className="muted">Nothing extra was found, which is unusual — worth a second look.</p>
      ) : (
        <ul>
          {supporting.map((node) => (
            <li key={node.id}>
              <strong>{node.title}</strong>
              <div className="muted small">{node.whyItMatters}</div>
            </li>
          ))}
        </ul>
      )}

      <h2>What the task requires ({understanding.requirements.length})</h2>
      <ul>
        {understanding.requirements.map((requirement) => (
          <li key={requirement.id}>
            <strong>{requirement.id}</strong> {requirement.text}
            {requirement.source === 'implicit' && <span className="muted small"> · implied</span>}
          </li>
        ))}
      </ul>

      {understanding.ambiguities.length > 0 && (
        <>
          <h2>Unclear in the task</h2>
          <ul>
            {understanding.ambiguities.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
        </>
      )}
    </>
  );
}

/** Topics, with their subtopics under them, to any depth the map has. */
function Outline({
  nodes,
  parentId,
}: {
  nodes: KnowledgeNode[];
  parentId: string | null;
}): React.JSX.Element | null {
  const children = nodes.filter((node) => node.parentId === parentId);

  if (children.length === 0) {
    return null;
  }

  return (
    <ul>
      {children.map((node) => (
        <li key={node.id}>
          {node.title}
          <Priority node={node} />
          {node.parentId === null && <div className="muted small">{node.whyItMatters}</div>}
          <Outline nodes={nodes} parentId={node.id} />
        </li>
      ))}
    </ul>
  );
}

/** What kind of thing this is, in words rather than a number. */
function Priority({ node }: { node: KnowledgeNode }): React.JSX.Element {
  const priority = node.priority ?? 'P2';

  const parts = [
    `${priority} ${PRIORITY_LABELS[priority]}`,
    node.difficulty,
    ...(node.category === 'supporting' ? ['not in the task'] : []),
  ];

  return <span className="muted small"> — {parts.join(', ')}</span>;
}

/**
 * The week.
 *
 * Days rather than hours: the question a student has on Tuesday morning is
 * "what am I doing today", and an hour count does not answer it.
 */
function FiveDays({
  plan,
  byId,
  practice,
}: {
  plan: FiveDayPlan;
  byId: Map<string, KnowledgeNode>;
  practice?: PracticePlan;
}): React.JSX.Element {
  const practiceById = new Map((practice?.items ?? []).map((item) => [item.id, item]));

  return (
    <>
      <h2>The five days</h2>

      {plan.days.map((day) => (
        <div key={day.day} className="status" style={{ marginTop: 8 }}>
          <strong>
            Day {day.day} · {day.stage.toUpperCase()} — {day.theme}
          </strong>
          <div className="muted small">{day.focus}</div>

          {day.blocks.map((block, index) => (
            <div key={`${day.day}-${index}`} style={{ marginTop: 6 }}>
              {block.kind === 'learn' ? (
                <>
                  <div className="small">Learn</div>
                  <ul>
                    {block.topicIds.map((id) => (
                      <li key={id}>{byId.get(id)?.title ?? id}</li>
                    ))}
                  </ul>
                </>
              ) : (
                <>
                  <div className="small">
                    {block.kind === 'checkpoint' ? 'Checkpoint' : block.kind === 'review' ? 'Review' : 'Practice'}
                    : {block.title}
                  </div>
                  {block.practiceIds.map((id) => {
                    const item = practiceById.get(id);
                    return item === undefined ? null : (
                      <div key={id} className="muted small">
                        {item.description}
                      </div>
                    );
                  })}
                  {block.notes !== undefined && block.practiceIds.length === 0 && (
                    <div className="muted small">{block.notes}</div>
                  )}
                </>
              )}
            </div>
          ))}

          <div className="muted small" style={{ marginTop: 6 }}>
            <div>Expected outcome: {day.expectedOutcome}</div>
            <div>Done when: {day.endOfDayCheckpoint}</div>
          </div>
        </div>
      ))}

      {plan.beyondThisWeek.topicIds.length > 0 && (
        <p className="muted small">
          Left for later: {plan.beyondThisWeek.topicIds.length} optional topics.{' '}
          {plan.beyondThisWeek.reason}
        </p>
      )}
    </>
  );
}
