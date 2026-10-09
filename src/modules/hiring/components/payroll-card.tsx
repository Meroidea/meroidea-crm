'use client';

import { Eye, EyeOff } from 'lucide-react';
import { useState, useTransition } from 'react';

import { Button } from '@/components/ui/button';
import { revealPayrollDetailsAction } from '@/modules/hiring/actions';
import type { PayrollSummary, RevealedPayroll } from '@/modules/hiring/types';

/** Shows only a summary until someone asks to see the numbers; each reveal is audited. */
export function PayrollCard({
  employeeId,
  summary,
}: {
  employeeId: string;
  summary: PayrollSummary;
}) {
  const [revealed, setRevealed] = useState<RevealedPayroll | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const reveal = () =>
    startTransition(async () => {
      setError(null);
      const result = await revealPayrollDetailsAction({ id: employeeId });
      if (!result.ok) return setError(result.error.message);
      setRevealed(result.data);
    });

  const rows: [string, string][] = [
    [
      'Tax file number',
      revealed
        ? (revealed.taxFileNumber ?? 'Not provided')
        : summary.hasTaxFileNumber
          ? '•••••••••'
          : 'Not provided',
    ],
    ['Account name', summary.bankAccountName ?? '—'],
    ['BSB', revealed ? (revealed.bankBsb ?? '—') : '••••••'],
    [
      'Account number',
      revealed ? (revealed.bankAccount ?? '—') : `•••••${summary.bankAccountLast3 ?? ''}`,
    ],
    ['Super fund', summary.superFundName ?? '—'],
    ['Super member number', revealed ? (revealed.superMemberNumber ?? '—') : '••••••'],
  ];

  return (
    <div className="flex flex-col gap-3">
      <dl className="grid gap-x-6 gap-y-2 text-sm sm:grid-cols-2">
        {rows.map(([label, value]) => (
          <div key={label} className="flex justify-between gap-3 border-b py-1.5">
            <dt className="text-muted-foreground">{label}</dt>
            <dd className="font-medium tabular-nums" data-sensitive>
              {value}
            </dd>
          </div>
        ))}
      </dl>
      <div className="flex items-center gap-3">
        {revealed ? (
          <Button variant="outline" onClick={() => setRevealed(null)}>
            <EyeOff aria-hidden /> Hide numbers
          </Button>
        ) : (
          <Button variant="outline" onClick={reveal} disabled={isPending}>
            <Eye aria-hidden /> Show numbers
          </Button>
        )}
        <p className="text-xs text-muted-foreground">
          Each time the numbers are shown is recorded in the audit log.
        </p>
      </div>
      {error && (
        <p role="alert" className="text-sm text-destructive-text">
          {error}
        </p>
      )}
    </div>
  );
}
