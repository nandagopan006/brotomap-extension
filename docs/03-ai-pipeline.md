# 03 — AI Pipeline

> **Stage naming (updated in Phase 1).** The six conceptual stages below are
> implemented as eight pipeline stage ids in `shared/src/api.ts`:
> `understand`, `discover`, `gap-pass`, `graph`, `practice`, `project`,
> `plan`, `validate`. Discovery's two passes and the practice/project split are
> separate ids because each is reported to the UI and timed independently.
> Student-facing labels live in `STAGE_LABELS`.
>
> Field names in the prose below are illustrative. The authoritative shapes are
> the zod schemas in `shared/src/` — see [04-data-schemas.md](04-data-schemas.md).

## 0. The governing principle

> **AI for knowledge. Code for planning. Code + AI for validation.**

Anything that is *recall and reasoning about a domain* → the model.
Anything that is *ordering, counting, summing hours, checking coverage* → TypeScript.

This is why the roadmap will be trustworthy while a single mega-prompt would not.

## 1. Six stages

```
RawTask (clean text)
   │
   ├─ 1  UNDERSTAND        AI   → TaskUnderstanding
   │
   ├─ 2  DISCOVER          AI   → KnowledgeMap (topics + subtopics)
   │
   ├─ 3  GRAPH             AI   → prerequisites, difficulty, effort
   │        + code: cycle detection, topological sort
   │
   ├─ 4  PRACTICE+PROJECT  AI   → PracticePlan, ProjectPlan
   │
   ├─ 5  SCHEDULE          CODE → FiveDayPlan
   │
   └─ 6  VALIDATE          CODE + AI → ValidationReport (+ one repair pass)
             │
             ▼
          Roadmap
```

Each stage: **typed input → prompt → JSON out → zod parse → typed output**.
A stage never sees raw model text downstream of its own parser.

---

## 2. Stage 1 — UNDERSTAND

**Input:** cleaned task text.
**Output:** `TaskUnderstanding`.

Extracts:
- `title`, `weekNumber` (if present), `domain` (e.g. `backend/node`), `stack[]`
- `goal` — one sentence, plain language
- `explicitRequirements[]` — verbatim-ish, each with a stable `id` (`R1`, `R2`, …)
- `implicitRequirements[]` — things the task assumes but never says
- `deliverables[]` — what must exist by Friday
- `hasProject: boolean` + `projectSummary`
- `assumedKnowledge[]` — what a student at this stage plausibly already has
- `ambiguities[]` — anything genuinely unclear (shown to the student, not guessed away)

Requirement ids are the backbone of Stage 6's coverage check. Every `R*` must
end up attached to at least one topic, practice item, or project feature.

**Prompt discipline:** "Do not invent requirements. If it is not in the text and
not strictly implied, put it in `implicitRequirements` with a reason."

---

## 3. Stage 2 — DISCOVER (the core capability)

**Input:** `TaskUnderstanding`.
**Output:** `KnowledgeMap` — 5 layers, flat node list with `parentId`.

Layers: `foundation → core → domain → advanced → implementation`

The prompt's central instruction:

> You are building the complete learning surface for a student who does **not**
> yet know this material. Do not restate the task. Ask: what must this person
> understand, end to end, to genuinely complete it? Include prerequisites the
> task never mentions. Break every topic into subtopics small enough to learn
> in 15–90 minutes. Missing a prerequisite is the worst possible failure.

Constraints encoded in the prompt:
- 25–70 nodes total (below 25 = shallow; above 70 = unschedulable in a week)
- max depth 3 (`topic → subtopic → leaf`)
- every leaf carries `whyItMatters` — one line tying it back to the task
- nodes the student likely already knows are marked `status: "review"` not dropped
- no vendor marketing, no tool tourism, no "read the docs" filler

**Two-pass discovery (recommended):**
1. *Breadth pass* — produce the layered topic list.
2. *Gap pass* — a second call: "here is the task and the map produced; what is
   missing that a beginner would get stuck on?" Merge the additions.

The gap pass is where the JWT→HTTP-headers kind of prerequisite actually appears.
It costs one extra call and is the single highest-value step in the pipeline.

---

## 4. Stage 3 — GRAPH

**Input:** `KnowledgeMap`.
**Output:** each node enriched with:
- `prerequisites: string[]` (node ids)
- `difficulty: "basic" | "medium" | "advanced"`
- `effortMinutes: number` (15–180, multiples of 15)
- `priority: "must" | "should" | "stretch"`

**Then code takes over:**
- Validate every prerequisite id exists → drop dangling refs, log them
- Detect cycles (DFS); break the weakest edge and record it in the report
- Topological sort, tie-broken by `(layer, difficulty, priority, effort)`
- Compute `depth` per node for the tree UI

The linear learning sequence is a **code artifact**, never asked of the model.

---

## 5. Stage 4 — PRACTICE + PROJECT

