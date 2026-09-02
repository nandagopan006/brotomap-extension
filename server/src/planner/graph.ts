import type { BrokenEdge, KnowledgeMap, KnowledgeNode, Priority } from '@brotomap/shared';

/**
 * THE GRAPH — pure code, no AI.
 *
 * A model can say what depends on what. It cannot be trusted to order fifty
 * nodes consistently, and asking it to would make the result different every
 * run for no benefit. Ordering is graph theory: it is exact, it is fast, and it
 * turns "the prerequisites are respected" from a hope into a guarantee.
 *
 * Everything here is deterministic. The same map always produces the same
 * sequence, which is what makes a bad roadmap reproducible enough to debug.
 */

export interface GraphResult {
  map: KnowledgeMap;
  /** Problems found and corrected. Reported, never silently swallowed. */
  repairs: string[];
}

const LEVEL_ORDER = { topic: 0, subtopic: 1, concept: 2 } as const;
const CATEGORY_ORDER = { explicit: 0, supporting: 1, optional: 2 } as const;
const DIFFICULTY_ORDER = { basic: 0, medium: 1, advanced: 2 } as const;

/**
 * Cleans the model's map, then orders it.
 *
 * A model produces near-misses: a prerequisite naming a node that does not
 * exist, a parent that was renamed, occasionally a cycle. None of those are
 * worth failing a run over, and all of them are worth reporting.
 */
export function buildGraph(nodes: KnowledgeNode[]): GraphResult {
  const repairs: string[] = [];
  const deduped = dedupe(nodes, repairs);
  const byId = new Map(deduped.map((node) => [node.id, node]));

  const cleaned = deduped.map((node) => ({
    ...node,
    parentId: node.parentId !== null && byId.has(node.parentId) ? node.parentId : orphan(node, byId, repairs),
    prerequisites: node.prerequisites.filter((id) => {
      if (id === node.id) {
        repairs.push(`"${node.id}" listed itself as a prerequisite.`);
        return false;
      }
      if (!byId.has(id)) {
        repairs.push(`"${node.id}" required "${id}", which does not exist.`);
        return false;
      }
      return true;
    }),
  }));

  const { order, brokenEdges } = topologicalOrder(cleaned);
  const depthById = computeDepths(cleaned);

  const finished = cleaned.map((node) => ({
    ...node,
    priority: priorityFor(node),
    depth: depthById.get(node.id) ?? 0,
    prerequisites: node.prerequisites.filter(
      (id) => !brokenEdges.some((edge) => edge.to === node.id && edge.from === id),
    ),
  }));

  for (const edge of brokenEdges) {
    repairs.push(`Broke a dependency cycle by removing "${edge.from}" -> "${edge.to}".`);
  }

  return { map: { nodes: finished, sequence: order, brokenEdges, totals: totalsFor(finished) }, repairs };
}

function dedupe(nodes: KnowledgeNode[], repairs: string[]): KnowledgeNode[] {
  const seen = new Map<string, KnowledgeNode>();

  for (const node of nodes) {
    if (seen.has(node.id)) {
      repairs.push(`Dropped a second node with the id "${node.id}".`);
      continue;
    }
    seen.set(node.id, node);
  }

  return [...seen.values()];
}

/** A parent that does not exist makes the node a root rather than an error. */
function orphan(node: KnowledgeNode, byId: Map<string, KnowledgeNode>, repairs: string[]): null {
  if (node.parentId !== null && !byId.has(node.parentId)) {
    repairs.push(`"${node.id}" had parent "${node.parentId}", which does not exist; treated as a top-level topic.`);
  }
  return null;
}

/**
 * Kahn's algorithm, with a deliberate tie-break.
 *
 * Several nodes are usually ready at once, and which comes first decides how the
 * week reads. Foundations before detail, required before optional, easy before
 * hard: the order a person would teach it in.
 */
export function topologicalOrder(nodes: KnowledgeNode[]): {
  order: string[];
  brokenEdges: BrokenEdge[];
} {
  const byId = new Map(nodes.map((node) => [node.id, node]));
  const remaining = new Map(nodes.map((node) => [node.id, new Set(node.prerequisites)]));
  const order: string[] = [];
  const brokenEdges: BrokenEdge[] = [];

  while (remaining.size > 0) {
    const ready = [...remaining.entries()]
      .filter(([, prerequisites]) => prerequisites.size === 0)
      .map(([id]) => id);

    if (ready.length === 0) {
      // Everything left is in a cycle. Break the weakest link - the dependency
      // of the least foundational node - and carry on, saying so.
      const edge = weakestEdge(remaining, byId);

      if (edge === null) {
        break;
      }

      brokenEdges.push(edge);
      remaining.get(edge.to)?.delete(edge.from);
      continue;
    }

    ready.sort((left, right) => compareReady(byId.get(left), byId.get(right)));

    for (const id of ready) {
      order.push(id);
      remaining.delete(id);
    }

    for (const prerequisites of remaining.values()) {
      for (const id of ready) {
        prerequisites.delete(id);
      }
    }
  }

  return { order, brokenEdges };
}

function compareReady(left: KnowledgeNode | undefined, right: KnowledgeNode | undefined): number {
  if (left === undefined || right === undefined) {
    return 0;
  }

  return (
    LEVEL_ORDER[left.level] - LEVEL_ORDER[right.level] ||
    // The portal's own topic order is a teaching order somebody chose. Where
    // dependencies do not decide, it should.
    firstTopic(left) - firstTopic(right) ||
    CATEGORY_ORDER[left.category] - CATEGORY_ORDER[right.category] ||
    DIFFICULTY_ORDER[left.difficulty] - DIFFICULTY_ORDER[right.difficulty] ||
    left.effortMinutes - right.effortMinutes ||
    left.id.localeCompare(right.id)
  );
}

