'use client';

import { createBrowserClient } from '@supabase/ssr';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';

import { publicEnv } from '@/lib/env.public';
import { cn } from '@/lib/utils';

/**
 * Live updates for the social inbox (ADR-065). The browser joins the business's private
 * Realtime channel `social:<tenant>`; the database announces each change there with nothing but
 * the conversation's id, and the page then reloads its data through the ordinary permission-
 * checked queries. Who may join is decided by the `social_inbox_receive` policy (social.view in
 * that business). If the channel cannot be joined, the page refreshes every 30 seconds instead.
 */
export function InboxRealtime({ tenantId }: { tenantId: string }) {
  const router = useRouter();
  const [live, setLive] = useState(false);

  useEffect(() => {
    const supabase = createBrowserClient(publicEnv.supabaseUrl, publicEnv.supabasePublishableKey);
    let timer: ReturnType<typeof setTimeout> | undefined;
    let fallback: ReturnType<typeof setInterval> | undefined;
    let cancelled = false;
    // A burst of changes (a message, its conversation, its media) becomes one refresh.
    const refresh = () => {
      clearTimeout(timer);
      timer = setTimeout(() => router.refresh(), 250);
    };
    const startFallback = () => {
      if (fallback) return;
      fallback = setInterval(() => {
        if (document.visibilityState === 'visible') router.refresh();
      }, 30_000);
    };
    const stopFallback = () => {
      clearInterval(fallback);
      fallback = undefined;
    };

    const channel = supabase.channel(`social:${tenantId}`, { config: { private: true } });
    void (async () => {
      // Realtime Authorization reads the person's own access token from their session.
      await supabase.realtime.setAuth();
      if (cancelled) return;
      channel.on('broadcast', { event: 'changed' }, refresh).subscribe((status) => {
        if (status === 'SUBSCRIBED') {
          setLive(true);
          stopFallback();
          // Anything that happened while connecting.
          refresh();
        } else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || status === 'CLOSED') {
          setLive(false);
          startFallback();
        }
      });
    })();
    // Until the channel says it is subscribed, keep the page fresh the old way.
    startFallback();
    // Coming back to the tab catches up at once.
    const onVisible = () => {
      if (document.visibilityState === 'visible') refresh();
    };
    document.addEventListener('visibilitychange', onVisible);

    return () => {
      cancelled = true;
      clearTimeout(timer);
      stopFallback();
      document.removeEventListener('visibilitychange', onVisible);
      void supabase.removeChannel(channel);
    };
  }, [router, tenantId]);

  return (
    <span
      className="flex items-center gap-1.5 text-xs text-muted-foreground"
      title={live ? 'New messages appear instantly' : 'Checking for new messages every 30 seconds'}
    >
      <span
        aria-hidden
        className={cn('size-2 rounded-full', live ? 'bg-chart-2' : 'bg-muted-foreground/40')}
      />
      {live ? 'Live' : 'Connecting…'}
    </span>
  );
}
