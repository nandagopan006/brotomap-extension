# 02 — Technical Architecture

Updated at the end of Phase 1 to match the approved specification.
Runtime contracts live in code: **`shared/src/` is the single source of truth.**

## 1. System overview

```
┌───────────────────────────── CHROME ─────────────────────────────┐
│                                                                  │
│  Brototype tab                          Extension                │
│  ┌────────────────────┐                 ┌────────────────────┐   │
│  │ content script     │◄── messages ───►│ service worker     │   │
│  │  detector          │                 │  message router    │   │
│  │  navigator         │                 │  cache writer      │   │
│  │  topic reader      │                 └─────────┬──────────┘   │
│  │  cleaner           │                           │              │
│  └────────────────────┘                 ┌─────────▼──────────┐   │
│  ┌────────────────────┐                 │ chrome.storage     │   │
│  │ popup — one button │◄── messages ───►│ .local             │   │
│  └────────────────────┘                 └────────────────────┘   │
│  ┌────────────────────────────────────────────────────────────┐  │
│  │ roadmap.html — full extension tab                          │  │
│  │   owns the network call · renders roadmap · prints PDF     │  │
│  └───────────────────────────┬────────────────────────────────┘  │
└──────────────────────────────┼───────────────────────────────────┘
                               │ POST /api/roadmap/generate  (SSE)
                               ▼
                ┌──────────────────────────────┐
                │  Node.js + Express server    │
                │  ┌────────────────────────┐  │
                │  │ pipeline orchestrator  │  │
                │  │  understand      AI    │  │
                │  │  discover        AI    │  │
                │  │  gap-pass        AI    │  │
                │  │  graph        AI+code  │  │
                │  │  practice        AI    │  │
                │  │  project         AI    │  │
                │  │  plan          CODE    │  │
                │  │  validate   CODE+AI    │  │
                │  └───────────┬────────────┘  │
                │   zod validation + repair    │
                │   disk cache (task hash)     │
                └──────────────┬───────────────┘
                               │ AI_API_KEY (server-only, never leaves)
                               ▼
                        AI provider (Groq)
```

## 2. The four layers (mandatory separation)

| Layer | Question it answers | Where | AI? |
|---|---|---|---|
| **Extraction** | What is on the page right now? | content script | no |
| **Understanding** | What does this task mean, and what must be learned? | server | yes |
| **Planning** | How does this fit into five days? | server | **no — pure code** |
| **Presentation** | How is it shown and exported? | roadmap tab | no |

Each layer talks to the next only through a schema in `shared/src/`. Replacing
one must never require touching another.

## 3. Why this shape

| Decision | Reason |
|---|---|
| Server between extension and provider | The key must never ship in an extension bundle — anyone can unzip a CRX |
| Content script does all DOM work | Portal knowledge lives in one replaceable place; the HTML *will* change |
| **The roadmap tab owns the network call** | MV3 popups die on blur and an MV3 service worker is killed when idle — a 45s pipeline survives in neither. A normal extension page has no lifetime limit |
| Service worker is only a router | Small, restartable, stateless; state lives in `chrome.storage.local` |
| Results render in a full tab | Long content, scrolling, and `window.print()` → PDF all need a real page |
| Scheduling is code, not AI | Ordering and hour arithmetic must be *guaranteed* and reproducible |
| SSE progress | Real stage events — never fake progress — and free per-stage debugging |
| Cache by task hash | Re-opening must not re-bill or re-wait; makes stage debugging cheap |
| Provider behind an interface | Nothing outside `ai/providers/` imports a vendor SDK |
| `activeTab` + on-demand injection, no `host_permissions` | The content script runs only when the student acts, on the tab they are looking at. Chrome shows no scary "read your data on <site>" warning, and the build does not need the portal domain to be known |

## 4. Chrome extension (Manifest V3)

### 4.1 Components

| Component | File | Responsibility |
|---|---|---|
| Detector | `content/detector/` | Portal context, current module, task-card discovery, **technical classification** |
| Navigator | `content/navigator/` | Open the technical task — prefer route change over clicking |
| Topic reader | `content/extractor/` | Discover topics, read content, handle expansion safely |
| Cleaner | `content/cleaner/` | Strip chrome, keep structure, normalise |
| Observer | `content/observer/` | `MutationObserver` + readiness/retry for dynamic rendering |
| Service worker | `background/` | Message routing, cache, history |
| Popup | `popup/` | One button, current status, honest failure states |
| Roadmap tab | `roadmap/` | Network call, progress, roadmap UI |
| Print document | `roadmap/print/` | Separate linear render tree for the PDF |

### 4.2 Technical-task detection (the critical path)

Never by technology name. Never by module number. Three signals, scored:

| Signal | What it reads | Strength |
|---|---|---|
| `category-attribute` | `data-*`, `aria-*`, or route segment naming the category | strongest |
| `category-label` | a visible badge/chip naming the category | strong |
| `structure-signature` | the topic-list shape unique to a technical task | strong, technology-agnostic |
| `category-exclusion` | every other card matched a known non-technical category | supporting only |