/** The earliest portal topic a node serves, or last if it serves none. */
function firstTopic(node: KnowledgeNode): number {
  return node.coversTopicIndexes.length === 0 ? Number.MAX_SAFE_INTEGER : Math.min(...node.coversTopicIndexes);
}

/** The edge to sacrifice: the one leaving the least foundational node. */
function weakestEdge(
  remaining: Map<string, Set<string>>,
  byId: Map<string, KnowledgeNode>,
): BrokenEdge | null {
  const candidates = [...remaining.entries()]
    .filter(([, prerequisites]) => prerequisites.size > 0)
    .sort(([leftId], [rightId]) => -compareReady(byId.get(leftId), byId.get(rightId)));

  const worst = candidates[0];

  if (worst === undefined) {
    return null;
  }

  const [to, prerequisites] = worst;
  const from = [...prerequisites].sort()[0];

  return from === undefined ? null : { from, to, reason: 'part of a dependency cycle' };
}

function computeDepths(nodes: KnowledgeNode[]): Map<string, number> {
  const byId = new Map(nodes.map((node) => [node.id, node]));
  const depths = new Map<string, number>();

  const depthOf = (id: string, seen: Set<string>): number => {
    const cached = depths.get(id);

    if (cached !== undefined) {
      return cached;
    }

    const node = byId.get(id);

    // A parent chain that loops is impossible after cleaning, but a depth
    // function that can hang is not worth the risk.
    if (node === undefined || node.parentId === null || seen.has(id)) {
      return 0;
    }

    seen.add(id);
    const depth = depthOf(node.parentId, seen) + 1;
    depths.set(id, depth);
    return depth;
  };

  for (const node of nodes) {
    depths.set(node.id, depthOf(node.id, new Set()));
  }

  return depths;
}

/**
 * A first pass at priority, from what kind of thing the node is.
 *
 * Refined afterwards by the graph: a topic several others depend on is more
 * necessary than one nothing depends on, whatever category it was given, and
 * that is a fact about the graph rather than a judgement.
 */
function priorityFor(node: KnowledgeNode): Priority {
  switch (node.category) {
    case 'optional':
      return 'P3';
    case 'supporting':
      return 'P2';
    default:
      return 'P1';
  }
}

function totalsFor(nodes: KnowledgeNode[]): KnowledgeMap['totals'] {
  const count = (predicate: (node: KnowledgeNode) => boolean): number => nodes.filter(predicate).length;

  return {
    nodeCount: nodes.length,
    effortMinutes: nodes.reduce((sum, node) => sum + node.effortMinutes, 0),
    byCategory: {
      explicit: count((node) => node.category === 'explicit'),
      supporting: count((node) => node.category === 'supporting'),
      optional: count((node) => node.category === 'optional'),
    },
    byDifficulty: {
      basic: count((node) => node.difficulty === 'basic'),
      medium: count((node) => node.difficulty === 'medium'),
      advanced: count((node) => node.difficulty === 'advanced'),
    },
  };
}

/**
 * Settles priority using the graph, once the dependency direction is known.
 *
 * Two rules, both of which a model gets subtly wrong and code gets right every
 * time:
 *
 *  - anything the task named that others build on is P0. Not because it is
 *    hard, but because nothing after it makes sense without it.
 *  - anything a P0 topic depends on is itself P0, however it was categorised.
 *    A prerequisite of essential work is essential, even when the task never
 *    mentioned it - which is precisely the case for the topics students get
 *    stuck on.
 */
export function promoteRequiredPrerequisites(map: KnowledgeMap): KnowledgeMap {
  const dependents = new Map<string, number>();

  for (const node of map.nodes) {
    for (const prerequisite of node.prerequisites) {
      dependents.set(prerequisite, (dependents.get(prerequisite) ?? 0) + 1);
    }
  }

  /**
   * P0 is about blocking progress, not about difficulty.
   *
   * A topic the task named that others build on is P0: nothing after it makes
   * sense until it is understood. A topic the task named that nothing depends
   * on is P1 - needed to do the work, but not in the way of anything else.
   */
  const foundational = (node: KnowledgeNode): boolean =>
    node.category === 'explicit' && (dependents.get(node.id) ?? 0) > 0;

  const first = map.nodes.map((node) =>
    foundational(node) ? { ...node, priority: 'P0' as Priority } : node,
  );

  const essential = new Set<string>();
  const byIdFirst = new Map(first.map((node) => [node.id, node]));

  const mark = (id: string): void => {
    if (essential.has(id)) {
      return;
    }
    essential.add(id);
    for (const prerequisite of byIdFirst.get(id)?.prerequisites ?? []) {
      mark(prerequisite);
    }
  };

  // Only prerequisites are walked, never the node itself: marking the node
  // would promote every P1 to P0 and collapse the distinction the levels exist
  // to make. A prerequisite of work that must happen this week must also
  // happen this week; the work itself keeps the priority it earned.
  for (const node of first) {
    if (node.priority === 'P0' || node.priority === 'P1') {
      for (const prerequisite of node.prerequisites) {
        mark(prerequisite);
      }
    }
  }

  return {
    ...map,
    nodes: first.map((node) =>
      // Optional depth stays optional: a P3 topic nobody has to reach is not
      // made essential by something happening to list it.
      node.priority !== 'P3' && essential.has(node.id) ? { ...node, priority: 'P0' } : node,
    ),
  };
}
