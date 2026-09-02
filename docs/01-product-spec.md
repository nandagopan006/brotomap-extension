# 01 — Product Specification

## 1. One-sentence definition

A personal Chrome extension that reads the weekly task on the Brototype student
portal and turns it into a **complete, ordered, realistic 5-day learning + project
roadmap** — in one click.

## 2. The problem (precisely stated)

A Brototype weekly task is a *statement of the destination*, not a *map*.

The task says: "Learn JWT authentication and build auth into a Node.js API."
It does not say:

| Gap | Example of what's missing |
|---|---|
| Hidden prerequisites | You can't understand JWT without HTTP headers + async JS |
| Unstated subtopics | Header / Payload / Signature / Claims / Expiry / Refresh |
| Correct order | Sessions vs tokens *before* token generation |
| Difficulty grading | Which parts are 20-minute reads vs 3-hour fights |
| Practice | What to actually type to make it stick |
| Project decomposition | Which features, in which build order |
| Time budgeting | What fits in 5 days without lying to yourself |

The extension closes exactly these seven gaps.

## 3. Primary user

One person: a Brototype student (initially you). Personal-first tool.
No multi-tenancy, no accounts, no sharing, no analytics on users.

## 4. The one-click experience (the product contract)

```
Student is on the Brototype weekly-task page
   │
   ├─ Extension icon shows a green dot  ("task detected")
   │
   ├─ Click icon → popup shows:
   │     Detected: "Week 12 — JWT Authentication in Node.js"
   │     [ ⚡ Generate Roadmap ]
   │
   ├─ Click → opens a full extension tab with a live pipeline view:
   │     ✓ Extracted task            (0.2s)
   │     ✓ Understood task           (1.1s)
   │     ✓ Discovered 47 topics      (4.3s)
   │     ✓ Ordered prerequisites     (2.0s)
   │     ⟳ Generating practice…
   │       5-day plan
   │       Validation
   │
   └─ Roadmap renders → Export PDF / Save / Regenerate
```

**Hard requirement:** the student types nothing. No pasting, no configuration,
no prompt writing. One click from task page to roadmap.

**Escape hatch (required, not optional):** if auto-detection fails on a page,
the popup must offer "Paste task manually" and "Use selected text". The product
must never dead-end.

## 5. The core intelligence (the actual moat)

The AI must **not** transcribe the task's bullet points into a schedule.
It must answer a different question:

> "What does a student who does NOT yet know this need to understand,
>  in what order, to genuinely complete this task?"

That means it must surface things the task never mentions.

Worked example — task: *"Learn JWT authentication and build authentication into a Node.js API"*

```
FOUNDATION  (may already be known — still listed, marked 'review')
  HTTP ── Request · Response · Headers · Methods · Status codes
  JavaScript ── Functions · Objects · Modules · Async/Await · Error handling

BACKEND
  Node.js runtime · Express · REST design · Routing · Middleware chain · env config

AUTH CONCEPTS
  Authentication vs Authorization · Login flow · Password hashing (bcrypt)
  Sessions vs Tokens · Statelessness · Where to store a token

JWT
  Structure ── Header · Payload · Signature
  Claims · Signing algorithms (HS256) · Secret management
  Access token · Refresh token · Expiry · Verification · Common vulnerabilities

IMPLEMENTATION
  Register endpoint · Login endpoint · Token generation · Auth middleware
  Protected routes · Error handling · Logout/invalidation · Testing with Postman
```

Quality bar for this stage:
- **Completeness** — a missing prerequisite is the worst possible bug.
- **Granularity** — each leaf is a thing you can learn in 15–90 minutes.
- **Honesty** — nothing invented that isn't needed; no padding.

## 6. What the roadmap contains

1. **Task understanding** — restated goal, deliverables, explicit + implicit requirements.
2. **Knowledge map** — topic tree with subtopics, difficulty, effort estimate.
3. **Dependency graph** — what must be learned before what.
4. **Learning sequence** — a single linear order derived from the graph.
5. **Practice** — per topic-cluster: drills, small exercises, checkpoints ("you can explain X without notes").
6. **Project plan** — features, build order, milestones, definition-of-done.
7. **5-day plan** — Day 1 foundation → Day 5 completion + revision, with per-day hour budget.
8. **Submission checklist** — everything the task demands, mapped to where it's covered.
9. **Validation report** — gaps found and fixed, workload realism verdict.

## 7. Shape of the 5 days (default template, adapted per task)

| Day | Theme | Typical mix |
|---|---|---|
| 1 | Foundation & prerequisites | 70% learn / 30% drill |
| 2 | Core concepts | 60% learn / 40% practice |
| 3 | Advanced concepts + heavy practice | 40% learn / 60% practice |
| 4 | Project implementation | 20% learn / 80% build |
| 5 | Completion + revision + submission | 70% build / 30% revise |

The generator may reshape this (e.g. a pure-theory week, or a project-heavy week)
— the template is a prior, not a law.

## 8. Explicit non-goals (v1)

- ❌ Login / signup / accounts / user profiles
- ❌ Database (roadmaps live in `chrome.storage.local`)
- ❌ Multi-user, teams, sharing links
- ❌ Progress tracking across weeks / streaks / gamification
- ❌ Publishing to the Chrome Web Store
- ❌ Support for any site other than the Brototype portal
- ❌ Fine-tuning, embeddings, vector DB, RAG

## 9. Success criteria (how we know v1 works)

| # | Criterion | Measurement |
|---|---|---|
| S1 | Extraction works on ≥ 5 real weekly-task pages | fixture tests, 100% pass |
| S2 | Zero-typing path works end to end | manual, on the live portal |
| S3 | Knowledge map surfaces ≥ 3 prerequisites the task never mentions | human review per fixture |
| S4 | Every task requirement appears somewhere in the plan | automated coverage check = 100% |
| S5 | Plan fits declared weekly hours (default 25h) ±15% | automated |
| S6 | Full generation completes in < 45s | timing log |
| S7 | Groq key never reachable from the extension | code review + network inspection |
| S8 | Bad AI output degrades gracefully, never a blank screen | fault-injection test |
