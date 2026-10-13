'use client';

import { RefreshCw } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';

import { Button } from '@/components/ui/button';
import { refreshAwardRatesAction } from '@/modules/hiring/actions';

/** Reads the award's current rates again, so a July increase is caught without a new contract. */
export function AwardRatesRefresh({
  contractId,
  hasRates,
}: {
  contractId: string;
  hasRates: boolean;
}) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const refresh = () =>
    startTransition(async () => {
      setError(null);
      const result = await refreshAwardRatesAction({ id: contractId });
      if (!result.ok) setError(result.error.message);
      else router.refresh();
    });

  return (
    <div className="flex flex-col items-start gap-1.5">
      <Button type="button" variant="outline" size="sm" disabled={isPending} onClick={refresh}>
        <RefreshCw aria-hidden className={isPending ? 'animate-spin' : undefined} />
        {hasRates ? 'Check award rates again' : 'Look up award rates'}
      </Button>
      {error && (
        <p role="alert" className="text-sm text-destructive-text">
          {error}
        </p>
      )}
    </div>
  );
}
