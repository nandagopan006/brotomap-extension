import { useEffect, useState } from 'react';
import { RoadmapView } from '../ui/RoadmapView.js';
import { STORAGE_KEYS, analysisStateSchema, type AnalysisState } from '../types/index.js';

/**
 * THE PRINTABLE PAGE.
 *
 * The roadmap is read in the popup; this exists for one thing, which a popup
 * cannot do: produce an A4 document. It runs nothing and decides nothing - it
 * renders whatever the last run left in storage, so the paper matches the
 * screen exactly.
 */
export function App(): React.JSX.Element {
  const [state, setState] = useState<AnalysisState | null>(null);

  useEffect(() => {
    void chrome.storage.local.get(STORAGE_KEYS.analysis).then((stored) => {
      const parsed = analysisStateSchema.safeParse(stored[STORAGE_KEYS.analysis]);
      setState(parsed.success ? parsed.data : { status: 'idle' });
    });
  }, []);

  if (state === null) {
    return <div className="panel muted">Loading…</div>;
  }

  if (state.status !== 'done') {
    return (
      <div className="panel">
        <h1>Brotomap</h1>
        <p className="muted">
          No roadmap yet. Open the Brotomap popup on your task page and press Generate Roadmap.
        </p>
      </div>
    );
  }

  return (
    <>
      <div className="panel" style={{ maxWidth: 780, margin: '0 auto' }}>
        <div className="no-print" style={{ marginBottom: 16 }}>
          <button type="button" onClick={() => window.print()}>
            Export as PDF
          </button>
          <p className="muted small">
            Opens the print dialog: choose &ldquo;Save as PDF&rdquo;. Turn off headers and footers
            for a clean document.
          </p>
        </div>

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
      </div>
    </>
  );
}
