import { describePage } from './detector/diagnostics.js';
import { extractTechnicalTask } from './extractor/index.js';
import { detectTechnicalTask } from './detector/index.js';
import type { DetectionResult, ExtensionMessage, ExtractionOutcome } from '../types/index.js';

/**
 * CONTENT SCRIPT — the eyes.
 *
 * The only code that touches the Brototype DOM. Injected on demand by the
 * service worker when the student acts, never running in the background.
 *
 * Phase 3 answers PROBE with real detection. Phase 4 fills in EXTRACT, which
 * is the only message that will be allowed to expand anything on the page.
 *
 * No zod and no React here on purpose: this runs inside someone else's page,
 * so it stays small and, for detection, entirely side-effect free.
 */

declare global {
  interface Window {
    /** Injection guard: executeScript may run this file more than once. */
    __brotomapContentReady?: boolean;
  }
}

function detect(): DetectionResult {
  try {
    return detectTechnicalTask(document);
  } catch (error) {
    return {
      status: 'failed',
      reason: 'extraction-failed',
      message: `Detection failed unexpectedly (${error instanceof Error ? error.message : 'unknown error'}).`,
      candidates: [],
      retryable: true,
    };
  }
}

/**
 * Reads the whole task. Asynchronous because a collapsed topic may have to be
 * opened and waited for - the only part of Brotomap that touches the page.
 */
async function extract(useTechnical: boolean): Promise<ExtractionOutcome> {
  try {
    return await extractTechnicalTask(document, document.location?.href ?? '', { useTechnical });
  } catch (error) {
    return {
      status: 'failed',
      reason: 'extraction-failed',
      message: `Extraction failed unexpectedly (${
        error instanceof Error ? error.message : 'unknown error'
      }).`,
      retryable: true,
    };
  }
}

function handleMessage(
  message: unknown,
  sendResponse: (response: ExtensionMessage) => void,
): boolean {
  if (typeof message !== 'object' || message === null || !('type' in message)) {
    return false;
  }

  const { type } = message as { type: string };

  switch (type) {
    case 'PING':
      sendResponse({ type: 'PONG' });
      return true;

    case 'PROBE':
      sendResponse({ type: 'PROBE_RESULT', result: detect() });
      return true;

    case 'DIAGNOSE':
      sendResponse({ type: 'DIAGNOSTIC', report: describePage(document) });
      return true;

    case 'EXTRACT': {
      const useTechnical = (message as { useTechnical?: boolean }).useTechnical === true;
      // Returning true keeps the channel open until extraction resolves.
      void extract(useTechnical).then((outcome) =>
        sendResponse({ type: 'EXTRACT_RESULT', outcome }),
      );
      return true;
    }

    default:
      return false;
  }
}

if (!window.__brotomapContentReady) {
  window.__brotomapContentReady = true;
  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) =>
    handleMessage(message, sendResponse),
  );
}
