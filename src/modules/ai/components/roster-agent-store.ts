'use client';

import type { RosterAgentArtifact, RosterCheck } from '../types';
import type { CardStatus } from './roster-agent-cards';

export type AgentMessage =
  | { id: string; role: 'user'; text: string }
  | { id: string; role: 'agent'; text: string }
  | { id: string; role: 'status'; text: string }
  | { id: string; role: 'error'; text: string }
  | { id: string; role: 'artifact'; artifact: RosterAgentArtifact; status: CardStatus }
  | { id: string; role: 'check'; check: RosterCheck };

/**
 * The roster agent's conversation, kept in this browser tab's session storage per business and
 * period (ADR-079), so it survives a refresh or the roster appearing after a plan is approved.
 * The server never stores it. Read through useSyncExternalStore; snapshots are cached so the same
 * conversation is the same array until it changes.
 */
const EMPTY: AgentMessage[] = [];
const cache = new Map<string, AgentMessage[]>();
const listeners = new Set<() => void>();

function load(key: string): AgentMessage[] {
  try {
    const raw = window.sessionStorage.getItem(key);
    return raw ? (JSON.parse(raw) as AgentMessage[]) : EMPTY;
  } catch {
    return EMPTY;
  }
}

export function getConversation(key: string): AgentMessage[] {
  if (!cache.has(key)) cache.set(key, load(key));
  return cache.get(key)!;
}

export function serverConversation(): AgentMessage[] {
  return EMPTY;
}

export function updateConversation(
  key: string,
  update: (current: AgentMessage[]) => AgentMessage[],
): void {
  const next = update(getConversation(key)).slice(-60);
  cache.set(key, next);
  try {
    if (next.length) window.sessionStorage.setItem(key, JSON.stringify(next));
    else window.sessionStorage.removeItem(key);
  } catch {
    // Storage can be full or blocked; the conversation then lasts only until the page reloads.
  }
  for (const listener of listeners) listener();
}

export function subscribeConversation(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
