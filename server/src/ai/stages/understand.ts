import { taskUnderstandingSchema, type ExtractedTechnicalTask, type TaskUnderstanding } from '@brotomap/shared';
import type { AiProvider } from '../provider.js';
import { UNDERSTAND_SYSTEM, buildUnderstandPrompt } from '../prompts/understand.js';

/**
 * Stage 1 of the pipeline, and the only one that reads the portal's own words.
 *
 * Everything downstream works from this object rather than from the raw task,
 * which is what keeps later prompts small and stops the student's page content
 * being re-sent five times.
 */

/**
 * What the model is actually asked for.
 *
 * The module and task titles are omitted: they were read from the page, so
 * asking for them adds two fields the model can get wrong, and it did - the
 * first live run failed validation on them and cost a repair round-trip. A
 * model should never be asked to restate a fact already known.
 */
const understandAnswerSchema = taskUnderstandingSchema.omit({
  moduleTitle: true,
  taskTitle: true,
});

export interface StageResult<T> {
  value: T;
  ms: number;
  calls: number;
  repaired: boolean;
}

export async function runUnderstand(
  provider: AiProvider,
  task: ExtractedTechnicalTask,
): Promise<StageResult<TaskUnderstanding>> {
  const result = await provider.complete({
    system: UNDERSTAND_SYSTEM,
    user: buildUnderstandPrompt(task),
    schema: understandAnswerSchema,
    schemaName: 'TaskUnderstanding',
    // Low: this stage reports what the task says. Invention is the failure mode.
    temperature: 0.1,
    model: 'fast',
  });

  return {
    value: withPageFacts(result.value, task),
    ms: result.ms,
    calls: result.calls,
    repaired: result.repaired,
  };
}

/** Puts the page's own facts back, so downstream sees a complete object. */
function withPageFacts(
  answer: Omit<TaskUnderstanding, 'moduleTitle' | 'taskTitle'>,
  task: ExtractedTechnicalTask,
): TaskUnderstanding {
  return {
    ...answer,
    moduleTitle: task.module.title,
    taskTitle: task.task.title,
  };
}
