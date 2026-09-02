import { useCallback, useEffect, useState } from 'react';
import { readRoadmapJob, saveToNotion } from '../services/api.js';
import { sendToWorker } from '../services/messaging.js';
import { RoadmapView } from '../ui/RoadmapView.js';
import { STORAGE_KEYS, analysisStateSchema, type AnalysisState } from '../types/index.js';

/**
 * THE POPUP — the whole product, inside the extension.
 *
 * One button, and the roadmap appears below it. No tab to navigate to, no panel
 * docked somewhere else.
 *
 * The popup holds no state of its own, because it cannot: Chrome destroys it
 * the moment the student clicks anywhere else, and a run takes about a minute.
 * The worker owns the run and writes to storage; this reads it. Close the popup
 * halfway through, reopen it, and the roadmap is either still coming or already
 * there.
 */

const POLL_MS = 700;

/**
 * Past this, a run is not slow - it is gone.
 *
 * A state with no way out is worse than an error: the popup once showed
 * "running" for over an hour. Every state needs an exit.
 */
const STALE_MS = 6 * 60 * 1000;

function isStale(state: AnalysisState): boolean {
  return state.status === 'running' && Date.now() - state.startedAt > STALE_MS;
}

/**
 * Asks the server how the ticket is doing, and writes down the answer.
 *
 * This is why a closed popup costs nothing: the run belongs to the server, and
 * whoever opens the popup next simply asks. Nothing had to be watching.
 */
async function refreshFromServer(state: AnalysisState): Promise<AnalysisState> {
  if (state.status !== 'running' || state.jobId === undefined) {
    return state;
  }

  const result = await readRoadmapJob(state.jobId);

  if (!result.ok) {
    // The server being unreachable does not mean the run failed - it may just
    // have been restarted. Keep waiting; staleness will end it if it is gone.
    return result.code === 'SERVER_UNREACHABLE'
      ? state
      : { status: 'failed', code: result.code, message: result.message, retryable: result.retryable };
  }

  const { job } = result;

  if (job.status === 'running') {
    return { ...state, detail: job.detail };
  }

  const next: AnalysisState =
    job.status === 'done'
      ? {
          status: 'done',
          finishedAt: job.finishedAt,
          moduleTitle: state.moduleTitle ?? '',
          taskTitle: state.taskTitle ?? '',
          understanding: job.value.understanding,
          knowledge: job.value.knowledge,
          practice: job.value.practice,
          plan: job.value.plan,
          cached: job.value.cached,
          ms: job.ms,
          topicsRead: state.topicsRead ?? 0,
          ...(state.topicsDeclared === undefined ? {} : { topicsDeclared: state.topicsDeclared }),
          warnings: state.warnings ?? [],
        }
      : { status: 'failed', code: job.code, message: job.message, retryable: job.retryable };

  await chrome.storage.local.set({ [STORAGE_KEYS.analysis]: next });
  return next;
}

