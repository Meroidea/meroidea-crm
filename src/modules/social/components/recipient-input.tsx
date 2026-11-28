'use client';

import { X } from 'lucide-react';
import { useState } from 'react';

import { cn } from '@/lib/utils';

/** A plain check for the field; the server checks every address again with Zod. */
export const looksLikeEmail = (value: string) =>
  /^[^\s@<>(),;:"]+@[^\s@<>(),;:"]+\.[a-z]{2,}$/i.test(value);

/** "Kim <kim@example.com>; lee@example.com" → ["kim@example.com", "lee@example.com"]. */
export function splitAddresses(text: string): string[] {
  return text
    .split(/[,;\n]+/)
    .map((part) => {
      const angled = /<([^<>]+)>/.exec(part);
      return (angled ? angled[1]! : part).trim().toLowerCase();
    })
    .filter(Boolean);
}

/**
 * The To, Cc or Bcc line of Compose (ADR-090): addresses become chips when Enter, a comma, a
 * semicolon or Tab is pressed, when the field is left, or when several are pasted at once. One
 * that is not an email address is shown in red and stops the email being sent.
 */
export function RecipientInput({
  id,
  label,
  value,
  onChange,
  disabled,
  autoFocus,
  action,
}: {
  id: string;
  label: string;
  value: string[];
  onChange: (next: string[]) => void;
  disabled?: boolean;
  autoFocus?: boolean;
  /** Shown at the end of the line, e.g. the Cc and Bcc switches. */
  action?: React.ReactNode;
}) {
  const [draft, setDraft] = useState('');

  const commit = (text: string) => {
    const added = splitAddresses(text).filter((address) => !value.includes(address));
    if (added.length > 0) onChange([...value, ...added]);
    setDraft('');
  };

  return (
    <div className="flex items-start gap-2 border-b px-3 py-1.5">
      <label htmlFor={id} className="w-12 shrink-0 pt-1.5 text-sm text-muted-foreground">
        {label}
      </label>
      <div className="flex min-w-0 flex-1 flex-wrap items-center gap-1">
        {value.map((address) => {
          const valid = looksLikeEmail(address);
          return (
            <span
              key={address}
              data-sensitive
              className={cn(
                'inline-flex max-w-full items-center gap-1 rounded-full border px-2 py-0.5 text-sm',
                valid ? 'bg-muted' : 'border-destructive bg-destructive/10 text-destructive-text',
              )}
              title={valid ? address : `${address} is not an email address`}
            >
              <span className="truncate">{address}</span>
              <button
                type="button"
                className="rounded-full p-0.5 hover:bg-background"
                aria-label={`Remove ${address}`}
                disabled={disabled}
                onClick={() => onChange(value.filter((item) => item !== address))}
              >
                <X aria-hidden className="size-3" />
              </button>
            </span>
          );
        })}
        <input
          id={id}
          type="email"
          multiple
          autoComplete="email"
          inputMode="email"
          autoFocus={autoFocus}
          disabled={disabled}
          className="h-8 min-w-40 flex-1 bg-transparent text-sm outline-none"
          value={draft}
          onChange={(event) => {
            const next = event.target.value;
            if (/[,;]/.test(next)) commit(next);
            else setDraft(next);
          }}
          onKeyDown={(event) => {
            if (event.key === 'Enter' || (event.key === 'Tab' && draft.trim())) {
              if (draft.trim()) {
                event.preventDefault();
                commit(draft);
              }
            } else if (event.key === 'Backspace' && !draft && value.length > 0) {
              onChange(value.slice(0, -1));
            }
          }}
          onPaste={(event) => {
            const text = event.clipboardData.getData('text/plain');
            if (/[,;\n]/.test(text)) {
              event.preventDefault();
              commit(`${draft},${text}`);
            }
          }}
          onBlur={() => draft.trim() && commit(draft)}
        />
      </div>
      {action}
    </div>
  );
}
