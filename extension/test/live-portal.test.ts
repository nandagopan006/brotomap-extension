// @vitest-environment happy-dom
import { beforeEach, describe, expect, it } from 'vitest';
import { describePage } from '../src/content/detector/diagnostics.js';
import { detectTechnicalTask } from '../src/content/detector/index.js';

/**
 * THE LIVE PORTAL, as observed.
 *
 * Reconstructed from the real page at
 *   student.brototype.com/tasks/module/details?id=<uuid>
 *
 * Everything here mirrors what the portal actually does, including the parts
 * that broke the first attempt:
 *
 *  - no semantic headings anywhere; titles are plain divs
 *  - the module is a single chip with arrows, not a list
 *  - each task card carries a one-word category badge ("Personal", not
 *    "Personal Development") beside a status chip
 *  - the sidebar is a list of similar items, structurally indistinguishable
 *    from a task list until you read what the cards say
 *  - the opened task's topics render in a second pane on the same page
 */

const PORTAL_URL = 'https://student.brototype.com/tasks/module/details?id=88b807d7-b4ea-41c4';

interface PortalCard {
  badge: string;
  status: string;
  title: string;
  selected?: boolean;
}

const LIVE_CARDS: PortalCard[] = [
  { badge: 'Personal', status: 'Verified', title: 'Personal Development Workouts Premium Module 29' },
  { badge: 'Technical', status: 'Submitted', title: 'React Module 3', selected: true },
  { badge: 'Communication', status: 'Submitted', title: 'Communication Task - Module 29' },
  { badge: 'Miscellaneous', status: 'Verified', title: 'Miscellaneous 1 Year Premium - Module 29' },
];

function buildLivePortalPage(cards: PortalCard[] = LIVE_CARDS): Document {
  const sidebar = [
    'Dashboard',
    'Tasks',
    'Module',
    'Daily',
    'Sessions',
    'Exams',
    'Tests',
    'Payments',
    'Requests',
    'My Services',
    'My Portfolio',
  ]
    .map((item) => `<div class="nav-item">${item}</div>`)
    .join('');

  const taskCards = cards
    .map(
      (card) => `
      <div class="task-card${card.selected === true ? ' task-card--selected' : ''}">
        <div class="task-card__row">
          <div class="task-card__badge">${card.badge}</div>
          <div class="task-card__status">${card.status}</div>
        </div>
        <div class="task-card__title">${card.title}</div>
      </div>`,
    )
    .join('');

  const topics = [
    'State Management with Redux',
    'Redux Middleware &amp; DevTools',
    'Error Handling and Validation',
    'OLX-like E-Commerce Platform',
    'Zustand',
    'MobX',
  ]
    .map(
      (title, index) => `
      <div class="topic">
        <div class="topic__label">Topic ${index + 1}</div>
        <div class="topic__title">${index + 1}). ${title}</div>
        <div class="topic__attachments">1 attachment added</div>
      </div>`,
    )
    .join('');

  document.body.innerHTML = `
    <div class="app">
      <div class="sidebar">
        <div class="logo">BROTOTYPE</div>
        <div class="nav">${sidebar}</div>
        <div class="nav-item">Log Out</div>
      </div>
      <div class="main">
        <div class="page-header"><div class="page-title">Module Task - 29</div></div>
        <div class="left-pane">
          <div class="module-nav">
            <button class="arrow">&lt;</button>
            <button class="arrow">&gt;</button>
            <div class="module-chip">Module 29</div>
          </div>
          <div class="progress">
            <div class="progress__label">Module Progress</div>
            <div class="progress__value">4/4 Completed</div>
          </div>
          <div class="task-list">${taskCards}</div>
        </div>
        <div class="right-pane">
          <div class="overview">
            <div class="overview__title">Task Overview</div>
            <div class="overview__count">Total Topics: 6</div>
          </div>
          <div class="topics">${topics}</div>
        </div>
      </div>
    </div>`;

  return document;
}

beforeEach(() => {
  document.body.innerHTML = '';
});

