import { startRoadmap } from '../services/api.js';
import {
  STORAGE_KEYS,
  extensionMessageSchema,
  type AnalysisState,
  type DetectionResult,
  type ExtensionMessage,
  type ExtractionFailureReason,
  type ExtractionOutcome,
} from '../types/index.js';

/**
 * SERVICE WORKER — the router.
 *
 * Deliberately thin. MV3 terminates this worker when it goes idle, so it must
 * never own long work: from Phase 5 the roadmap tab owns the network call, and
 * this file only routes messages, injects the content script, and manages tabs.
 *
 * It is also the trust boundary inside the extension: every message it receives
 * is validated against the shared schema before anything acts on it.
 */

/** Pages Chrome refuses to let extensions script, whatever permissions we hold. */
const RESTRICTED_URL =
  /^(chrome|edge|about|devtools|view-source|chrome-extension):|^https:\/\/chromewebstore\.google\.com/;

/** Port name the roadmap tab connects with so the worker can track it. */
const ROADMAP_PORT = 'brotomap:roadmap-tab';

/** Where the roadmap tab id is remembered, so a restarted worker still finds it. */
const ROADMAP_TAB_KEY = 'roadmapTabId';

/**
 * The portal tab the student pressed Generate on.
 *
 * Needed because opening the roadmap tab makes *it* the active tab: by the time
 * the roadmap page asks for the task, "the active tab" is the roadmap itself.
 * The tab to read is the one that was active at the moment of the click.
 */
const SOURCE_TAB_KEY = 'sourceTabId';

function failure(
  reason: ExtractionFailureReason,
  message: string,
  retryable = false,
): DetectionResult {
  return { status: 'failed', reason, message, candidates: [], retryable };
}

/**
 * Turns Chrome's internal errors into something a student can act on.
 * The raw text ("Cannot access contents of the url…") is accurate and useless.
 */
function describeTabError(error: unknown): DetectionResult {
  const raw = error instanceof Error ? error.message : String(error);

  if (/cannot access|permission|extension manifest/i.test(raw)) {
    return failure(
      'not-on-portal',
      'Chrome would not let Brotomap read this page. Open your portal tab and click the Brotomap icon there.',
    );
  }

  if (/receiving end does not exist|message port closed/i.test(raw)) {
    return failure(
      'page-loading-timeout',
      'The page did not respond. Reload it and try again.',
      true,
    );
  }

  if (/no tab with id|no window with id/i.test(raw)) {
    return failure('not-on-portal', 'That tab is gone. Open your portal tab and try again.', true);
  }

  return failure('extraction-failed', `Could not read the page (${raw}).`, true);
}

async function getActiveTab(): Promise<chrome.tabs.Tab | undefined> {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab;
}

/**
 * Injects the content script unless it is already there.
 *
 * The PING first matters: executeScript happily runs the file a second time,
 * which would register a second onMessage listener and produce duplicate
 * replies for every message that follows.
 */
async function ensureContentScript(tabId: number): Promise<void> {
  try {
    const pong: unknown = await chrome.tabs.sendMessage(tabId, { type: 'PING' });
    if (typeof pong === 'object' && pong !== null && (pong as ExtensionMessage).type === 'PONG') {
      return;
    }
  } catch {
    // No receiver on the other end: the script is not injected yet.
  }

  await chrome.scripting.executeScript({ target: { tabId }, files: ['content.js'] });
}

/** Ask the page what is on it. Every failure path returns a specific reason. */
async function probeActiveTab(): Promise<DetectionResult> {
  const tab = await getActiveTab();

  if (tab?.id === undefined || tab.url === undefined) {
    return failure('not-on-portal', 'No active tab to read.');
  }

  if (RESTRICTED_URL.test(tab.url)) {
    return failure('not-on-portal', 'Brotomap cannot read browser pages. Open your portal tab.');
  }

  try {
    await ensureContentScript(tab.id);
    const reply: unknown = await chrome.tabs.sendMessage(tab.id, { type: 'PROBE' });
    const parsed = extensionMessageSchema.safeParse(reply);

    if (!parsed.success || parsed.data.type !== 'PROBE_RESULT') {
      return failure('extraction-failed', 'The page returned an unexpected reply.', true);
    }

    return parsed.data.result;
  } catch (error) {
    return describeTabError(error);
  }
}

/** The portal tab remembered at Generate time, falling back to the active one. */
async function getSourceTab(): Promise<chrome.tabs.Tab | undefined> {
  const stored = await chrome.storage.session.get(SOURCE_TAB_KEY);
  const sourceId: unknown = stored[SOURCE_TAB_KEY];

  if (typeof sourceId === 'number') {
    try {
      return await chrome.tabs.get(sourceId);
    } catch {
      await chrome.storage.session.remove(SOURCE_TAB_KEY);
    }
  }

  return getActiveTab();
}

const wait = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

