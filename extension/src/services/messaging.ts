import { extensionMessageSchema, type ExtensionMessage } from '../types/index.js';

/** Port name the roadmap tab uses to register itself with the service worker. */
export const ROADMAP_PORT = 'brotomap:roadmap-tab';

/**
 * Typed wrapper around chrome.runtime messaging.
 *
 * Three things it buys us:
 *  - the request is a member of the shared union, so a typo will not compile
 *  - the reply is validated before any UI trusts it
 *  - a closed port resolves to null instead of raising an unhandled rejection.
 *    Chrome rejects the promise when a listener handles a message without
 *    replying, and a fire-and-forget call would otherwise log a console error
 *    the student can see.
 */
export async function sendToWorker(message: ExtensionMessage): Promise<ExtensionMessage | null> {
  try {
    const reply: unknown = await chrome.runtime.sendMessage(message);
    const parsed = extensionMessageSchema.safeParse(reply);
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

/** True when running inside the extension (guards a page opened outside Chrome). */
export function isExtensionContext(): boolean {
  return typeof chrome !== 'undefined' && typeof chrome.runtime?.id === 'string';
}
