'use client';

import { createBrowserClient } from '@supabase/ssr';
import { Eye, PenLine } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';

import { publicEnv } from '@/lib/env.public';

/** What one browser tab says about itself on the presence channel: ids and a flag, no words. */
type PresenceState = { conversationId: string; typing: boolean };

export type PresenceSetup = {
  tenantId: string;
  userId: string;
  /** Colleagues' names by user id, to say who is there. */
  members: { userId: string; fullName: string }[];
};

/**
 * Who else has this conversation open, and whether they are typing (ADR-068). Realtime Presence
 * on the business's private channel `social-presence:<tenant>`, which only people with
 * social.view in that business may join (`app.social_presence_allowed`). Each tab announces the
 * conversation's id and a typing flag, nothing more. If the channel cannot be joined, nobody is
 * shown: collision hints are a help, never a lock.
 */
export function useConversationPresence(
  setup: PresenceSetup | null,
  conversationId: string,
  typing: boolean,
): { userId: string; typing: boolean }[] {
  const [others, setOthers] = useState<{ userId: string; typing: boolean }[]>([]);
  const channelRef = useRef<ReturnType<ReturnType<typeof createBrowserClient>['channel']> | null>(
    null,
  );
  const joined = useRef(false);
  const tenantId = setup?.tenantId;
  const userId = setup?.userId;

  useEffect(() => {
    if (!tenantId || !userId) return;
    const supabase = createBrowserClient(publicEnv.supabaseUrl, publicEnv.supabasePublishableKey);
    const channel = supabase.channel(`social-presence:${tenantId}`, {
      config: { private: true, presence: { key: userId } },
    });
    channelRef.current = channel;
    let cancelled = false;
    const read = () => {
      const state = channel.presenceState<PresenceState>();
      const here = new Map<string, boolean>();
      for (const [key, entries] of Object.entries(state)) {
        if (key === userId) continue;
        for (const entry of entries) {
          if (entry.conversationId !== conversationId) continue;
          here.set(key, (here.get(key) ?? false) || Boolean(entry.typing));
        }
      }
      setOthers([...here].map(([id, isTyping]) => ({ userId: id, typing: isTyping })));
    };
    void (async () => {
      await supabase.realtime.setAuth();
      if (cancelled) return;
      channel.on('presence', { event: 'sync' }, read).subscribe(async (status) => {
        if (status === 'SUBSCRIBED') {
          joined.current = true;
          await channel.track({ conversationId, typing: false } satisfies PresenceState);
        } else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || status === 'CLOSED') {
          joined.current = false;
          setOthers([]);
        }
      });
    })();
    return () => {
      cancelled = true;
      joined.current = false;
      channelRef.current = null;
      void supabase.removeChannel(channel);
    };
  }, [tenantId, userId, conversationId]);

  useEffect(() => {
    if (!joined.current || !channelRef.current) return;
    void channelRef.current.track({ conversationId, typing } satisfies PresenceState);
  }, [typing, conversationId]);

  return others;
}

/** "Sam is viewing", "Alex is typing…": shown above the reply box when colleagues are here. */
export function PresenceNote({
  others,
  members,
}: {
  others: { userId: string; typing: boolean }[];
  members: PresenceSetup['members'];
}) {
  if (others.length === 0) return null;
  const nameOf = (id: string) =>
    members.find((member) => member.userId === id)?.fullName ?? 'A colleague';
  const typing = others.filter((other) => other.typing).map((other) => nameOf(other.userId));
  const viewing = others.filter((other) => !other.typing).map((other) => nameOf(other.userId));
  const list = (names: string[]) =>
    names.length <= 2
      ? names.join(' and ')
      : `${names.slice(0, 2).join(', ')} and ${names.length - 2} more`;
  return (
    <p
      role="status"
      className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-lg border border-warning-border bg-warning/10 px-3 py-1.5 text-xs text-warning-text"
    >
      {typing.length > 0 && (
        <span className="flex items-center gap-1">
          <PenLine aria-hidden className="size-3.5" />
          {list(typing)} {typing.length === 1 ? 'is' : 'are'} typing…
        </span>
      )}
      {viewing.length > 0 && (
        <span className="flex items-center gap-1">
          <Eye aria-hidden className="size-3.5" />
          {list(viewing)} {viewing.length === 1 ? 'is' : 'are'} also looking at this
        </span>
      )}
    </p>
  );
}
