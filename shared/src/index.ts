/**
 * @brotomap/shared — the single source of truth for every contract in Brotomap.
 *
 * Each schema is both a runtime validator (zod) and a TypeScript type, so the
 * extension and the server can never drift apart, and AI output is checked
 * before it is trusted.
 *
 * Layering (see docs/02-architecture.md):
 *   extraction    → what the page contains        (browser, no AI)
 *   understanding → what the task means           (AI)
 *   knowledge     → what must be learned          (AI + code)
 *   practice      → how it gets practised         (AI)
 *   project       → how the project gets built    (AI)
 *   plan          → how it fits into 5 days       (code only)
 *   validation    → is any of this actually right (code + AI)
 *   roadmap       → the deliverable
 *   api/messaging → how the pieces talk
 */

export * from './common.js';
export * from './extraction.js';
export * from './understanding.js';
export * from './knowledge.js';
export * from './practice.js';
export * from './project.js';
export * from './plan.js';
export * from './validation.js';
export * from './roadmap.js';
export * from './api.js';
export * from './messaging.js';