describe('the live portal page', () => {
  it('identifies the technical task from its category badge', () => {
    const result = detectTechnicalTask(buildLivePortalPage(), PORTAL_URL);

    expect(result.status).toBe('ok');
    if (result.status !== 'ok') return;

    expect(result.taskTitle).toBe('React Module 3');
    expect(result.detection.matchedSignals).toContain('category-label');
  });

  it('reads the current module from the chip, with no heading tag anywhere', () => {
    const result = detectTechnicalTask(buildLivePortalPage(), PORTAL_URL);

    expect(result.status).toBe('ok');
    if (result.status !== 'ok') return;
    expect(result.module.title).toBe('Module 29');
    expect(result.module.isCurrent).toBe(true);
  });

  it('prefers the task list over the sidebar, which has the same shape', () => {
    // The sidebar has eleven similar items and no categories; the task list has
    // four and every one declares a category. Structure alone cannot separate
    // them - what the cards say can.
    const result = detectTechnicalTask(buildLivePortalPage(), PORTAL_URL);

    expect(result.status).toBe('ok');
    if (result.status !== 'ok') return;
    expect(result.detection.candidates).toHaveLength(4);
    expect(result.detection.candidates.map((candidate) => candidate.title)).toContain(
      'Communication Task - Module 29',
    );
  });

  it('drops the badge and status chip from the task title', () => {
    const result = detectTechnicalTask(buildLivePortalPage(), PORTAL_URL);

    expect(result.status).toBe('ok');
    if (result.status !== 'ok') return;
    expect(result.taskTitle).not.toMatch(/technical|submitted/i);
  });

  it('still works when the subject changes', () => {
    const page = buildLivePortalPage([
      { badge: 'Personal', status: 'Verified', title: 'Personal Development Workouts Module 31' },
      { badge: 'Technical', status: 'Pending', title: 'Postgres Indexing Module 9' },
      { badge: 'Communication', status: 'Verified', title: 'Communication Task - Module 31' },
    ]);

    const result = detectTechnicalTask(page, PORTAL_URL);

    expect(result.status).toBe('ok');
    if (result.status !== 'ok') return;
    expect(result.taskTitle).toBe('Postgres Indexing Module 9');
  });

  it('changes nothing on the page', () => {
    const page = buildLivePortalPage();
    const before = page.body.innerHTML;

    detectTechnicalTask(page, PORTAL_URL);

    expect(page.body.innerHTML).toBe(before);
  });
});

describe('diagnostics', () => {
  it('reports what the detector saw', () => {
    const report = describePage(buildLivePortalPage(), PORTAL_URL);

    expect(report).toContain('BROTOMAP DIAGNOSTIC');
    expect(report).toContain('portal url     : yes');
    expect(report).toContain('React Module 3');
    // The query string identifies the student's own record and must not travel.
    expect(report).not.toContain('88b807d7');
  });
});

/**
 * The module list page: student.brototype.com/tasks/module
 *
 * A harder page than the details view. The task rows carry no category badge at
 * all — only a status button — so identification falls back to elimination on
 * the titles. Worse, the bottom of the page lists four *other* modules with
 * their own task names, so several groups look like a task list at once and the
 * right module has to be chosen along with the right task.
 */
function buildModuleListPage(): Document {
  const sidebar = ['Dashboard', 'Tasks', 'Module', 'Daily', 'Sessions', 'Exams', 'Tests']
    .map((item) => `<div class="nav-item">${item}</div>`)
    .join('');

  const currentTasks = [
    ['Personal Development Workouts Premium Module 29', 'Verified'],
    ['React Module 3', 'View Submission'],
    ['Communication Task - Module 29', 'View Submission'],
    ['Miscellaneous 1 Year Premium - Module 29', 'Verified'],
  ]
    .map(
      ([name, action]) => `
      <div class="task-row">
        <div class="task-row__icon">done</div>
        <div class="task-row__name">${name}</div>
        <div class="task-row__action">${action}</div>
      </div>`,
    )
    .join('');

  const moduleCard = (label: string, tasks: string[]): string => `
    <div class="module-card">
      <div class="module-card__chip">${label}</div>
      <div class="module-card__count">Total Tasks: ${tasks.length}</div>
      <div class="module-card__tasks">
        ${tasks.map((task) => `<div class="module-card__task">${task}</div>`).join('')}
      </div>
    </div>`;

  document.body.innerHTML = `
    <div class="app">
      <div class="sidebar">${sidebar}</div>
      <div class="main">
        <div class="page-title">Module Tasks</div>
        <div class="summary">
          <div class="summary__chip">Module 29</div>
          <div class="summary__progress">Tasks Progress</div>
          <div class="summary__value">4/4 Submitted</div>
        </div>
        <div class="stats">
          <div class="stat">0 Pending</div>
          <div class="stat">0 Re-Do</div>
          <div class="stat">2 Submitted</div>
          <div class="stat">2 Verified</div>
        </div>
        <div class="task-rows">${currentTasks}</div>
        <div class="module-grid">
          ${moduleCard('Module 29', [
            'Personal Development Workouts P...',
            'React Module 3',
            'Communication Task - Module 29',
            'Miscellaneous 1 Year Premium - M...',
          ])}
          ${moduleCard('Module 30', [
            'Personal Development Workouts Pr...',
            'Web security &amp; Server, Full Domain...',
            'Communication Task - Module 30',
          ])}
          ${moduleCard('Module 31', [
            'Second Project Planning',
            'Communication Task - Module 31',
            'Miscellaneous 1 Year Premium - M...',
          ])}
        </div>
      </div>
    </div>`;

  return document;
}