Two calls (parallel).

**4a. Practice** — for each topic cluster:
- `drills[]` — 5–20 min typing exercises
- `exercise` — one 30–60 min applied task
- `checkpoint` — "you can do X without looking it up" self-test
- `commonMistakes[]`

**4b. Project** — only when `hasProject`:
- `features[]` with `id`, `description`, `requiredTopicIds[]`, `effortMinutes`, `buildOrder`
- `milestones[]` — what works by end of Day 4, end of Day 5
- `definitionOfDone[]` — mapped back to requirement ids
- `submissionChecklist[]`

`requiredTopicIds` is what lets the scheduler guarantee a feature is never built
before its topics are learned.

---

## 6. Stage 5 — SCHEDULE (pure code, no AI)

Inputs: sorted nodes with effort, practice items, project features, `WEEKLY_HOURS`.

Algorithm:

1. **Budget** — 5 days × `dailyMinutes` (default 300). Reserve 15% slack per day.
2. **Day profiles** — target mix per day (learn / practice / build), from `01-product-spec.md` §7. Reshaped when `hasProject === false`.
3. **Pack learning** — walk the topological order, filling Days 1→3 to capacity, never placing a node before all its prerequisites are placed.
4. **Attach practice** — each cluster's practice lands on the day its last topic lands, if it fits; else the next day.
5. **Place project features** — in `buildOrder`, earliest day where all `requiredTopicIds` are already scheduled and capacity remains (usually Days 4–5).
6. **Overflow** — if total effort exceeds the week: demote `stretch` items to a "Beyond this week" section. **Never silently drop, never silently overfill.** Report the overflow honestly.
7. **Day 5 reserve** — always keep ≥ 60 min for revision + submission checklist.

Output: `FiveDayPlan` with per-day `blocks[]` (typed `learn | practice | build | revise`), each with start-relative timing, minutes, and the ids it covers.

Deterministic: same input → same plan. That property is what makes the whole
thing debuggable.

---

## 7. Stage 6 — VALIDATE

**Deterministic checks (code) — these are the real guarantees:**

| Check | Rule |
|---|---|
| Coverage | every `R*` from Stage 1 maps to ≥ 1 scheduled item; else `gap` |
| Prereq order | no node scheduled before a prerequisite |
| Feature readiness | no feature built before its `requiredTopicIds` |
| Workload | total minutes within ±15% of the budget |
| Orphans | no node with a `parentId` that doesn't exist |
| Day balance | no day above capacity, none below 40% |
| Duplicates | no topic scheduled twice |

**AI critic pass (one call):** given the task + the finished plan, answer:
- what is missing that a student would get stuck on?
- is the order pedagogically sound?
- is the workload realistic for a learner, not an expert?
- does the project actually satisfy the stated deliverables?

Returns `issues[]` with `severity: critical | warning | note`.

**Repair:** any `critical` from either source triggers **one** targeted re-run of
the offending stage (usually 2 or 3) with the issue appended to the prompt.
Maximum one repair cycle — then ship with the `ValidationReport` visible in the UI.
An honest "we couldn't cover R4" beats a silently broken plan.

---

## 8. Model usage

| Stage | Model | `temperature` | Notes |
|---|---|---|---|
| 1 Understand | fast | 0.1 | extraction, must be literal |
| 2 Discover | reasoning | 0.4 | needs recall + breadth |
| 2b Gap pass | reasoning | 0.5 | deliberately divergent |
| 3 Graph | fast | 0.2 | mechanical labelling |
| 4 Practice/Project | reasoning | 0.5 | needs to be concrete and creative |
| 6 Critic | reasoning | 0.3 | adversarial reading |

Configure model ids via env — **verify the exact ids against Groq's current model
list before Phase 3**; Groq deprecates and renames models regularly. Start with a
single model for everything and only split if quality demands it.

## 9. JSON reliability protocol

1. Ask for structured output (`response_format` with a JSON schema) when the model supports it; otherwise `json_object` mode.
2. Always also restate the schema **in the prompt** with a filled example — this is what actually drives compliance.
3. Parse with zod. On failure:
   - strip markdown fences, take the outermost `{...}`, retry parse
   - one repair call: the invalid output + the zod error + "return only corrected JSON"
   - then fail the stage cleanly
4. Log every prompt/response pair to `.cache/<hash>/<stage>.json` in dev. This is
   the debugging tool that makes "was it extraction, reasoning, or generation?"
   answerable in seconds.
5. Never `JSON.parse` into `any` and index it. zod or nothing.

## 10. Cost & token control

- Only cleaned task text enters Stage 1 (~1–3k tokens).
- Later stages receive **prior stage JSON**, never the raw page.
- Stage 4 receives topic ids + titles only, not the whole map with descriptions.
- Cache key: `sha256(cleanTaskText + pipelineVersion)`. Bump `pipelineVersion`
  when prompts change so old caches invalidate.
