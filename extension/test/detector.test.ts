// @vitest-environment happy-dom
import { beforeEach, describe, expect, it } from 'vitest';
import { detectTechnicalTask } from '../src/content/detector/index.js';

/**
 * DETECTION TESTS
 *
 * These run against synthetic pages built to the portal structure described in
 * the specification, not against captured HTML — none exists yet. That makes
 * them a real test of the *logic* (elimination, structure, ambiguity refusal)
 * and not yet a test against the live portal. Phase 0.5 fixtures will add that.
 *
 * The suite is deliberately hostile about one thing above all: the detector
 * must never depend on what this week's subject happens to be.
 */

interface CardSpec {
  title: string;
  attributes?: Record<string, string>;
  meta?: string;
  badge?: string;
}

function buildModulePage(options: {
  modules: string[];
  activeIndex: number;
  cards: CardSpec[];
}): Document {
  const moduleItems = options.modules
    .map(
      (title, index) =>
        `<li class="module-item${index === options.activeIndex ? ' active' : ''}"${
          index === options.activeIndex ? ' aria-current="page"' : ''
        }>${title}</li>`,
    )
    .join('');

  const cards = options.cards
    .map((card) => {
      const attributes = Object.entries(card.attributes ?? {})
        .map(([name, value]) => ` ${name}="${value}"`)
        .join('');
      const badge = card.badge === undefined ? '' : `<span class="badge">${card.badge}</span>`;
      const meta = card.meta ?? 'Not submitted';
      return `<div class="task-card"${attributes}>${badge}<h3>${card.title}</h3><span class="meta">${meta}</span></div>`;
    })
    .join('');

  document.body.innerHTML = `
    <nav class="top-nav"><a href="/dashboard">Dashboard</a><a href="/profile">Profile</a></nav>
    <aside class="sidebar"><ul class="module-list">${moduleItems}</ul></aside>
    <main><h2>Tasks</h2><div class="task-list">${cards}</div></main>
    <footer>Support</footer>`;

  return document;
}

function buildOpenedTaskPage(options: {
  moduleHeading: string;
  taskTitle: string;
  declaredTopics: number;
  topics: string[];
}): Document {
  const topics = options.topics
    .map(
      (title, index) =>
        `<section class="topic"><h4>Topic ${index + 1}</h4><p>${title}</p></section>`,
    )
    .join('');

  document.body.innerHTML = `
    <nav class="top-nav"><a href="/dashboard">Dashboard</a></nav>
    <h1>${options.moduleHeading}</h1>
    <h2>${options.taskTitle}</h2>
    <div class="overview"><h3>Task Overview</h3><p>Total Topics: ${options.declaredTopics}</p></div>
    <div class="topics">${topics}</div>`;

  return document;
}

/** The four cards from the specification's own example. */
const SPEC_CARDS: CardSpec[] = [
  { title: 'Personal Development Workouts Premium Module 29' },
  { title: 'React Module 3' },
  { title: 'Communication Task - Module 29' },
  { title: 'Miscellaneous 1 Year Premium - Module 29' },
];

beforeEach(() => {
  document.body.innerHTML = '';
});

describe('identification by elimination', () => {
  it('finds the technical task when only the other cards state a category', () => {
    const doc = buildModulePage({
      modules: ['Module 29', 'Module 30', 'Module 31', 'Module 32'],
      activeIndex: 0,
      cards: SPEC_CARDS,
    });

    const result = detectTechnicalTask(doc);

    expect(result.status).toBe('ok');
    if (result.status !== 'ok') return;

    expect(result.taskTitle).toBe('React Module 3');
    expect(result.module.title).toBe('Module 29');
    expect(result.module.isCurrent).toBe(true);
    expect(result.detection.matchedSignals).toContain('category-exclusion');
    expect(result.detection.confidence).not.toBe('low');
  });

  it('never touches the page while detecting', () => {
    const doc = buildModulePage({ modules: ['Module 29'], activeIndex: 0, cards: SPEC_CARDS });
    const before = doc.body.innerHTML;

    const result = detectTechnicalTask(doc);

    expect(doc.body.innerHTML).toBe(before);
    if (result.status === 'ok') {
      expect(result.detection.interactionCount).toBe(0);
    }
  });
});

/**
 * RULE 2, as an executable guarantee.
 *
 * Every one of these is a subject the detector has never seen, in a module
 * number it has never seen. If any of them needed a code change, the product
 * would break the first week Brototype changed the syllabus.
 */
describe('subject independence', () => {
  it.each([
    'Rust Module 12',
    'Kubernetes Module 4',
    'Prisma Module 8',
    'Elixir Phoenix Module 1',
    'WebAssembly Module 17',
    'Data Structures Module 6',
  ])('identifies "%s" with no code change', (technicalTitle) => {
    const doc = buildModulePage({
      modules: ['Module 44', 'Module 45'],
      activeIndex: 1,
      cards: [
        { title: 'Communication Task - Module 45' },
        { title: technicalTitle },
        { title: 'Personal Development Workouts Module 45' },
      ],
    });

    const result = detectTechnicalTask(doc);

    expect(result.status).toBe('ok');
    if (result.status !== 'ok') return;
    expect(result.taskTitle).toBe(technicalTitle);
    expect(result.module.title).toBe('Module 45');
  });
});