describe('the module list page', () => {
  it('identifies the technical task by elimination when no badges exist', () => {
    const result = detectTechnicalTask(
      buildModuleListPage(),
      'https://student.brototype.com/tasks/module',
    );

    expect(result.status).toBe('ok');
    if (result.status !== 'ok') return;
    expect(result.taskTitle).toBe('React Module 3');
  });

  it('picks the current module, not one of the other modules listed below', () => {
    const result = detectTechnicalTask(
      buildModuleListPage(),
      'https://student.brototype.com/tasks/module',
    );

    expect(result.status).toBe('ok');
    if (result.status !== 'ok') return;
    expect(result.module.title).toBe('Module 29');
  });

  it('does not mistake a status button for the task name', () => {
    const result = detectTechnicalTask(
      buildModuleListPage(),
      'https://student.brototype.com/tasks/module',
    );

    expect(result.status).toBe('ok');
    if (result.status !== 'ok') return;
    expect(result.taskTitle).not.toMatch(/view submission|verified/i);
  });
});

/**
 * The portal as it is actually built: Material UI with emotion.
 *
 * Taken from a diagnostic captured on the live page. The class names are
 * hashed per style permutation, so two cards with the same status share a
 * class and two with a different status do not:
 *
 *   [4] signature=DIV|MuiBox-root.css-ldbaps  members=2
 *       - Personal      Verified   Personal Development Workouts Premium Module 29
 *       - Miscellaneous Verified   Miscellaneous 1 Year Premium - Module 29
 *
 * Two of four. The Submitted pair had a different hash and formed their own
 * group, so the task list was never seen whole - which is exactly why grouping
 * is by tag and role now, and never by class.
 */
function buildMuiPortalPage(): Document {
  // Same hash for the same status, as emotion actually generates.
  const hashFor = (status: string): string =>
    status === 'Verified' ? 'css-ldbaps' : 'css-1jkq8pn';

  const card = (badge: string, status: string, title: string): string => `
    <div class="MuiBox-root ${hashFor(status)}">
      <div class="MuiBox-root css-row">
        <div class="MuiChip-label css-badge">${badge}</div>
        <div class="MuiChip-label css-status">${status}</div>
      </div>
      <div class="MuiTypography-root css-title">${title}</div>
    </div>`;

  const topic = (index: number, title: string): string => `
    <div class="MuiBox-root css-1wate2x">
      <div class="MuiTypography-root css-t1">Topic ${index}</div>
      <div class="MuiTypography-root css-t2">${index}). ${title}</div>
      <div class="MuiTypography-root css-t3">1 attachment added</div>
    </div>`;

  document.body.innerHTML = `
    <div class="MuiBox-root css-app">
      <ul class="MuiList-padding MuiList-root css-dxofyg">
        <div class="css-79elbk">
          <div class="css-79elbk">Dashboard</div>
          <div class="css-79elbk">Tasks Module Daily</div>
          <div class="css-79elbk">Sessions</div>
          <div class="css-79elbk">Exams</div>
          <div class="css-79elbk">Tests</div>
          <div class="css-79elbk">Payments Payment Requests Facilitation Fee</div>
        </div>
        <div class="css-79elbk">Support Tickets Contact Us FAQ</div>
      </ul>
      <div class="MuiBox-root css-main">
        <div class="MuiTypography-root css-h">Module Task - 29</div>
        <div class="MuiBox-root css-left">
          <div class="MuiBox-root css-modnav">
            <button class="MuiIconButton-root">&lt;</button>
            <button class="MuiIconButton-root">&gt;</button>
            <div class="MuiTypography-root css-chip">Module 29</div>
          </div>
          <div class="MuiBox-root css-list">
            ${card('Personal', 'Verified', 'Personal Development Workouts Premium Module 29')}
            ${card('Technical', 'Submitted', 'React Module 3')}
            ${card('Communication', 'Submitted', 'Communication Task - Module 29')}
            ${card('Miscellaneous', 'Verified', 'Miscellaneous 1 Year Premium - Module 29')}
          </div>
        </div>
        <div class="MuiBox-root css-right">
          <div class="MuiTypography-root css-o1">Task Overview</div>
          <div class="MuiTypography-root css-o2">Total Topics: 6</div>
          <div class="MuiBox-root css-topics">
            ${topic(1, 'State Management with Redux')}
            ${topic(2, 'Redux Middleware &amp; DevTools')}
            ${topic(3, 'Error Handling and Validation')}
            ${topic(4, 'OLX-like E-Commerce Platform')}
            ${topic(5, 'Zustand')}
            ${topic(6, 'MobX')}
          </div>
        </div>
      </div>
    </div>`;

  return document;
}

