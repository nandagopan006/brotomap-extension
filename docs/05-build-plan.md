# 05 — Build Plan

## Sequencing rule

> Prove extraction before touching AI. Prove the engine before touching design.

When a roadmap comes out wrong we must be able to say instantly whether
**extraction**, **AI reasoning**, or **planning** was at fault. Every phase gate
below exists to keep those three separable.

Status legend: ✅ done · ⬜ not started

---

## ✅ Phase 0 — Repository inspection

Greenfield confirmed: no code, no `package.json`, no git. Only docs existed.

## ✅ Phase 1 — Architecture foundation

Built: npm workspaces (`shared` / `extension` / `server`), strict TypeScript,
`shared/src` contracts (zod + types), env loading and validation, contract tests,
git repository.

**Verified:** `npm run typecheck` clean in all three workspaces; `npm test`
28/28 passing; `npm audit` 0 vulnerabilities.

## ⬜ Phase 0.5 — Portal recon *(blocking Phase 3, runs in parallel)*

Needed from the student, not buildable by us:
portal URL · 3–5 saved task pages as fixtures · whether a JSON API backs the page ·
whether any DOM attribute marks the task category · SPA or full reload.

## ✅ Phase 2 — Chrome extension foundation

Manifest V3, two-config Vite build, React 19, popup, on-demand content script,
service-worker message router, roadmap tab.

Permissions are `storage`, `activeTab`, `scripting` — no `host_permissions`.
The content script is injected by the worker when the student acts, so the
portal domain is not needed to build or run, and the page is never read in the
background.

**Verified here:** build emits every file the manifest references; `content.js`
is a classic script (Chrome cannot inject an ES module) and stays under 20 KB;
typecheck clean; 47 tests passing.
**Verified by you in Chrome:** loads unpacked with no console errors, popup
round-trip returns the content script's reply.

## ✅ Phase 3 — Technical task detector *(confirmed on the live portal)*

Module detection, structural task-list discovery, category classification by
attribute / label / structure / elimination, dynamic title read, ambiguity
refusal, portal gate, and a one-click diagnostic.

Config lives in three files: `content/config/portal.ts` (where Brotomap works),
`content/config/taxonomy.ts` (category vocabulary and structural patterns) and
`content/config/selectors.ts` (portal CSS — still empty; the structural
detector runs regardless, so selectors are an optimisation, never a dependency).

**Corrected after seeing the live portal** (student.brototype.com):

| Assumption | Reality |
|---|---|
| Titles sit in heading tags | No semantic headings anywhere — plain divs |
| Modules render as a list | One chip with prev/next arrows |
| Badges spell categories out | One word: "Personal", not "Personal Development" |
| Best-scoring card group is the task list | The sidebar scores just as well; only the category badges separate them |

**Verified:** 44 detector tests, including a reconstruction of the live page
that identifies "React Module 3" from its Technical badge, reads "Module 29"
from the chip, rejects the sidebar, strips badge and status from the title, and
leaves the DOM byte-identical. Six unseen subjects identified with no code
change.

**Confirmed live:** the popup reports "React Module 3 - Module 29, detected with
medium confidence" on student.brototype.com. A diagnostic captured from the real
page is pinned as a test, including the Material UI emotion hashes that had
split the task list in two.

## ✅ Phase 4 — Complete task extraction *(confirmed on the live portal)*

Topic discovery by numbering, read-before-touch expansion, response-boundary
cutting, links, attachments, cleaning, and a preview screen in the roadmap tab.

**The response boundary is the important rule.** Everything below "Your
Response" is the student's own answer and submission. It is cut out: a roadmap
built partly from work already submitted would plan a week around what is
already done.

**Safety:** detection never touches the page. Extraction touches it only when a
topic's content is genuinely absent from the DOM — MUI keeps collapsed content
mounted, so in practice `interactionCount` is 0. When a click is unavoidable it
must be an expander: anything matching submit / send / delete / upload / save /
pay is refused, forms are never entered, links are never followed, a global
budget caps total clicks, and anything opened is closed again.

**Verified:** 19 extraction tests — all six topics read from a reconstruction of
the live page with zero interactions, the student's response excluded, an
unreadable topic reported rather than hidden, the record id stripped from the
URL, and eight classes of control proven unclickable.

**Confirmed live:** from the module list page, Brotomap opened "Basics of
JavaScript" by itself, navigated, expanded four collapsed topics, read all five
in full (1,324 characters), excluded the student's own responses, and closed
what it opened - 8 interactions, all reported.

The portal's collapsed topics do NOT keep content in the DOM, so clicking is
required; "Read more" truncation is revealed before reading.

## ✅ Phase 5 — AI task analysis *(confirmed live)*

Express server holding the key, a provider behind `ai/provider.ts`, JSON
extraction and one schema-guided repair round, and the `understand` stage.

**Verified live** against the real Module 26 task: 15 requirements covering all
five topics, project correctly reported absent, **1.6s, one call, no repair**.

**Three things the live run found that no unit test would have:**

| Problem | Fix |
|---|---|
| `llama-3.3-70b-versatile` had been **decommissioned** | `npm run models` lists what the key can actually use; defaults are now `openai/gpt-oss-20b` / `-120b` |
| `AI_MODEL_REASONING=` (empty, as shipped in `.env.example`) refused to start the server | an empty value means unset, not invalid |
| The default token budget truncated the answer, which the provider reported as "failed to validate JSON" | explicit `max_completion_tokens`, `reasoning_effort: low` for reasoning models, and a fallback that drops the provider's JSON mode and relies on our own extraction |

