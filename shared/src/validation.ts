import { z } from 'zod';
import { requirementIdSchema } from './common.js';

/**
 * VALIDATION
 *
 * Two sources, deliberately separated:
 *  - 'deterministic' : code. These are guarantees. Coverage, ordering, budget.
 *  - 'ai-critic'     : judgement. Pedagogy, realism, completeness of reasoning.
 *
 * A critical issue triggers ONE targeted re-run of the offending stage. After
 * that the roadmap ships with the report visible: an honest "R4 is not covered"
 * beats a silently broken plan.
 */

export const issueCodeSchema = z.enum([
  // deterministic — traceability
  'REQ_UNCOVERED', // a requirement reaches no topic, practice or feature
  'TOPIC_UNCOVERED', // a portal topic maps to no knowledge node
  'ORPHAN_NODE', // parentId points at a node that does not exist
  'DANGLING_PREREQUISITE', // prerequisite id does not exist
  'DUPLICATE_NODE', // the same knowledge appears twice
  // deterministic — ordering
  'PREREQ_ORDER', // a node is scheduled before its prerequisite
  'FEATURE_NOT_READY', // a feature is built before its required topics
  'CYCLE_BROKEN', // a dependency cycle existed and an edge was removed
  // deterministic — workload
  'OVER_BUDGET',
  'UNDER_BUDGET',
  'DAY_OVERLOAD',
  'DAY_EMPTY',
  'WORK_DEFERRED', // did not fit the week; moved to beyondThisWeek
  // deterministic — hygiene
  'CATEGORY_CONTAMINATION', // non-technical task content leaked into the roadmap
  'EMPTY_PRACTICE',
  // ai-critic
  'MISSING_PREREQUISITE', // a human would get stuck here
  'ILLOGICAL_SEQUENCE',
  'UNREALISTIC_WORKLOAD',
  'PROJECT_MISMATCH', // the plan would not satisfy the stated deliverables
  'FILLER_CONTENT',
]);
export type IssueCode = z.infer<typeof issueCodeSchema>;

export const validationIssueSchema = z.object({
  severity: z.enum(['critical', 'warning', 'note']),
  source: z.enum(['deterministic', 'ai-critic']),
  code: issueCodeSchema,
  message: z.string(),
  /** Ids involved: requirement ids, node ids, feature ids, topic indexes as strings. */
  refs: z.array(z.string()),
  /** True when a repair pass resolved it. */
  repaired: z.boolean(),
});
export type ValidationIssue = z.infer<typeof validationIssueSchema>;

export const requirementCoverageSchema = z.object({
  requirementId: requirementIdSchema,
  /** Node / practice / feature ids that cover it. Empty means uncovered. */
  coveredBy: z.array(z.string()),
  /** Days on which the covering work is scheduled. */
  days: z.array(z.number().int().min(1).max(5)),
});
export type RequirementCoverage = z.infer<typeof requirementCoverageSchema>;

export const validationReportSchema = z.object({
  /** True when no critical issue remains unrepaired. */
  passed: z.boolean(),
  requirementCoverage: z.array(requirementCoverageSchema),
  topicCoverage: z.array(
    z.object({
      topicIndex: z.number().int().min(1),
      title: z.string(),
      coveredByNodeIds: z.array(z.string()),
    }),
  ),
  issues: z.array(validationIssueSchema),
  workload: z.object({
    plannedMinutes: z.number().int().min(0),
    budgetMinutes: z.number().int().min(0),
    variancePct: z.number(),
  }),
});
export type ValidationReport = z.infer<typeof validationReportSchema>;