export function App(): React.JSX.Element {
  const [state, setState] = useState<AnalysisState>({ status: 'idle' });

  const read = useCallback(async () => {
    const stored = await chrome.storage.local.get(STORAGE_KEYS.analysis);
    const parsed = analysisStateSchema.safeParse(stored[STORAGE_KEYS.analysis]);

    if (!parsed.success) {
      setState({ status: 'idle' });
      return;
    }

    if (isStale(parsed.data)) {
      setState({
        status: 'failed',
        code: 'STALLED',
        message: 'That run stopped before it finished. Press Generate Roadmap to try again.',
        retryable: true,
      });
      return;
    }

    setState(await refreshFromServer(parsed.data));
  }, []);

  useEffect(() => {
    void read();
  }, [read]);

  // While the worker is working, keep looking. Polling rather than a port,
  // because a port dies with the popup and the run does not.
  useEffect(() => {
    if (state.status !== 'running') {
      return;
    }

    const timer = setInterval(() => void read(), POLL_MS);
    return () => clearInterval(timer);
  }, [state.status, read]);

  const start = useCallback(
    async (force = false) => {
      setState({ status: 'running', startedAt: Date.now(), detail: 'Reading the task…' });
      await sendToWorker({ type: 'ANALYSE', force });
      await read();
    },
    [read],
  );

  return (
    <>
      <div className="header">
        <h1>Brotomap</h1>
        {state.status === 'done' && (
          <button
            type="button"
            className="linkish"
            onClick={() => void sendToWorker({ type: 'OPEN_FULL_VIEW' })}
          >
            Print / PDF
          </button>
        )}
      </div>

      <div className="panel stack">
        <button type="button" onClick={() => void start()} disabled={state.status === 'running'}>
          {state.status === 'done' ? 'Generate again' : 'Generate Roadmap'}
        </button>

        {state.status === 'running' && <Running state={state} />}

        {state.status === 'failed' && (
          <div className="status small">
            <div>{state.message}</div>
            <div className="muted">Reason: {state.code}</div>
            {state.code === 'non-technical-task-open' && (
              <button
                type="button"
                className="secondary"
                style={{ marginTop: 8 }}
                onClick={() => void start(true)}
              >
                Use the technical task instead
              </button>
            )}
          </div>
        )}

        {state.status === 'done' && <SaveToNotion state={state} />}

        {state.status === 'done' && (
          <>
            <p className="muted small">
              {state.cached ? 'from cache' : `${(state.ms / 1000).toFixed(1)}s`}
            </p>
            <RoadmapView
              moduleTitle={state.moduleTitle}
              taskTitle={state.taskTitle}
              understanding={state.understanding}
              knowledge={state.knowledge}
              practice={state.practice}
              plan={state.plan}
              topicsRead={state.topicsRead}
              {...(state.topicsDeclared === undefined ? {} : { topicsDeclared: state.topicsDeclared })}
              warnings={state.warnings}
            />
          </>
        )}
      </div>
    </>
  );
}

/**
 * Sending the roadmap to Notion.
 *
 * Worth more than a PDF for the same content: the learning order arrives as
 * checkboxes, so the page becomes a record of what has been learned rather than
 * a record of what was assigned.
 */
function SaveToNotion({
  state,
}: {
  state: Extract<AnalysisState, { status: 'done' }>;
}): React.JSX.Element {
  const [result, setResult] = useState<{ url?: string; message?: string } | null>(null);
  const [busy, setBusy] = useState(false);

  const save = useCallback(async () => {
    setBusy(true);

    const outcome = await saveToNotion({
      moduleTitle: state.moduleTitle,
      taskTitle: state.taskTitle,
      understanding: state.understanding,
      knowledge: state.knowledge,
      practice: state.practice,
      plan: state.plan,
    });

    setResult(outcome.ok ? { url: outcome.url } : { message: outcome.message });
    setBusy(false);
  }, [state]);

  return (
    <>
      <button type="button" className="secondary" onClick={() => void save()} disabled={busy}>
        {busy ? 'Saving to Notion…' : 'Save to Notion'}
      </button>

      {result?.url !== undefined && (
        <div className="status small">
          Saved.{' '}
          <a href={result.url} target="_blank" rel="noreferrer">
            Open in Notion
          </a>
        </div>
      )}

      {result?.message !== undefined && <div className="status small">{result.message}</div>}
    </>
  );
}

/**
 * A run takes about a minute on a free tier, most of it waiting out a
 * per-minute token limit. A line of text that never changes during that is
 * indistinguishable from a hang, so the seconds are shown.
 */
function Running({
  state,
}: {
  state: Extract<AnalysisState, { status: 'running' }>;
}): React.JSX.Element {
  const [seconds, setSeconds] = useState(0);

  useEffect(() => {
    const timer = setInterval(
      () => setSeconds(Math.round((Date.now() - state.startedAt) / 1000)),
      500,
    );
    return () => clearInterval(timer);
  }, [state.startedAt]);

  return (
    <div className="status small">
      <div>
        {state.detail} {seconds > 1 ? `${seconds}s` : ''}
      </div>
      <div className="muted">
        You can close this popup — it keeps running, and the roadmap will be here when you reopen
        it.
      </div>
    </div>
  );
}
