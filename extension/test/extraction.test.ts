// @vitest-environment happy-dom
import { beforeEach, describe, expect, it } from 'vitest';
import { extractTechnicalTask } from '../src/content/extractor/index.js';
import { discoverTopics, parseTopic } from '../src/content/extractor/topics.js';
import { isSafeToClick } from '../src/content/extractor/expand.js';

/**
 * EXTRACTION TESTS
 *
 * Built to the live portal's task page: six numbered topics, the first expanded
 * and the rest collapsed, each followed by the student's own response.
 */

const PORTAL_URL = 'https://student.brototype.com/tasks/module/details?id=88b807d7';

interface TopicSpec {
  title: string;
  body?: string[];
  collapsed?: boolean;
  /** Collapsed but with the content still in the DOM, as MUI Collapse renders it. */
  hiddenInDom?: boolean;
  response?: string;
}

function topicHtml(index: number, spec: TopicSpec): string {
  const body = (spec.body ?? []).map((line) => `<div class="line">${line}</div>`).join('');
  const response =
    spec.response === undefined
      ? ''
      : `<div class="resp"><div class="resp__h">Your Response</div><div class="resp__b">task ${index}</div><div class="resp__b">${spec.response}</div><div class="resp__add">Add Attachments</div></div>`;

  const inner = `
    <div class="topic__title">${index}). ${spec.title}</div>
    ${body}
    ${response}`;

  if (spec.collapsed === true && spec.hiddenInDom !== true) {
    // Truly unmounted, as a lazy accordion does: only the header is in the DOM.
    return `
      <div class="MuiBox-root topic">
        <div class="topic__label">Topic ${index}</div>
        <div class="topic__title">${index}). ${spec.title}</div>
        <button aria-expanded="false" aria-controls="p${index}">expand</button>
        <div class="topic__meta">1 attachment added</div>
      </div>`;
  }

  return `
    <div class="MuiBox-root topic">
      <div class="topic__label">Topic ${index}</div>
      <button aria-expanded="${spec.collapsed === true ? 'false' : 'true'}" aria-controls="p${index}">expand</button>
      <div class="topic__body"${spec.hiddenInDom === true ? ' style="height:0;overflow:hidden"' : ''}>${inner}</div>
      <div class="topic__meta">1 attachment added</div>
    </div>`;
}

function buildTaskPage(topics: TopicSpec[]): Document {
  document.body.innerHTML = `
    <div class="MuiBox-root app">
      <div class="sidebar">
        <div class="nav-item">Dashboard</div>
        <div class="nav-item">Tasks</div>
        <div class="nav-item">Sessions</div>
      </div>
      <div class="main">
        <div class="page-title">Module Task - 29</div>
        <div class="left">
          <div class="chip">Module 29</div>
          <div class="task-list">
            <div class="card"><div class="b">Personal</div><div class="s">Verified</div><div class="t">Personal Development Workouts Premium Module 29</div></div>
            <div class="card"><div class="b">Technical</div><div class="s">Submitted</div><div class="t">React Module 3</div></div>
            <div class="card"><div class="b">Communication</div><div class="s">Submitted</div><div class="t">Communication Task - Module 29</div></div>
          </div>
        </div>
        <div class="right">
          <div class="ov__t">Task Overview</div>
          <div class="ov__c">Total Topics: ${topics.length}</div>
          <div class="topics">${topics.map((spec, i) => topicHtml(i + 1, spec)).join('')}</div>
        </div>
      </div>
    </div>`;
  return document;
}

