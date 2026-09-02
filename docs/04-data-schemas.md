# 04 — Data Schemas

**This document is superseded by code.** As of Phase 1 the contracts live in
`shared/src/`, where they are simultaneously TypeScript types and runtime
validators. A document would drift; the code cannot.

## Where to look

| File | Layer | Key exports |
|---|---|---|
| [common.ts](../shared/src/common.ts) | vocabularies | `Difficulty`, `KnowledgeCategory`, `Priority`, `Confidence`, `idSchema` |
| [extraction.ts](../shared/src/extraction.ts) | what the page contains | `ExtractedTechnicalTask`, `ExtractedTopic`, `DetectionReport`, `TaskCandidate`, `ExtractionOutcome` |
| [understanding.ts](../shared/src/understanding.ts) | what the task means | `TaskUnderstanding`, `Requirement`, `TopicInterpretation` |
| [knowledge.ts](../shared/src/knowledge.ts) | what must be learned | `KnowledgeMap`, `KnowledgeNode`, `ResourceHint` |
| [practice.ts](../shared/src/practice.ts) | how it is practised | `PracticePlan`, `PracticeItem` |
| [project.ts](../shared/src/project.ts) | how the project is built | `ProjectPlan`, `ProjectFeature` |
| [plan.ts](../shared/src/plan.ts) | the five days | `FiveDayPlan`, `DayPlan`, `PlanBlock`, `PlanOptions` |
| [validation.ts](../shared/src/validation.ts) | is it correct | `ValidationReport`, `IssueCode`, `RequirementCoverage` |
| [roadmap.ts](../shared/src/roadmap.ts) | the deliverable | `Roadmap`, `PIPELINE_VERSION` |
| [api.ts](../shared/src/api.ts) | extension ⇄ server | `GenerateRequest`, `GenerateResponse`, `ProgressEvent`, `PipelineStage`, `STAGE_LABELS` |
| [messaging.ts](../shared/src/messaging.ts) | inside the extension | `ExtensionMessage`, `STORAGE_KEYS`, `Settings`, `HistoryEntry` |

## Design rules encoded there

1. **Traceability is structural.** `Requirement.id` (`R1`, `R2`, …) is carried by
   `coversRequirements` on knowledge nodes and project features, and checked by
   `RequirementCoverage`. A requirement that reaches no day is a validation
   failure, not an oversight.
2. **Topic order and boundaries survive.** `ExtractedTopic.index` is preserved
   end to end, so the AI always knows which content belongs to which topic.
3. **Failure is a first-class value.** `ExtractionOutcome` is a discriminated
   union: success carries the task, failure carries a specific reason and the
   candidates it refused to guess between.
4. **Code-derived fields are marked optional in the AI-facing shape.**
   `sequence`, `priority`, `depth` are filled by the scheduler, never requested
   from the model.
5. **No URLs in AI-generated resources.** `ResourceHint` has a label and a kind
   and no `url` field, because models invent links that look real.
6. **No technology names in code.** Enforced by a test in
   [contracts.test.ts](../shared/test/contracts.test.ts) that scans `shared/src`.

## Contract test

```
npm test
```

Validates a realistic extraction fixture, rejects malformed input, checks the
API envelopes, and enforces the no-hard-coded-technology rule.
