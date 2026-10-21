'use client';

import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';

import { NativeSelect } from '@/components/forms/native-select';
import { setEnquiryStatusAction } from '@/modules/enquiries/actions';
import { ENQUIRY_STATUSES, type EnquiryStatus } from '@/modules/enquiries/schemas';

const LABELS: Record<EnquiryStatus, string> = {
  new: 'New',
  contacted: 'Contacted',
  closed: 'Closed',
};

export function EnquiryStatusSelect({ id, status }: { id: string; status: EnquiryStatus }) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  return (
    <div className="flex flex-col items-end gap-1">
      <NativeSelect
        aria-label="Status"
        value={status}
        disabled={isPending}
        className="h-8 w-36"
        onChange={(event) => {
          const next = event.target.value as EnquiryStatus;
          startTransition(async () => {
            setError(null);
            const result = await setEnquiryStatusAction({ id, status: next });
            if (!result.ok) setError(result.error.message);
            router.refresh();
          });
        }}
      >
        {ENQUIRY_STATUSES.map((value) => (
          <option key={value} value={value}>
            {LABELS[value]}
          </option>
        ))}
      </NativeSelect>
      {error && (
        <p role="alert" className="text-xs text-destructive-text">
          {error}
        </p>
      )}
    </div>
  );
}
