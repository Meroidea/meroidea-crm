'use client';

import { Check, ChevronsUpDown, Loader2, X } from 'lucide-react';
import { useId, useRef, useState, type KeyboardEvent } from 'react';

import { cn } from '@/lib/utils';

export type SearchOption = { value: string; label: string; hint?: string | null };

/**
 * A select whose options are searched on the server as you type, for lists too long to send to
 * the browser whole (contacts, organizations). Behaves as an ARIA combobox: type to search,
 * arrow keys to move, Enter to choose, Escape to close.
 */
export function SearchSelect({
  id,
  value,
  selectedLabel,
  onChange,
  search,
  placeholder = 'Search…',
  clearable = false,
  exclude = [],
  disabled,
  invalid,
  describedBy,
  ariaLabel,
}: {
  id?: string;
  value: string;
  /** The label of the current value, so it shows before any search has run. */
  selectedLabel?: string | null;
  onChange: (value: string, option: SearchOption | null) => void;
  search: (query: string) => Promise<SearchOption[]>;
  placeholder?: string;
  /** Offers a way back to no choice (for optional fields). */
  clearable?: boolean;
  /** Options never to offer, such as the record itself. */
  exclude?: string[];
  disabled?: boolean;
  invalid?: boolean;
  describedBy?: string;
  ariaLabel?: string;
}) {
  const generated = useId();
  const inputId = id ?? `${generated}-input`;
  const listId = `${generated}-list`;
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [options, setOptions] = useState<SearchOption[]>([]);
  const [active, setActive] = useState(0);
  const [loading, setLoading] = useState(false);
  // The label of what was picked here; for any other value (the starting one, or after the
  // form resets it) the caller's selectedLabel is shown.
  const [picked, setPicked] = useState<SearchOption | null>(null);
  const label = !value ? '' : picked?.value === value ? picked.label : (selectedLabel ?? '');
  const request = useRef(0);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Searches a moment after the person pauses; only the latest answer is shown.
  const runSearch = (text: string) => {
    if (timer.current) clearTimeout(timer.current);
    const ticket = ++request.current;
    setLoading(true);
    timer.current = setTimeout(async () => {
      const found = await search(text).catch(() => []);
      if (ticket !== request.current) return;
      setOptions(found.filter((option) => !exclude.includes(option.value)));
      setActive(0);
      setLoading(false);
    }, 200);
  };

  const openList = () => {
    if (open) return;
    setOpen(true);
    runSearch(query);
  };

  const choose = (option: SearchOption | null) => {
    onChange(option?.value ?? '', option);
    setPicked(option);
    setQuery('');
    setOpen(false);
  };

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      if (!open) openList();
      else setActive((index) => Math.min(index + 1, options.length - 1));
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      setActive((index) => Math.max(index - 1, 0));
    } else if (event.key === 'Enter' && open) {
      event.preventDefault();
      const option = options[active];
      if (option) choose(option);
    } else if (event.key === 'Escape' && open) {
      event.preventDefault();
      setQuery('');
      setOpen(false);
    }
  };

  const activeId = open && options[active] ? `${listId}-${active}` : undefined;

  return (
    <div className="relative">
      <input
        id={inputId}
        type="text"
        role="combobox"
        aria-expanded={open}
        aria-controls={listId}
        aria-autocomplete="list"
        aria-activedescendant={activeId}
        aria-invalid={invalid || undefined}
        aria-describedby={describedBy}
        aria-label={ariaLabel}
        autoComplete="off"
        disabled={disabled}
        placeholder={label || placeholder}
        value={open ? query : label}
        onFocus={openList}
        onClick={openList}
        onBlur={() => {
          setQuery('');
          setOpen(false);
        }}
        onChange={(event) => {
          setQuery(event.target.value);
          setOpen(true);
          runSearch(event.target.value);
        }}
        onKeyDown={onKeyDown}
        className={cn(
          'h-9 w-full rounded-md border border-input bg-card pr-14 pl-3 text-sm text-ellipsis shadow-xs transition-[color,box-shadow] outline-none placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:opacity-50 aria-invalid:border-destructive',
          open && label && 'placeholder:text-foreground/70',
        )}
      />
      <span className="pointer-events-none absolute inset-y-0 right-2 flex items-center gap-1 text-muted-foreground">
        {loading && open ? (
          <Loader2 aria-hidden className="size-4 animate-spin" />
        ) : (
          <ChevronsUpDown aria-hidden className="size-4" />
        )}
      </span>
      {clearable && value && !disabled && (
        <button
          type="button"
          aria-label="Clear"
          // Runs before the input's blur, so the click lands.
          onMouseDown={(event) => event.preventDefault()}
          onClick={() => choose(null)}
          className="absolute inset-y-0 right-7 flex items-center px-1 text-muted-foreground hover:text-foreground"
        >
          <X aria-hidden className="size-3.5" />
        </button>
      )}
      {open && (
        <ul
          id={listId}
          role="listbox"
          className="absolute z-50 mt-1 max-h-64 w-full overflow-auto rounded-md border bg-popover p-1 text-sm shadow-md"
        >
          {!loading && options.length === 0 && (
            <li className="px-2 py-1.5 text-muted-foreground" role="presentation">
              {query ? 'Nothing matches.' : 'Type to search.'}
            </li>
          )}
          {options.map((option, index) => (
            <li
              key={option.value}
              id={`${listId}-${index}`}
              role="option"
              aria-selected={option.value === value}
              onMouseDown={(event) => event.preventDefault()}
              onMouseEnter={() => setActive(index)}
              onClick={() => choose(option)}
              className={cn(
                'flex cursor-pointer items-center gap-2 rounded-sm px-2 py-1.5',
                index === active && 'bg-accent',
              )}
            >
              <Check
                aria-hidden
                className={cn(
                  'size-4 shrink-0',
                  option.value === value ? 'opacity-100' : 'opacity-0',
                )}
              />
              <span className="min-w-0 flex-1 truncate">{option.label}</span>
              {option.hint && (
                <span className="truncate text-xs text-muted-foreground">{option.hint}</span>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
