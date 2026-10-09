'use client';

import Link from 'next/link';

import { Button } from '@/components/ui/button';

/**
 * Shown when a page in the workspace cannot be opened: most often because the person lacks the
 * permission, or the feature is not switched on for their business. The reason is deliberately
 * not spelled out, since error details are not sent to the browser.
 */
export default function WorkspaceError({ reset }: { error: Error; reset: () => void }) {
  return (
    <div className="mx-auto flex max-w-md flex-col items-center gap-3 py-20 text-center">
      <h1 className="text-xl font-semibold">This page isn’t available</h1>
      <p className="text-sm text-muted-foreground">
        It may not be part of your workspace, or you may not have access to it. If you think you
        should, ask your workspace admin.
      </p>
      <div className="mt-2 flex gap-2">
        <Button asChild>
          <Link href="/dashboard">Back to the dashboard</Link>
        </Button>
        <Button variant="outline" onClick={reset}>
          Try again
        </Button>
      </div>
    </div>
  );
}