const LIVE_TOPICS: TopicSpec[] = [
  {
    title: 'State Management with Redux',
    body: [
      'A) Introduction to Redux and the need for global state management',
      'B) Understanding the Redux data flow',
      'C) Configuring and using the Redux store',
      'D) Working with reducers, actions, and dispatch',
      'Write a short description about this task.',
    ],
    response: 'I explored global state management using Redux and learned why global state matters.',
  },
  {
    title: 'Redux Middleware and DevTools',
    body: ['A) Middleware basics', 'B) Time travel debugging'],
    collapsed: true,
    hiddenInDom: true,
  },
  {
    title: 'Error Handling and Validation',
    body: ['A) Error boundaries', 'B) Form validation'],
    collapsed: true,
    hiddenInDom: true,
  },
  {
    title: 'OLX-like E-Commerce Platform',
    body: ['Build a marketplace with listings and chat.'],
    collapsed: true,
    hiddenInDom: true,
  },
  {
    title: 'Zustand',
    body: ['A) Store creation', 'B) Selectors'],
    collapsed: true,
    hiddenInDom: true,
  },
  {
    title: 'MobX',
    body: ['A) Observables', 'B) Reactions'],
    collapsed: true,
    hiddenInDom: true,
  },
];

beforeEach(() => {
  document.body.innerHTML = '';
  sessionStorage.clear();
});

/**
 * What the service worker does: extraction opens the technical task first and
 * reports 'navigating', then reads it on the next call. Tests follow the same
 * two steps rather than pretending one call is enough.
 */
async function extractFully(
  doc: Document,
  url = PORTAL_URL,
): Promise<Awaited<ReturnType<typeof extractTechnicalTask>>> {
  const first = await extractTechnicalTask(doc, url);
  return first.status === 'navigating' ? extractTechnicalTask(doc, url) : first;
}

describe('topic discovery', () => {
  it('finds every numbered topic in source order', () => {
    const found = discoverTopics(buildTaskPage(LIVE_TOPICS));

    expect(found.map((topic) => topic.index)).toEqual([1, 2, 3, 4, 5, 6]);
  });

  it('is not confused by a task with a different number of topics', () => {
    const found = discoverTopics(buildTaskPage(LIVE_TOPICS.slice(0, 3)));

    expect(found).toHaveLength(3);
  });
});

describe('topic parsing', () => {
  it("keeps the instructions and drops the student's own answer", () => {
    const page = buildTaskPage(LIVE_TOPICS);
    const first = discoverTopics(page)[0];
    expect(first).toBeDefined();
    if (first === undefined) return;

    const parsed = parseTopic(first.element, 1);

    expect(parsed.title).toBe('State Management with Redux');
    expect(parsed.content).toContain('Understanding the Redux data flow');
    // The student's response is theirs. Planning a week around work already
    // submitted would be worse than useless.
    expect(parsed.content).not.toContain('I explored global state management');
    expect(parsed.content).not.toMatch(/your response|add attachments/i);
  });

  it('keeps lettered instruction items as a list', () => {
    const page = buildTaskPage(LIVE_TOPICS);
    const first = discoverTopics(page)[0];
    if (first === undefined) return;

    const parsed = parseTopic(first.element, 1);

    expect(parsed.sections[0]?.kind).toBe('instructions');
    expect(parsed.sections[0]?.items).toHaveLength(4);
  });

  it('records attachments as facts without fetching them', () => {
    const page = buildTaskPage(LIVE_TOPICS);
    const first = discoverTopics(page)[0];
    if (first === undefined) return;

    const parsed = parseTopic(first.element, 1);

    expect(parsed.attachments).toHaveLength(1);
    expect(parsed.attachments[0]?.accessible).toBe(false);
  });
});