/** Waits for a navigation to finish, so the new page can be read. */
async function waitForTabReady(tabId: number, timeoutMs = 15_000): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    await wait(150);

    try {
      const tab = await chrome.tabs.get(tabId);
      if (tab.status === 'complete') {
        // The page is loaded; a framework still needs a moment to render.
        await wait(400);
        return true;
      }
    } catch {
      return false;
    }
  }

  return false;
}

/**
 * Read the whole task, following the task's own page when necessary.
 *
 * On a task list the topics simply are not present, so the content script opens
 * the technical task and reports 'navigating'. The worker owns the wait because
 * the content script does not survive the navigation that it just caused.
 */
async function extractFromActiveTab(useTechnical = false, attempt = 0): Promise<ExtractionOutcome> {
  const tab = await getSourceTab();

  if (tab?.id === undefined || tab.url === undefined) {
    return { status: 'failed', reason: 'not-on-portal', message: 'No active tab to read.', retryable: false };
  }

  if (RESTRICTED_URL.test(tab.url)) {
    return {
      status: 'failed',
      reason: 'not-on-portal',
      message: 'Brotomap cannot read browser pages. Open your portal tab.',
      retryable: false,
    };
  }

  try {
    await ensureContentScript(tab.id);
    const reply: unknown = await chrome.tabs.sendMessage(tab.id, { type: 'EXTRACT', useTechnical });
    const parsed = extensionMessageSchema.safeParse(reply);

    if (!parsed.success || parsed.data.type !== 'EXTRACT_RESULT') {
      return {
        status: 'failed',
        reason: 'extraction-failed',
        message: 'The page returned an unexpected reply.',
        retryable: true,
      };
    }

    const outcome = parsed.data.outcome;

    if (outcome.status === 'navigating') {
      if (attempt >= 2) {
        return {
          status: 'failed',
          reason: 'task-page-open-failed',
          message: `Opened "${outcome.taskTitle}" but its topics did not load. Open the task yourself and try again.`,
          retryable: true,
        };
      }

      await waitForTabReady(tab.id);
      return extractFromActiveTab(useTechnical, attempt + 1);
    }

    // A freshly rendered page may not have its topics yet; give it one retry.
    if (outcome.status === 'failed' && outcome.reason === 'no-topics-found' && attempt > 0 && attempt < 3) {
      await wait(1200);
      return extractFromActiveTab(useTechnical, attempt + 1);
    }

    return outcome;
  } catch (error) {
    const described = describeTabError(error);
    return described.status === 'failed'
      ? {
          status: 'failed',
          reason: described.reason,
          message: described.message,
          retryable: described.retryable,
        }
      : { status: 'failed', reason: 'extraction-failed', message: 'Could not read the page.', retryable: true };
  }
}

async function setAnalysis(state: AnalysisState): Promise<void> {
  await chrome.storage.local.set({ [STORAGE_KEYS.analysis]: state });
}

/**
 * Hand the work to the server, then stop caring what happens to this worker.
 *
 * Every previous attempt tried to find a browser context that survives a
 * minute. None does: a popup dies the moment the student clicks away, and a
 * service worker dies when it goes idle - which is exactly what waiting out a
 * rate limit looks like. So nothing is asked to survive. The server takes the
 * task, answers with a ticket, and finishes on its own.
 */
async function analyse(force: boolean): Promise<void> {
  const outcome = await extractFromActiveTab(force);

  if (outcome.status !== 'ok') {
    await setAnalysis({
      status: 'failed',
      code: outcome.status === 'navigating' ? 'NAVIGATING' : outcome.reason,
      message: outcome.message,
      retryable: outcome.status === 'navigating' ? true : outcome.retryable,
    });
    return;
  }

  const started = await startRoadmap(outcome.task);

  if (!started.ok) {
    await setAnalysis({
      status: 'failed',
      code: started.code,
      message: started.message,
      retryable: started.retryable,
    });
    return;
  }

  await setAnalysis({
    status: 'running',
    startedAt: Date.now(),
    detail: `Building the roadmap for "${outcome.task.task.title}"…`,
    jobId: started.jobId,
    moduleTitle: outcome.task.module.title,
    taskTitle: outcome.task.task.title,
    topicsRead: outcome.task.topics.length,
    topicsDeclared: outcome.task.task.declaredTopicCount,
    warnings: outcome.task.detection.warnings,
  });
}

/** Ask the page to describe what the detector saw. Never fails loudly. */
async function diagnoseActiveTab(): Promise<string> {
  // The portal tab, not the active one: this is usually clicked from the
  // roadmap tab, and asking an extension page to describe the portal produces
  // a confusing permission error instead of a report.
  const tab = await getSourceTab();

  if (tab?.id === undefined || tab.url === undefined) {
    return 'BROTOMAP DIAGNOSTIC: no portal tab found. Open your module and try again.';
  }

  if (RESTRICTED_URL.test(tab.url)) {
    return 'BROTOMAP DIAGNOSTIC: the portal tab is gone. Open your module and press Generate again.';
  }

  try {
    await ensureContentScript(tab.id);
    const reply: unknown = await chrome.tabs.sendMessage(tab.id, { type: 'DIAGNOSE' });
    const parsed = extensionMessageSchema.safeParse(reply);

    return parsed.success && parsed.data.type === 'DIAGNOSTIC'
      ? parsed.data.report
      : 'BROTOMAP DIAGNOSTIC: the page did not report anything.';
  } catch (error) {
    return `BROTOMAP DIAGNOSTIC: could not read the page (${
      error instanceof Error ? error.message : 'unknown error'
    }).`;
  }
}

