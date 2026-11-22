import 'server-only';

import { findChatWidget, frameAncestorsFor } from './livechat-widget';

/*
 * The Content-Security-Policy of a live chat widget's page (ADR-072), set in proxy.ts: only the
 * sites the business listed may frame it. Looked up once a minute per widget, not per request.
 */

const CACHE_MS = 60_000;
const CACHE_MAX = 500;
const cache = new Map<string, { policy: string; until: number }>();

const BASE = "base-uri 'self'; form-action 'self'; object-src 'none'";

export async function chatFramePolicy(key: string, now = Date.now()): Promise<string> {
  const hit = cache.get(key);
  if (hit && hit.until > now) return hit.policy;
  let ancestors = "'none'";
  try {
    ancestors = frameAncestorsFor(await findChatWidget(key));
  } catch (error) {
    console.error('[livechat] could not look up a widget', {
      name: error instanceof Error ? error.name : typeof error,
    });
    return `frame-ancestors 'none'; ${BASE}`;
  }
  const policy = `frame-ancestors ${ancestors}; ${BASE}`;
  if (cache.size >= CACHE_MAX) cache.delete(cache.keys().next().value!);
  cache.set(key, { policy, until: now + CACHE_MS });
  return policy;
}