describe('reading the whole task', () => {
  it('extracts every topic without touching the page', async () => {
    const page = buildTaskPage(LIVE_TOPICS);
    const before = page.body.innerHTML;

    const outcome = await extractFully(page);

    expect(outcome.status).toBe('ok');
    if (outcome.status !== 'ok') return;

    expect(outcome.task.task.title).toBe('React Module 3');
    expect(outcome.task.module.title).toBe('Module 29');
    expect(outcome.task.topics).toHaveLength(6);
    expect(outcome.task.task.declaredTopicCount).toBe(6);

    // Content was hidden by CSS, never absent - so no topic had to be opened.
    expect(outcome.task.detection.interactionCount).toBe(0);
    expect(page.body.innerHTML).toBe(before);
  });

  it('reads collapsed topics that are only hidden by CSS', async () => {
    const outcome = await extractFully(buildTaskPage(LIVE_TOPICS));

    expect(outcome.status).toBe('ok');
    if (outcome.status !== 'ok') return;

    const last = outcome.task.topics.find((topic) => topic.index === 6);
    expect(last?.title).toBe('MobX');
    expect(last?.content).toContain('Observables');
    expect(last?.expansion).toBe('hidden-in-dom');
  });

  it('reports topics it genuinely could not read, and keeps the rest', async () => {
    const page = buildTaskPage([
      LIVE_TOPICS[0] as TopicSpec,
      { title: 'Unreadable', collapsed: true },
    ]);

    const outcome = await extractFully(page);

    expect(outcome.status).toBe('ok');
    if (outcome.status !== 'ok') return;

    expect(outcome.task.topics).toHaveLength(2);
    expect(outcome.task.topics[0]?.complete).toBe(true);
    expect(outcome.task.detection.warnings.join(' ')).toMatch(/no content could be read/i);
  });

  it('never sends the query string, which identifies the student', async () => {
    const outcome = await extractFully(buildTaskPage(LIVE_TOPICS));

    expect(outcome.status).toBe('ok');
    if (outcome.status !== 'ok') return;
    expect(outcome.task.pageUrl).not.toContain('88b807d7');
  });

  it('opens the technical task when the topics are not on this page', async () => {
    // A task list has no topics on it - they live on the task's own page.
    // Giving up here would strand the student on the very page they started on.
    document.body.innerHTML = `
      <div class="chip">Module 29</div>
      <div class="task-list">
        <div class="card"><div>Technical</div><div>React Module 3</div></div>
        <div class="card"><div>Communication</div><div>Communication Task - Module 29</div></div>
      </div>`;

    const outcome = await extractTechnicalTask(document, PORTAL_URL);

    expect(outcome.status).toBe('navigating');
    if (outcome.status !== 'navigating') return;
    expect(outcome.taskTitle).toBe('React Module 3');
  });
});

/**
 * The safety rules are the most important code in the project. Brotomap plans;
 * it does not act on a student's account.
 */
describe('what may never be clicked', () => {
  function control(html: string): Element {
    document.body.innerHTML = html;
    const element = document.body.firstElementChild;
    if (element === null) throw new Error('no element');
    return element;
  }

  it.each([
    ['<button>Submit</button>', 'submit'],
    ['<button>Send for review</button>', 'send'],
    ['<button>Delete response</button>', 'delete'],
    ['<button>Upload file</button>', 'upload'],
    ['<button>Save draft</button>', 'save'],
    ['<button aria-label="Log out">x</button>', 'aria-label'],
    ['<a href="/other">Open</a>', 'navigation'],
    ['<form><button>Expand</button></form>', 'inside a form'],
  ])('refuses %s (%s)', (html) => {
    const element = control(html);
    const target = element.tagName === 'FORM' ? (element.firstElementChild as Element) : element;
    expect(isSafeToClick(target)).toBe(false);
  });

  it('allows a plain expander', () => {
    expect(isSafeToClick(control('<button aria-expanded="false">expand</button>'))).toBe(true);
  });
});

/**
 * The case the live portal actually presents: a collapsed topic whose content
 * is not in the DOM at all, opened by a bare chevron icon with no button
 * element and no aria-expanded.
 */
