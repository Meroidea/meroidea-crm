'use client';

import { X } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';

import { cn } from '@/lib/utils';
import { suggestAddressesAction } from '@/modules/social/actions';

type Suggestion = { name: string; email: string };

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
 * that is not an email address is shown in red and stops the email being sent. Contacts the
 * person may see are suggested as they type (ADR-091).
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
  // Each answer is kept with the words it was for, and shown only while they are still typed.
  const [found, setFound] = useState<{ term: string; items: Suggestion[] }>({
    term: '',
    items: [],
  });
  const [dismissed, setDismissed] = useState('');
  const [highlight, setHighlight] = useState(0);
  const asked = useRef(0);
  const term = draft.trim();
  const suggestions =
    found.term === term && dismissed !== term
      ? found.items.filter((item) => !value.includes(item.email))
      : [];

  const commit = (text: string) => {
    const added = splitAddresses(text).filter((address) => !value.includes(address));
    if (added.length > 0) onChange([...value, ...added]);
    setDraft('');
  };

  // Contacts matching what is typed, a moment after typing stops; only the latest answer counts.
  useEffect(() => {
    if (term.length < 2 || /[,;]/.test(term)) return;
    const ask = ++asked.current;
    const timer = setTimeout(async () => {
      const result = await suggestAddressesAction({ q: term });
      if (ask !== asked.current) return;
      setFound({ term, items: result.ok ? result.data : [] });
      setHighlight(0);
    }, 200);
    return () => clearTimeout(timer);
  }, [term]);

  const listId = `${id}-suggestions`;
  const open = suggestions.length > 0;

  return (
    <div className="flex items-start gap-2 border-b px-3 py-1.5">
      <label htmlFor={id} className="w-12 shrink-0 pt-1.5 text-sm text-muted-foreground">
        {label}
      </label>
      <div className="relative flex min-w-0 flex-1 flex-wrap items-center gap-1">
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
          role="combobox"
          aria-expanded={open}
          aria-controls={listId}
          aria-autocomplete="list"
          aria-activedescendant={open ? `${listId}-${highlight}` : undefined}
          value={draft}
          onChange={(event) => {
            const next = event.target.value;
            if (/[,;]/.test(next)) commit(next);
            else setDraft(next);
          }}
          onKeyDown={(event) => {
            if (open && (event.key === 'ArrowDown' || event.key === 'ArrowUp')) {
              event.preventDefault();
              const step = event.key === 'ArrowDown' ? 1 : -1;
              setHighlight((current) => (current + step + suggestions.length) % suggestions.length);
              return;
            }
            if (open && event.key === 'Escape') {
              event.preventDefault();
              setDismissed(term);
              return;
            }
            if (open && (event.key === 'Enter' || event.key === 'Tab')) {
              event.preventDefault();
              commit(suggestions[highlight]!.email);
              return;
            }
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
        {open && (
          <ul
            id={listId}
            role="listbox"
            aria-label={`Suggestions for ${label}`}
            className="absolute top-full left-0 z-30 mt-1 w-full max-w-sm overflow-hidden rounded-lg border bg-popover py-1 shadow-md"
          >
            {suggestions.map((item, index) => (
              <li
                key={item.email}
                id={`${listId}-${index}`}
                role="option"
                aria-selected={index === highlight}
                className={cn(
                  'cursor-pointer px-3 py-1.5 text-sm',
                  index === highlight && 'bg-accent',
                )}
                // Chosen before the field's blur would commit what was typed instead.
                onMouseDown={(event) => {
                  event.preventDefault();
                  commit(item.email);
                }}
                onMouseEnter={() => setHighlight(index)}
              >
                <span className="block truncate font-medium" data-sensitive>
                  {item.name || item.email}
                </span>
                {item.name && (
                  <span className="block truncate text-xs text-muted-foreground" data-sensitive>
                    {item.email}
                  </span>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>
      {action}
    </div>
  );
}