describe('identification by stated category', () => {
  it('uses a category attribute when the portal exposes one', () => {
    const doc = buildModulePage({
      modules: ['Module 31'],
      activeIndex: 0,
      cards: [
        { title: 'Communication Task - Module 31' },
        { title: 'Ada Module 2', attributes: { 'data-category': 'technical' } },
        { title: 'Some Other Task' },
      ],
    });

    const result = detectTechnicalTask(doc);

    expect(result.status).toBe('ok');
    if (result.status !== 'ok') return;
    expect(result.taskTitle).toBe('Ada Module 2');
    expect(result.detection.matchedSignals).toContain('category-attribute');
    expect(result.detection.confidence).toBe('high');
  });

  it('uses a visible category badge', () => {
    const doc = buildModulePage({
      modules: ['Module 31'],
      activeIndex: 0,
      cards: [
        { title: 'Communication Task - Module 31' },
        { title: 'Haskell Module 5', badge: 'Technical' },
        { title: 'Another Unlabelled Task' },
      ],
    });

    const result = detectTechnicalTask(doc);

    expect(result.status).toBe('ok');
    if (result.status !== 'ok') return;
    expect(result.taskTitle).toBe('Haskell Module 5');
    expect(result.detection.matchedSignals).toContain('category-label');
  });
});

describe('refusing to guess', () => {
  it('reports ambiguity rather than picking between two unlabelled cards', () => {
    const doc = buildModulePage({
      modules: ['Module 31'],
      activeIndex: 0,
      cards: [
        { title: 'Communication Task - Module 31' },
        { title: 'Scala Module 2' },
        { title: 'Erlang Module 7' },
      ],
    });

    const result = detectTechnicalTask(doc);

    expect(result.status).toBe('failed');
    if (result.status !== 'failed') return;
    expect(result.reason).toBe('technical-task-ambiguous');
    expect(result.retryable).toBe(true);
    // The UI needs the real list to offer a manual choice.
    expect(result.candidates.length).toBeGreaterThanOrEqual(3);
  });

  it('reports not-found when every task is non-technical', () => {
    const doc = buildModulePage({
      modules: ['Module 31'],
      activeIndex: 0,
      cards: [
        { title: 'Communication Task - Module 31' },
        { title: 'Personal Development Workouts Module 31' },
        { title: 'Miscellaneous Premium - Module 31' },
      ],
    });

    const result = detectTechnicalTask(doc);

    expect(result.status).toBe('failed');
    if (result.status !== 'failed') return;
    expect(result.reason).toBe('technical-task-not-found');
  });

  it('says it is not the portal on an unrelated site with a card grid', () => {
    // A shop's product grid is structurally identical to a task list. Without a
    // portal signal, saying "your technical task is ambiguous" would be a lie.
    const products = ['Phone 5G 128 GB', 'Laptop 16 inch', 'Headphones wireless', 'Watch series 8']
      .map((name) => `<div class="product"><h3>${name}</h3><span>In stock</span></div>`)
      .join('');
    document.body.innerHTML = `<main><div class="grid">${products}</div></main>`;

    const result = detectTechnicalTask(document);

    expect(result.status).toBe('failed');
    if (result.status !== 'failed') return;
    expect(result.reason).toBe('not-on-portal');
  });

  it('says it is not the portal on a page with nothing task-like', () => {
    document.body.innerHTML = '<h1>Some other website</h1><p>Nothing to see.</p>';

    const result = detectTechnicalTask(document, 'https://example.com/');

    expect(result.status).toBe('failed');
    if (result.status !== 'failed') return;
    expect(result.reason).toBe('not-on-portal');
  });

  it('reports no task list when it IS the portal but nothing was found', () => {
    // Being on the portal is what makes "no task list" the honest answer rather
    // than "wrong site" - the distinction tells the student what to do next.
    document.body.innerHTML = '<div class="empty">Loading your module…</div>';

    const result = detectTechnicalTask(
      document,
      'https://student.brototype.com/tasks/module/details?id=x',
    );

    expect(result.status).toBe('failed');
    if (result.status !== 'failed') return;
    expect(result.reason).toBe('no-tasks-found');
    expect(result.retryable).toBe(true);
  });
});

describe('an already-opened technical task', () => {
  it('reads the task title and module from the page itself', () => {
    const doc = buildOpenedTaskPage({
      moduleHeading: 'Module Task - 29',
      taskTitle: 'Advanced Query Engines Module 3',
      declaredTopics: 6,
      topics: [
        'State Management',
        'Middleware and DevTools',
        'Error Handling and Validation',
        'Marketplace Platform',
        'Lightweight Stores',
        'Observable Stores',
      ],
    });

    const result = detectTechnicalTask(doc);

    expect(result.status).toBe('ok');
    if (result.status !== 'ok') return;
    expect(result.taskTitle).toBe('Advanced Query Engines Module 3');
    expect(result.module.title).toBe('Module Task - 29');
    expect(result.detection.matchedSignals).toContain('structure-signature');
    expect(result.detection.warnings).toHaveLength(0);
  });

  it('warns when the page declares more topics than it shows', () => {
    const doc = buildOpenedTaskPage({
      moduleHeading: 'Module Task - 30',
      taskTitle: 'Concurrency Module 9',
      declaredTopics: 6,
      topics: ['Threads', 'Locks'],
    });

    const result = detectTechnicalTask(doc);

    expect(result.status).toBe('ok');
    if (result.status !== 'ok') return;
    expect(result.detection.warnings.join(' ')).toMatch(/declares 6 topics but 2/);
  });
});