describe('expanding a chevron-only accordion', () => {
  function buildChevronPage(): { page: Document; before: string } {
    document.body.innerHTML = `
      <div class="chip">Module 29</div>
      <div class="task-list">
        <div class="card"><div>Technical</div><div>React Module 3</div></div>
        <div class="card"><div>Communication</div><div>Communication Task - Module 29</div></div>
      </div>
      <div class="ov">Total Topics: 2</div>
      <div class="topics">
        <div class="topic" id="t1">
          <div class="head">
            <div class="label">Topic 1</div>
            <div class="title">1). State Management</div>
            <div class="chev"><svg viewBox="0 0 24 24"></svg></div>
          </div>
          <div class="body"><div>A) Introduction to global state</div></div>
        </div>
        <div class="topic" id="t2">
          <div class="head">
            <div class="label">Topic 2</div>
            <div class="title">2). Middleware and DevTools</div>
            <div class="chev"><svg viewBox="0 0 24 24"></svg></div>
          </div>
        </div>
      </div>`;

    // The accordion: the chevron adds the body, and removes it again.
    const topic = document.querySelector('#t2');
    const chevron = topic?.querySelector('.chev');

    chevron?.addEventListener('click', () => {
      const existing = topic?.querySelector('.body');
      if (existing) {
        existing.remove();
      } else {
        topic?.insertAdjacentHTML(
          'beforeend',
          '<div class="body"><div>A) Middleware basics</div><div>B) Time travel debugging</div></div>',
        );
      }
    });

    return { page: document, before: document.body.innerHTML };
  }

  it('opens the topic, reads it, and puts the page back', async () => {
    const { page, before } = buildChevronPage();

    const outcome = await extractFully(page);

    expect(outcome.status).toBe('ok');
    if (outcome.status !== 'ok') return;

    const second = outcome.task.topics.find((topic) => topic.index === 2);
    expect(second?.expansion).toBe('expanded-by-us');
    expect(second?.content).toContain('Middleware basics');
    expect(second?.complete).toBe(true);

    // It touched the page, and it says so.
    expect(outcome.task.detection.interactionCount).toBeGreaterThan(0);

    // And it left the page exactly as it found it.
    expect(page.body.innerHTML).toBe(before);
  });

  it('does not touch a topic it can already read', async () => {
    const { page } = buildChevronPage();

    const outcome = await extractFully(page);

    expect(outcome.status).toBe('ok');
    if (outcome.status !== 'ok') return;
    expect(outcome.task.topics.find((topic) => topic.index === 1)?.expansion).toBe('already-visible');
  });
});

/**
 * The portal truncates long instructions behind "Read more". Half a sentence
 * is not a task: the AI would plan a week around it as though it were whole.
 */
describe('revealing truncated instructions', () => {
  it('presses Read more and captures the full text', async () => {
    document.body.innerHTML = `
      <div class="chip">Module 26</div>
      <div class="task-list">
        <div class="card"><div>Technical</div><div>Basics of JavaScript</div></div>
        <div class="card"><div>Communication</div><div>Communication Task - Module 26</div></div>
      </div>
      <div class="ov">Total Topics: 1</div>
      <div class="topics">
        <div class="topic" id="only">
          <div>Topic 1</div>
          <div>1). JavaScript Basics</div>
          <div id="short">a). Understand syntax and data types.</div>
          <div>Write a short description about this ta...</div>
          <div id="more">Read more</div>
        </div>
      </div>`;

    const control = document.querySelector('#more');
    const short = document.querySelector('#short');

    control?.addEventListener('click', () => {
      if (short !== null) {
        short.textContent =
          'a). Understand syntax and data types. b). Learn operators. c). Practice input and output.';
      }
    });

    const outcome = await extractFully(document);

    expect(outcome.status).toBe('ok');
    if (outcome.status !== 'ok') return;

    const topic = outcome.task.topics[0];
    expect(topic?.content).toContain('Practice input and output');
    expect(outcome.task.detection.interactionCount).toBeGreaterThan(0);
  });

  it('does not treat Read more as the end of the instructions', async () => {
    document.body.innerHTML = `
      <div class="chip">Module 26</div>
      <div class="task-list">
        <div class="card"><div>Technical</div><div>Basics of JavaScript</div></div>
        <div class="card"><div>Communication</div><div>Communication Task - Module 26</div></div>
      </div>
      <div class="ov">Total Topics: 1</div>
      <div class="topics">
        <div class="topic">
          <div>Topic 1</div>
          <div>1). JavaScript Basics</div>
          <div>a). Understand syntax.</div>
          <div>Read more</div>
          <div>b). Learn operators.</div>
        </div>
      </div>`;

    const outcome = await extractFully(document);

    expect(outcome.status).toBe('ok');
    if (outcome.status !== 'ok') return;
    // Content after the control must survive; only the student's response ends it.
    expect(outcome.task.topics[0]?.content).toContain('Learn operators');
  });
});

