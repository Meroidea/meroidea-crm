'use client';

import { Check } from 'lucide-react';

import { cn } from '@/lib/utils';

import { PdfPages } from './pdf-pages';

/** The original as sent, with each signer's fields outlined in their colour; read only. */
export function PreviewWithFields({
  requestId,
  fields,
}: {
  requestId: string;
  fields: {
    id: string;
    page: number;
    x: number;
    y: number;
    width: number;
    height: number;
    colour: string;
    label: string;
    filled: boolean;
  }[];
}) {
  return (
    <PdfPages
      url={`/api/esign/requests/${requestId}/document`}
      overlay={(page) =>
        fields
          .filter((field) => field.page === page)
          .map((field) => (
            <span
              key={field.id}
              className={cn(
                'absolute flex items-center gap-1 overflow-hidden rounded-sm border-2 px-1 text-[10px] leading-none font-medium',
                field.colour,
              )}
              style={{
                left: `${field.x * 100}%`,
                top: `${field.y * 100}%`,
                width: `${field.width * 100}%`,
                height: `${field.height * 100}%`,
              }}
              title={field.filled ? `${field.label}: filled` : field.label}
            >
              {field.filled && <Check aria-label="Filled" className="size-3 shrink-0" />}
              <span className="truncate">{field.label}</span>
            </span>
          ))
      }
    />
  );
}