/**
 * One roadmap tab, reused rather than piling up duplicates.
 *
 * The id is not queried by URL — that would need the broad "tabs" permission —
 * and it is not trusted blindly either: the roadmap page opens a port when it
 * loads and the worker drops the id the moment that port disconnects, so a tab
 * the student closed or navigated away can never be focused by mistake.
 */
async function openRoadmapTab(): Promise<string> {
  const stored = await chrome.storage.session.get(ROADMAP_TAB_KEY);
  const knownId: unknown = stored[ROADMAP_TAB_KEY];

  if (typeof knownId === 'number') {
    try {
      await chrome.tabs.update(knownId, { active: true });
      return 'Focused the existing roadmap tab.';
    } catch {
      await chrome.storage.session.remove(ROADMAP_TAB_KEY);
    }
  }

  await chrome.tabs.create({ url: chrome.runtime.getURL('roadmap.html') });
  return 'Opened the roadmap tab.';
}

async function rememberSourceTab(): Promise<void> {
  const tab = await getActiveTab();

  if (tab?.id !== undefined && tab.url !== undefined && !RESTRICTED_URL.test(tab.url)) {
    await chrome.storage.session.set({ [SOURCE_TAB_KEY]: tab.id });
  }
}

/** The roadmap tab announces itself here, and its disconnect clears the id. */
chrome.runtime.onConnect.addListener((port) => {
  if (port.name !== ROADMAP_PORT) {
    return;
  }

  const tabId = port.sender?.tab?.id;

  if (tabId !== undefined) {
    void chrome.storage.session.set({ [ROADMAP_TAB_KEY]: tabId });
  }

  port.onDisconnect.addListener(() => {
    void chrome.storage.session.remove(ROADMAP_TAB_KEY);
  });
});

/**
 * A run that was in progress when Chrome restarted, or when the extension was
 * reloaded, is not in progress any more. Left alone it would greet the student
 * with a spinner for something that stopped hours ago.
 */
chrome.runtime.onStartup.addListener(() => void clearStaleRun());
chrome.runtime.onInstalled.addListener(() => void clearStaleRun());

async function clearStaleRun(): Promise<void> {
  const stored = await chrome.storage.local.get(STORAGE_KEYS.analysis);
  const state: unknown = stored[STORAGE_KEYS.analysis];

  if (typeof state === 'object' && state !== null && (state as AnalysisState).status === 'running') {
    await chrome.storage.local.remove([STORAGE_KEYS.analysis, STORAGE_KEYS.pendingTask]);
  }
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  const parsed = extensionMessageSchema.safeParse(message);

  if (!parsed.success) {
    return false;
  }

  switch (parsed.data.type) {
    case 'PROBE':
      // Returning true keeps the channel open for the async reply below.
      void probeActiveTab().then((result) => sendResponse({ type: 'PROBE_RESULT', result }));
      return true;

    case 'EXTRACT':
      void extractFromActiveTab(parsed.data.useTechnical === true).then((outcome) =>
        sendResponse({ type: 'EXTRACT_RESULT', outcome }),
      );
      return true;

    case 'ANALYSE': {
      const { force = false } = parsed.data;
      void (async () => {
        // Written before answering, not after. The popup re-reads storage the
        // moment this returns, and answering first meant it read the *previous*
        // run's state - which, if that one had stalled, made a fresh click look
        // like an instant failure.
        await setAnalysis({
          status: 'running',
          startedAt: Date.now(),
          detail: 'Reading the task…',
        });

        sendResponse({ type: 'ACK', detail: 'started' });

        try {
          await analyse(force);
        } catch (error) {
          await setAnalysis({
            status: 'failed',
            code: 'INTERNAL',
            message: error instanceof Error ? error.message : 'Something went wrong.',
            retryable: true,
          });
        }
      })();
      return true;
    }

    case 'DIAGNOSE':
      void diagnoseActiveTab().then((report) => sendResponse({ type: 'DIAGNOSTIC', report }));
      return true;

    case 'GENERATE':
      // Remember which tab to read. The popup opens the side panel itself,
      // because Chrome only allows that from a user gesture and a message to
      // the worker no longer counts as one. The ACK is not optional: a handled
      // message with no reply makes Chrome reject the sender's promise.
      void rememberSourceTab().then(() => sendResponse({ type: 'ACK', detail: 'Reading the task…' }));
      return true;

    case 'OPEN_FULL_VIEW':
      void openRoadmapTab().then((detail) => sendResponse({ type: 'ACK', detail }));
      return true;

    default:
      return false;
  }
});