/**
 * The wrong-task bug, as it happened on the live portal.
 *
 * The task list and the topic pane are independent: the list shows every task,
 * the pane shows whichever is selected. A roadmap came back titled "Basics of
 * JavaScript" and filled entirely with the Personal Development task's
 * contents - a book summary. Confidently wrong, and invisible unless you read
 * it. Extraction must open the technical task before believing the pane.
 */
describe('the pane showing a different task', () => {
  function buildMismatchedPage(): Document {
    document.body.innerHTML = `
      <div class="chip">Module 26</div>
      <div class="task-list">
        <div class="card" id="personal"><div>Personal</div><div>Personal Development Workouts Premium Module 26</div></div>
        <div class="card" id="technical"><div>Technical</div><div>Basics of JavaScript</div></div>
        <div class="card"><div>Communication</div><div>Communication Task - Module 26</div></div>
      </div>
      <div class="pane">
        <div class="ov">Total Topics: 1</div>
        <div class="topics" id="pane">
          <div class="topic">
            <div>Topic 1</div>
            <div>1). Finish reading the next 50 pages of the book</div>
            <div>Read the next 50 pages and create an audio note summarising key insights.</div>
          </div>
        </div>
      </div>`;

    // Selecting the technical task swaps the pane, as the portal does.
    document.querySelector('#technical')?.addEventListener('click', () => {
      const pane = document.querySelector('#pane');
      if (pane !== null) {
        pane.innerHTML = `
          <div class="topic"><div>Topic 1</div><div>1). JavaScript Basics</div><div>a). Understand syntax and data types.</div></div>
          <div class="topic"><div>Topic 2</div><div>2). Control Flow and Loops</div><div>a). Learn if-else and loops.</div></div>`;
      }
    });

    return document;
  }

  it('opens the technical task instead of reading whatever is on screen', async () => {
    const first = await extractTechnicalTask(buildMismatchedPage(), PORTAL_URL);

    expect(first.status).toBe('navigating');
    if (first.status !== 'navigating') return;
    expect(first.taskTitle).toBe('Basics of JavaScript');
  });

  it('reads the technical task, never the task that happened to be open', async () => {
    const page = buildMismatchedPage();

    const outcome = await extractFully(page);

    expect(outcome.status).toBe('ok');
    if (outcome.status !== 'ok') return;

    expect(outcome.task.task.title).toBe('Basics of JavaScript');
    expect(outcome.task.topics).toHaveLength(2);
    expect(outcome.task.topics[0]?.title).toBe('JavaScript Basics');
    // The book summary belongs to another task and must not appear anywhere.
    expect(JSON.stringify(outcome.task)).not.toMatch(/audio note|50 pages/i);
  });

  it('does not open the task twice when asked again after navigating', async () => {
    const page = buildMismatchedPage();
    let clicks = 0;
    page.querySelector('#technical')?.addEventListener('click', () => {
      clicks += 1;
    });

    await extractFully(page);

    expect(clicks).toBe(1);
  });
});

/**
 * Brotomap plans technical tasks and nothing else.
 *
 * Quietly swapping the student's open task for a different one would be
 * presumptuous - they may be reading it deliberately. Say what is open, say
 * what Brotomap can do with it, and let them decide.
 */