Asking the model to restate the module and task titles — facts already read from
the page — was costing a repair round-trip on every call. It is not asked for
them any more; they are put back afterwards.

**Commands:** `npm run server` · `npm run models` · `npm run try`

## ✅ Phase 6 — Knowledge engine *(confirmed live)*

`discover` + `gap-pass` from the AI, then the graph in pure code: cycle
detection, topological ordering, depth, priority and totals.

**Verified live** on the real Module 26 task: **43 nodes in 18s, 14 of them
"supporting"** — things the task never mentioned, including hoisting, scope
types, type coercion, the event loop, execution context, and package.json
structure. Those are the things a beginner actually gets stuck on, and no
sentence in the task named any of them.

**The first attempt failed, informatively.** It produced 21 nodes and *zero*
supporting ones — a restatement of the task, the exact failure this stage
exists to prevent. Two causes:

| Cause | Fix |
|---|---|
| One token ceiling for every stage, so a 40-node map was silently truncated to whatever fitted | per-request `maxTokens`: a map is an order of magnitude longer than a summary |
| The prompt asked for unstated prerequisites politely and got agreement without action | the rule now comes first, carries a worked example, and sets a floor of one third |

A node the gap pass finds is labelled `supporting` **in code**, not by the
model: where it came from is a fact, not an opinion.

**Ordering is arithmetic, not opinion.** 24 graph tests, including seven
randomly generated DAGs, assert that the sequence respects every dependency,
that the same input gives the same output, and that a cycle, a dangling
reference, a missing parent, a duplicate id or a self-reference is repaired and
reported rather than crashing a run.

**The per-minute token budget shaped the architecture.** A free tier allows
~8000 tokens a minute, and a forty-node map does not fit in one answer of that
size — asked for anyway, it came back truncated to fifteen nodes with half the
subject missing. Discovery is therefore split into calls of two portal topics
each, and every call is shown what the previous ones built so it can reference
their nodes as prerequisites rather than inventing ids that do not exist.

Worth knowing: a wrapper model can advertise a large budget in its headers and
then route to a smaller one. `groq/compound` reports 70,000 tokens a minute and
fails with a limit of 8,000, because it delegates to `gpt-oss-120b`. The figure
that matters is the one in the error, not the header. `npm run limits` prints
both.

**Commands:** `npm run map` prints the whole map, marking every node the task
never mentioned. `npm run limits` shows what each model on your key allows.

## ✅ Phase 7 — Practice engine *(confirmed live)*

One AI call producing drills, applied exercises, debugging tasks and
checkpoints, each tied to topics that exist in the map. An exercise for a topic
the plan does not contain is dropped: it could never be scheduled, and an
exercise that is never scheduled is one nobody does.

Kept to a single call deliberately. On a small per-minute budget every extra
call is a wait, and this is the stage that degrades most gracefully - fewer,
better exercises beat one per topic. It is also allowed to fail without taking
the roadmap with it: topics without exercises are worth having, losing the
topics because the exercises could not be written is not.

## ⬜ Phase 8 — Project engine

**Done when:** a project is detected only when present; features carry
`requiredTopicIds`; a theory-only task yields `project: null` and nothing
downstream breaks.

## ✅ Phase 9 — Five-day planner *(confirmed live)*

Pure code. A model cannot reliably add up minutes, cannot be trusted to keep a
topic behind its prerequisites, and answers differently every run; all three
matter, and all three are arithmetic.

Effort estimates balance the days and are never shown. A student does not need
to be told a topic takes forty-five minutes - they need to know what to do
today, and that today is not twice as long as yesterday.

**Two bugs the tests caught before anyone saw them:**

| Bug | Cause |
|---|---|
| Days 3 and 4 came out empty | Days were filled to the *week's budget* rather than the work available, so everything landed in the first two |
| Day 1 came out empty | A topic longer than a day's share pushed the day forward before anything had been put on it |

16 scheduler tests: dependency order holds, practice never precedes its topic,
optional depth is deferred rather than days overfilled, nothing is dropped
silently, and the same input always gives the same week.

## ⬜ Phase 10 — Validation engine

Deterministic checks, AI critic, one repair cycle.

**Done when:** a gap-injected fixture is caught and repaired; requirement
coverage is 100% or the gap is reported honestly.

## ⬜ Phase 11 — Roadmap UI

**Done when:** the full roadmap reads end to end; degraded state renders correctly.

## ⬜ Phase 12 — PDF export

**Done when:** pure black on white, no emoji, no colour blocks; no block split
across a page break; readable on paper; long and short roadmaps both tested.

## ⬜ Phase 13 — Real-world testing

Many task shapes: project-heavy, theory-heavy, many topics, few topics, no
project. Task names are **test data**, never application logic.
Rubric scores tracked in `docs/evals.md`.

---

## Testing strategy

| Layer | Approach |
|---|---|
| Contracts | zod parse tests on realistic fixtures (Phase 1, running) |
| Extraction | Vitest against saved portal HTML — the regression net for redesigns |
| AI stages | Recorded responses replayed offline; live calls behind `RUN_LIVE=1` |
| Planner | Unit + property tests, fully deterministic |
| Faults | Injected: bad JSON, 429, timeout, empty map, cyclic prerequisites, unexpandable topic |
| Quality | Human rubric per fixture — completeness, order, realism, coverage |

## What Claude builds

Only the approved phase. Tests alongside. Honest reporting of what was verified.

## What Claude does not build

❌ auth, accounts, database ❌ a generic any-site extractor
❌ multiple AI providers at once ❌ styling before Phase 11
❌ speculative features ❌ Docker/CI/store packaging in v1
❌ silent fallbacks that hide failure ❌ any hard-coded technology, module or task name
