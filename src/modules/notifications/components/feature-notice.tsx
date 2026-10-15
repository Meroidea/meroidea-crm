'use client';

import { Sparkles } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useTransition } from 'react';

import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { markNotificationReadAction } from '@/modules/notifications/actions';

/** Tells a business's Admin which features were switched on, until they act on it or dismiss it. */
export function FeatureNotice({
  notices,
}: {
  notices: { id: string; title: string; body: string | null; url: string | null }[];
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const latest = notices[0];
  if (!latest) return null;
  const next = latest.url?.startsWith('/') ? latest.url : null;

  const close = (then: string | null) =>
    startTransition(async () => {
      await Promise.all(notices.map((notice) => markNotificationReadAction({ id: notice.id })));
      if (then) router.push(then);
      else router.refresh();
    });

  return (
    <Card className="border-primary/20 bg-gradient-to-br from-accent to-card" role="status">
      <CardHeader>
        <CardTitle className="flex items-start gap-2">
          <Sparkles aria-hidden className="mt-0.5 size-4 shrink-0 text-primary" />
          <span className="flex flex-col gap-1">
            {notices.map((notice) => (
              <span key={notice.id}>{notice.title}</span>
            ))}
          </span>
        </CardTitle>
        {latest.body && <CardDescription>{latest.body}</CardDescription>}
      </CardHeader>
      <CardContent className="flex flex-wrap gap-2">
        {next && (
          <Button disabled={isPending} onClick={() => close(next)}>
            Review role access
          </Button>
        )}
        <Button variant="ghost" disabled={isPending} onClick={() => close(null)}>
          Dismiss
        </Button>
      </CardContent>
    </Card>
  );
}