describe('a non-technical task is open', () => {
  function buildWithSelection(selectedId: string): Document {
    const card = (id: string, badge: string, title: string): string =>
      `<div class="card" id="${id}" style="${
        id === selectedId ? 'border-color: rgb(0, 200, 0)' : 'border-color: rgb(30, 30, 30)'
      }"><div>${badge}</div><div>${title}</div></div>`;

    document.body.innerHTML = `
      <div class="chip">Module 26</div>
      <div class="task-list">
        ${card('personal', 'Personal', 'Personal Development Workouts Premium Module 26')}
        ${card('technical', 'Technical', 'Basics of JavaScript')}
        ${card('communication', 'Communication', 'Communication Task - Module 26')}
      </div>
      <div class="ov">Total Topics: 1</div>
      <div class="topics">
        <div class="topic"><div>Topic 1</div><div>1). Read 50 pages of a book</div><div>Create an audio note.</div></div>
      </div>`;

    return document;
  }

  it('refuses, and names both the open task and the technical one', async () => {
    const outcome = await extractTechnicalTask(buildWithSelection('personal'), PORTAL_URL);

    expect(outcome.status).toBe('failed');
    if (outcome.status !== 'failed') return;

    expect(outcome.reason).toBe('non-technical-task-open');
    expect(outcome.message).toContain('Personal Development Workouts Premium Module 26');
    expect(outcome.message).toContain('Basics of JavaScript');
    expect(outcome.retryable).toBe(false);
  });

  it('proceeds when the student asks for the technical task', async () => {
    const page = buildWithSelection('personal');

    const outcome = await extractTechnicalTask(page, PORTAL_URL, { useTechnical: true });

    // It opens the technical task rather than reading the book summary.
    expect(outcome.status).toBe('navigating');
    if (outcome.status !== 'navigating') return;
    expect(outcome.taskTitle).toBe('Basics of JavaScript');
  });

  it('does not object when the technical task is the one open', async () => {
    const outcome = await extractTechnicalTask(buildWithSelection('technical'), PORTAL_URL);

    expect(outcome.status).not.toBe('failed');
  });
});

/**
 * Topics that arrive late.
 *
 * The portal renders a task's topics over the second or two after it opens.
 * Reading immediately caught two of six - and a roadmap covering a third of the
 * task looks exactly like a roadmap for a small task, which is the worst kind
 * of wrong: quiet.
 */
describe('a page still rendering its topics', () => {
  function buildSlowPage(total: number, appearAfterMs: number): Document {
    document.body.innerHTML = `
      <div class="chip">Module 26</div>
      <div class="task-list">
        <div class="card"><div>Technical</div><div>Basics of JavaScript</div></div>
        <div class="card"><div>Communication</div><div>Communication Task - Module 26</div></div>
      </div>
      <div class="ov">Total Topics: ${total}</div>
      <div class="topics" id="topics">
        <div class="topic"><div>Topic 1</div><div>1). First</div><div>a). Something to learn.</div></div>
        <div class="topic"><div>Topic 2</div><div>2). Second</div><div>a). Something else.</div></div>
      </div>`;

    // The rest arrive shortly afterwards, as a framework would render them.
    setTimeout(() => {
      const container = document.querySelector('#topics');
      for (let index = 3; index <= total; index += 1) {
        container?.insertAdjacentHTML(
          'beforeend',
          `<div class="topic"><div>Topic ${index}</div><div>${index}). Later topic</div><div>a). Arrived late.</div></div>`,
        );
      }
    }, appearAfterMs);

    return document;
  }

  it('waits for the count the portal declared', async () => {
    const page = buildSlowPage(6, 400);

    const outcome = await extractFully(page);

    expect(outcome.status).toBe('ok');
    if (outcome.status !== 'ok') return;
    expect(outcome.task.topics).toHaveLength(6);
  });

  it('gives up eventually and says what it got', async () => {
    // Declared six, only ever renders two. Waiting forever helps nobody; the
    // honest answer is two topics and a warning that says so.
    const page = buildSlowPage(6, 60_000);

    const outcome = await extractFully(page);

    expect(outcome.status).toBe('ok');
    if (outcome.status !== 'ok') return;
    expect(outcome.task.topics).toHaveLength(2);
    expect(outcome.task.task.declaredTopicCount).toBe(6);
    expect(outcome.task.detection.warnings.join(' ')).toMatch(/declares 6 topics but 2/);
  }, 15_000);
});
