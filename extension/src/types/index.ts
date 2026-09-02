/**
 * The extension's view of the shared contracts.
 *
 * Everything the UI and the content script use comes through here, so there is
 * exactly one import path to change if the shared package ever moves.
 */
export type {
  AnalysisState,
  ApiError,
  Confidence,
  DayPlan,
  DetectionReport,
  DetectionResult,
  DetectionSignal,
  Difficulty,
  ExpansionOutcome,
  ExtensionMessage,
  ExtractedAttachment,
  ExtractedLink,
  ExtractedSection,
  ExtractedTechnicalTask,
  ExtractedTopic,
  ExtractionFailureReason,
  ExtractionOutcome,
  FiveDayPlan,
  HistoryEntry,
  KnowledgeMap,
  KnowledgeNode,
  ModuleContext,
  PipelineStage,
  PlanOptions,
  PracticePlan,
  ProjectPlan,
  Roadmap,
  Settings,
  TaskCandidate,
  TaskUnderstanding,
  ValidationReport,
} from '@brotomap/shared';

export {
  DEFAULT_PLAN_OPTIONS,
  PRIORITY_LABELS,
  HISTORY_LIMIT,
  PIPELINE_VERSION,
  STAGE_LABELS,
  STORAGE_KEYS,
  analysisStateSchema,
  extensionMessageSchema,
  extractedTechnicalTaskSchema,
  extractionOutcomeSchema,
  roadmapSchema,
} from '@brotomap/shared';
