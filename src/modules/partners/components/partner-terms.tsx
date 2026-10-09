'use client';

import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';

import { NativeSelect } from '@/components/forms/native-select';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { updatePartnerAction } from '@/modules/partners/actions';
import { PARTNER_STATUS_LABELS, PARTNER_STATUSES } from '@/modules/partners/schemas';

type Terms = {
  id: string;
  status: (typeof PARTNER_STATUSES)[number];
  commissionType: 'none' | 'percentage' | 'fixed';
  commissionValue: string;
  notes: string;
};

export function PartnerTerms({ initial }: { initial: Terms }) {
  const router = useRouter();
  const [terms, setTerms] = useState(initial);
  const [message, setMessage] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  return (
    <form
      className="grid gap-4 sm:grid-cols-2"
      onSubmit={(event) => {
        event.preventDefault();
        startTransition(async () => {
          const result = await updatePartnerAction(terms);
          setMessage(result.ok ? 'Saved.' : result.error.message);
          if (result.ok) router.refresh();
        });
      }}
    >
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="status">Status</Label>
        <NativeSelect
          id="status"
          value={terms.status}
          onChange={(e) => setTerms({ ...terms, status: e.target.value as Terms['status'] })}
        >
          {PARTNER_STATUSES.map((status) => (
            <option key={status} value={status}>
              {PARTNER_STATUS_LABELS[status]}
            </option>
          ))}
        </NativeSelect>
      </div>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="commissionType">Commission</Label>
        <NativeSelect
          id="commissionType"
          value={terms.commissionType}
          onChange={(e) =>
            setTerms({ ...terms, commissionType: e.target.value as Terms['commissionType'] })
          }
        >
          <option value="none">None</option>
          <option value="percentage">Percentage</option>
          <option value="fixed">Fixed per win</option>
        </NativeSelect>
      </div>
      {terms.commissionType !== 'none' && (
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="commissionValue">
            {terms.commissionType === 'percentage' ? 'Percent' : 'Amount'}
          </Label>
          <Input
            id="commissionValue"
            inputMode="decimal"
            value={terms.commissionValue}
            onChange={(e) => setTerms({ ...terms, commissionValue: e.target.value })}
          />
        </div>
      )}
      <div className="flex flex-col gap-1.5 sm:col-span-2">
        <Label htmlFor="notes">Notes</Label>
        <Textarea
          id="notes"
          rows={3}
          value={terms.notes}
          onChange={(e) => setTerms({ ...terms, notes: e.target.value })}
        />
      </div>
      <div className="flex items-center gap-3 sm:col-span-2">
        <Button type="submit" disabled={isPending}>
          {isPending ? 'Saving…' : 'Save terms'}
        </Button>
        {message && (
          <p role="status" className="text-sm text-muted-foreground">
            {message}
          </p>
        )}
      </div>
    </form>
  );
}