describe('the portal as built (Material UI + emotion)', () => {
  it('sees all four cards even though their classes differ by status', () => {
    const result = detectTechnicalTask(buildMuiPortalPage(), PORTAL_URL);

    expect(result.status).toBe('ok');
    if (result.status !== 'ok') return;
    expect(result.detection.candidates).toHaveLength(4);
  });

  it('identifies the technical task', () => {
    const result = detectTechnicalTask(buildMuiPortalPage(), PORTAL_URL);

    expect(result.status).toBe('ok');
    if (result.status !== 'ok') return;
    expect(result.taskTitle).toBe('React Module 3');
    expect(result.module.title).toBe('Module 29');
  });

  it('is not distracted by the six topic blocks or the sidebar', () => {
    const result = detectTechnicalTask(buildMuiPortalPage(), PORTAL_URL);

    expect(result.status).toBe('ok');
    if (result.status !== 'ok') return;
    expect(result.taskTitle).not.toMatch(/topic|dashboard|payments/i);
  });
});

/**
 * Module 26 on the module list page, captured from the live portal.
 *
 * Two things make this page harder than it looks:
 *
 *  - the technical task is "Basics of JavaScript". No category badge, and no
 *    module number in the name either, so only elimination can find it.
 *  - four modules' task lists are on screen at once (25, 26, 27, 28), each
 *    equally category-labelled. Evidence cannot separate them; only being the
 *    list for the module the student is actually looking at can.
 */
function buildLearningJourneyPage(): Document {
  const row = (name: string, action: string): string =>
    `<div class="row"><div class="i">done</div><div class="n">${name}</div><div class="a">${action}</div></div>`;

  const moduleCard = (label: string, tasks: string[]): string => `
    <div class="mc">
      <div class="mc__chip">${label}</div>
      <div class="mc__count">Total Tasks: ${tasks.length}</div>
      ${tasks.map((task) => `<div class="mc__task">${task}</div>`).join('')}
    </div>`;

  document.body.innerHTML = `
    <div class="app">
      <div class="sidebar">
        <div class="nav">Dashboard</div><div class="nav">Tasks</div><div class="nav">Sessions</div>
      </div>
      <div class="main">
        <div class="title">Module Tasks</div>
        <div class="journey">
          <div class="j__t">Learning Journey</div>
          <div class="j__s">52-Module Software Training Program</div>
          <div class="j__m">Module 26</div>
          <div class="j__m">Module 27</div>
          <div class="j__m">Module 28</div>
          <div class="j__m">Module 29</div>
        </div>
        <div class="current">
          <div class="current__chip">Module 26</div>
          <div class="current__p">Tasks Progress</div>
          <div class="current__v">4/4 Submitted</div>
        </div>
        <div class="rows">
          ${row('Personal Development Workouts Premium Module 26', 'Verified')}
          ${row('Basics of JavaScript', 'Verified')}
          ${row('Communication Task - Module 26', 'View Submission')}
          ${row('Miscellaneous 1 Year Premium - Module 26', 'Verified')}
        </div>
        <div class="grid">
          ${moduleCard('Module 25', [
            'Personal Development Workouts Pr...',
            'Django REST Framework Proj...',
            'Communication Task- Module 25',
          ])}
          ${moduleCard('Module 26', [
            'Personal Development Workouts P...',
            'Basics of JavaScript',
            'Communication Task - Module 26',
          ])}
          ${moduleCard('Module 27', [
            'Personal Development Workouts Pr...',
            'React Module 1',
            'Communication Task - Module 27',
          ])}
        </div>
      </div>
    </div>`;

  return document;
}

describe('the learning journey page', () => {
  const url = 'https://student.brototype.com/tasks/module';

  it('finds a technical task with no badge and no module number in its name', () => {
    const result = detectTechnicalTask(buildLearningJourneyPage(), url);

    expect(result.status).toBe('ok');
    if (result.status !== 'ok') return;
    expect(result.taskTitle).toBe('Basics of JavaScript');
  });

  it('uses the module the student is on, not one of the others on screen', () => {
    const result = detectTechnicalTask(buildLearningJourneyPage(), url);

    expect(result.status).toBe('ok');
    if (result.status !== 'ok') return;
    expect(result.module.title).toBe('Module 26');
  });

  it('does not pick another module\u2019s technical task', () => {
    const result = detectTechnicalTask(buildLearningJourneyPage(), url);

    expect(result.status).toBe('ok');
    if (result.status !== 'ok') return;
    expect(result.taskTitle).not.toMatch(/django|react module 1/i);
  });
});