```
exactly one candidate above threshold → open it
two or more                           → status 'technical-task-ambiguous'
none                                  → status 'technical-task-not-found'
```

Ambiguity is reported, never resolved by guessing. `DetectionReport.candidates`
carries every card seen, so the UI can offer a real choice and a wrong pick is
diagnosable after the fact.

**Allowed to be hard-coded** (one file each): category vocabulary
(`taxonomy.ts`), portal selectors (`selectors.ts`), structural patterns.
**Never hard-coded:** technology names, task titles, module numbers, topic titles.

### 4.3 Topic reading and expansion safety

Read before touch:

1. Content already visible → read it
2. Content present but CSS-hidden → read it, **no clicks at all**
3. Content genuinely absent → toggle one topic at a time, wait on a
   `MutationObserver` (capped), read, then restore the original state
4. Failure → mark that topic `complete: false` and continue; report it

Click rules: toggles only; deny-list on `submit|send|delete|remove|finish|complete|approve|upload|save`;
never inside a form; global interaction cap; extraction must be idempotent.
`DetectionReport.interactionCount` records exactly how much the page was touched.

### 4.4 Dynamic content

Extraction states are explicit (`ExtractionOutcome`): loading timeout,
module not found, no tasks, not found, ambiguous, open failed, no topics,
failed. Each maps to a distinct, useful message. No silent no-ops.

## 5. Server

### 5.1 Endpoints

| Method | Path | Purpose |
|---|---|---|
| GET | `/api/health` | liveness, pipeline version, configured model (never the key) |
| POST | `/api/roadmap/generate` | generate; SSE when `Accept: text/event-stream` |
| POST | `/api/roadmap/stage/:stage` | run one stage — **dev only**, gated by `NODE_ENV` |
| GET | `/api/roadmap/:hash` | fetch a cached result |

### 5.2 Layers

```
routes/            HTTP only: parse, validate, stream
services/          pipeline orchestration, cache, timing
ai/provider.ts     the interface the rest of the app uses
ai/providers/      the only files that import a vendor SDK
ai/prompts/        one pure builder per stage
ai/repair.ts       JSON coercion + one schema-guided repair round-trip
planner/           topological sort + bin-packing (NO AI)
validation/        deterministic checks, then the AI critic
```

Rule: `ai/` never knows about Express. `routes/` never talks to a provider.

### 5.3 Configuration

`server/.env`, validated at start-up by `server/src/config/env.ts`
(see `server/.env.example`). Variables are provider-neutral: `AI_API_KEY`,
`AI_MODEL`, `AI_MODEL_REASONING`, plus `PORT`, `ALLOWED_ORIGINS`,
`WEEKLY_HOURS`, `CACHE_DIR`.

## 6. Security

1. The key exists only in `server/.env`; never in extension code or a response
2. CORS allow-list = the extension origin (`ALLOWED_ORIGINS`); everything else rejected
3. Rate limited; request body capped at `MAX_REQUEST_BYTES` (256 KB)
4. The extension sends the **structured extraction only** — never page HTML, never cookies, never profile data
5. Model output is never `eval`'d and never injected as HTML
6. The extension never clicks a destructive control and never submits anything
7. Prompts/responses cached to disk in dev only; production logs metadata only

## 7. Error handling

| Failure | Behaviour |
|---|---|
| Not on the portal | Popup says so plainly |
| Technical task ambiguous | "Could not confidently identify" + Retry + manual choice from discovered candidates |
| Dynamic content timeout | Retry with a limit, then a specific message |
| One topic unreadable | Continue, mark incomplete, report it |
| Server unreachable | Show the exact command to start it; cached roadmaps still open |
| Provider 429 / 5xx | Backoff, 2 retries, then name the failing stage |
| Invalid model JSON | One schema-guided repair round-trip, then fail that stage |
| One stage fails | Partial roadmap + `degradedStages` band + retry that stage. Never blank |
| Total timeout | Abort, keep what completed, offer resume from cache |

## 8. Performance targets

| Stage | Budget |
|---|---|
| Extraction (incl. safe expansion) | < 2 s |
| understand | < 3 s |
| discover + gap-pass | < 15 s |
| graph | < 8 s |
| practice + project (parallel) | < 12 s |
| plan (code) | < 50 ms |
| validate | < 8 s |
| **Total** | **< 45 s cold · < 1 s cached** |

## 9. Stack

| Layer | Choice | Note |
|---|---|---|
| Monorepo | npm workspaces: `shared` / `extension` / `server` | one install, one typecheck |
| Contracts | TypeScript + zod v4 | `shared/src` is the source of truth; zod also generates JSON Schema for AI structured output |
| Extension | Manifest V3 · React · TypeScript · Vite | Phase 2 |
| Server | Node 24 · Express · TypeScript | Phase 5 |
| AI | Groq behind `ai/provider.ts` | swappable |
| PDF | separate print render tree + `@media print` | B/W, no dependency |
| Tests | Vitest | fixtures for extraction, contracts for AI output |
