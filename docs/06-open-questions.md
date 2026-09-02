# 06 — Open Questions (blockers marked)

Answers go straight into the docs they affect.

## BLOCKING before Phase 2 (extraction)

**Q1. The portal.**
What is the exact URL of the module/task page? (`https://…`)

No longer needed for permissions — Phase 2 uses `activeTab` with on-demand
injection, so Brotomap works on whatever tab you are on without naming a domain
up front. Still needed for the URL-pattern signal and for fixtures.

**Q2. Page HTML.**
I need at least 3–5 real saved pages. On a weekly-task page:
`Ctrl+S` → "Webpage, Complete" → drop the `.html` files into
`extension/test/fixtures/`. Or right-click the task block → Inspect →
right-click the container element → Copy → Copy outerHTML → paste into a file.

Without these, extraction selectors are guesswork and Phase 2 cannot be verified.

**Q2b. What Phase 3 needs specifically.**
With the task list showing: does any card carry a category badge or a
`data-*` attribute naming its category? Right-click a card → Inspect → copy the
card's outerHTML. If nothing names the category, elimination already covers it —
but it is worth knowing which path the real portal takes.

**Q3. Is the portal a SPA?**
Does the task appear without a page reload when you navigate? Decides whether
the `MutationObserver` is essential or merely defensive.

**Q4. Login wall.**
Is the task page behind a login? (It will be — confirming that the content script
runs after auth, on the real DOM, not a redirect page.)

---

## Needed before Phase 3 (AI)

**Q5. Groq key.**
Do you have one? It goes in `server/.env` only — never paste it into chat, and
never into an extension file.

**Q6. Model.**
Default plan is one model for everything (`llama-3.3-70b-versatile`) and split
only if quality demands it. Groq's model ids change — we verify against their
live list at Phase 3.

---"start Phase 7

## Product decisions (defaults chosen; override any time)

| # | Question | Default |
|---|---|---|
| Q7 | Weekly study hours? | **25** (5 h/day × 5 days) |
| Q8 | Where does the roadmap render? | **Full extension tab** — popups die on blur and can't paginate a PDF |
| Q9 | Language of the roadmap? | English |
| Q10 | Are Sat/Sun part of the week? | No — 5 days, Mon–Fri |
| Q11 | Should it suggest external resources (links)? | Yes, but **labels only, no URLs** — models hallucinate URLs. Titles you can search are honest; fake links are not |
| Q12 | Multiple roadmaps kept? | Yes, last 20 in local storage |

---

## Known risks

| Risk | Mitigation |
|---|---|
| Portal HTML changes and breaks extraction | Strategy chain + fixtures + manual paste fallback |
| Model omits a critical prerequisite | Gap pass (Stage 2b) + AI critic (Stage 6) + human rubric |
| Model invents plausible-but-wrong facts | Keep scope to well-covered CS topics; no URLs; validation surfaces gaps |
| Groq model deprecation | Model id in env; verify at Phase 3 and before any long gap in work |
| 45s feels slow | SSE progress makes it legible; cache makes repeats instant |
| Scope creep into a "product" | `05-build-plan.md` "should NOT build" list is binding |
