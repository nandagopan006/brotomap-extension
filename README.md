# Brotomap

A Chrome extension for Brototype students. It reads the **current module's
technical task**, works out everything a student actually needs to learn to
complete it, and produces a validated 5-day learning and execution roadmap —
in one click, with a clean black-and-white PDF export.

**Status: Phase 2 complete** (contracts + a loadable Chrome extension shell).
Detection lands in Phase 3 — see [docs/05-build-plan.md](docs/05-build-plan.md).

## The one rule

> **AI for knowledge. Code for planning.**
>
> Discovering what a student must learn is reasoning — the model does that.
> Ordering topics and packing hours into five days is arithmetic — TypeScript
> does that, deterministically, so prerequisite order is a guarantee and the same
> task always produces the same plan.

## The four layers

```
Extraction     what is on the page right now      content script   no AI
Understanding  what the task means, what to learn server           AI
Planning       how it fits into five days         server           code only
Presentation   how it is shown and exported       roadmap tab      no AI
```

## Layout

```
brotomap-extension/
├── docs/         specification
├── shared/       types + zod schemas — the single source of truth
├── extension/    Manifest V3 · React · TypeScript      (from Phase 2)
└── server/       Express · AI provider · holds the key (from Phase 5)
```

## Using it without a terminal open

The extension needs the local server, because the AI key must not ship inside a
browser extension. Keeping a terminal open forever is not a way to use software,
so:

```bash
npm run autostart          # start with Windows, hidden - no window
npm run autostart:remove   # undo it
```

That writes one launcher into the Startup folder. Nothing is installed, no
service is registered, and removing it deletes the file.

## Commands

```bash
npm install          # once, from the repo root (npm workspaces)
npm run build        # builds extension/dist
npm run typecheck    # all three workspaces, strict
npm test             # builds, then runs every test
```

## Loading the extension in Chrome

1. `npm run build`
2. Open `chrome://extensions`
3. Turn on **Developer mode** (top right)
4. **Load unpacked** → select `extension/dist`
5. Pin Brotomap and click it on any normal web page

The popup reads the page through a content script that is injected only when you
act — Brotomap holds `activeTab`, not permission to read any site in the
background. Detection itself arrives in Phase 3, so today the popup honestly
reports that it is not implemented, and names the page it ran on to prove the
round-trip works.

After changing code: `npm run build`, then press the reload icon on the
Brotomap card in `chrome://extensions`.

## Docs

| Doc | Contents |
|---|---|
| [01 — Product Spec](docs/01-product-spec.md) | What we are building and what "good" means |
| [02 — Architecture](docs/02-architecture.md) | Layers, detection, extraction safety, security, errors |
| [03 — AI Pipeline](docs/03-ai-pipeline.md) | The stages, and where AI is *not* used |
| [04 — Data Schemas](docs/04-data-schemas.md) | Pointer into `shared/src`, plus the rules encoded there |
| [05 — Build Plan](docs/05-build-plan.md) | Phases 0–13 with acceptance criteria |
| [06 — Open Questions](docs/06-open-questions.md) | What is needed before Phases 3 and 5 |

## Non-negotiables

- No hard-coded technology names, task titles, or module numbers — those are
  runtime data that change every week. Enforced by a test.
- Only the **technical** task. Other task categories are ignored, never merged.
- Never guess between tasks: an unclear detection stops and says so.
- The AI provider key lives only in `server/.env`, never in the extension.
- The extension reads; it never submits, deletes, or clicks anything destructive.
- No accounts, no database, no tracking.
# brotomap-extension
