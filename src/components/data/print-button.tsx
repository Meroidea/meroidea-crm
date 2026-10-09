'use client';

import { Printer } from 'lucide-react';

import { Button } from '@/components/ui/button';

/** Opens the browser's print dialog, which also offers "Save as PDF". */
export function PrintButton({ label = 'Print or save as PDF' }: { label?: string }) {
  return (
    <Button variant="outline" className="no-print" onClick={() => window.print()}>
      <Printer aria-hidden /> {label}
    </Button>
  );
}
