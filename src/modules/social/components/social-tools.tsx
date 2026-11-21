'use client';

import { CheckCheck, Link2, Plug, RotateCcw, Unplug } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState, useTransition } from 'react';

import { NativeSelect } from '@/components/forms/native-select';
import { SearchSelect, type SearchOption } from '@/components/forms/search-select';
import { ErrorNote, useActionRunner } from '@/components/forms/use-action-runner';
import { Button } from '@/components/ui/button';
import { searchContactOptionsAction } from '@/modules/contacts/actions';
import {
  accountSettingsAction,
  disconnectAccountAction,
  linkContactAction,
  markReadAction,
  setConversationStatusAction,
  startConnectAction,
} from '@/modules/social/actions';

/** Sends the browser to Meta or TikTok to log in and choose the accounts to connect. */
export function ConnectButton({
  provider,
  label,
  disabled,
}: {
  provider: 'meta' | 'tiktok';
  label: string;
  disabled?: boolean;
}) {
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  return (
    <div className="flex flex-col gap-2">
      <Button
        disabled={disabled || isPending}
        onClick={() =>
          startTransition(async () => {
            setError(null);
            const result = await startConnectAction({ provider });
            if (!result.ok) return setError(result.error.message);
            window.location.assign(result.data.url);
          })
        }
      >
        <Plug aria-hidden /> {isPending ? 'Opening…' : label}
      </Button>
      <ErrorNote error={error} />
    </div>
  );
}

export function DisconnectButton({ accountId, name }: { accountId: string; name: string }) {
  const { run, error, isPending } = useActionRunner();
  return (
    <div className="flex flex-col items-end gap-2">
      <Button
        variant="outline"
        size="sm"
        disabled={isPending}
        onClick={() => {
          if (
            window.confirm(
              `Disconnect “${name}”? New messages stop arriving here and replies can no longer be sent. The conversations so far stay.`,
            )
          ) {
            run(() => disconnectAccountAction({ accountId }));
          }
        }}
      >
        <Unplug aria-hidden /> Disconnect
      </Button>
      <ErrorNote error={error} />
    </div>
  );
}

async function searchContacts(q: string): Promise<SearchOption[]> {
  const result = await searchContactOptionsAction({ q });
  return result.ok ? result.data : [];
}

/** Says which CRM contact this customer is, so the conversation shows on their record. */
export function ContactLinker({
  conversationId,
  contactId,
  contactName,
  contactLabel,
}: {
  conversationId: string;
  contactId: string | null;
  contactName: string | null;
  contactLabel: string;
}) {
  const { run, error, isPending } = useActionRunner();
  return (
    <div className="flex flex-col gap-2">
      <SearchSelect
        ariaLabel={`Linked ${contactLabel.toLowerCase()}`}
        value={contactId ?? ''}
        selectedLabel={contactName}
        placeholder={`Find a ${contactLabel.toLowerCase()}…`}
        clearable
        disabled={isPending}
        search={searchContacts}
        onChange={(value) =>
          run(() => linkContactAction({ conversationId, contactId: value || null }))
        }
      />
      {contactId && (
        <a
          href={`/contacts/${contactId}`}
          className="flex w-fit items-center gap-1 text-sm text-primary underline-offset-4 hover:underline"
        >
          <Link2 aria-hidden className="size-3.5" /> Open their record
        </a>
      )}
      <ErrorNote error={error} />
    </div>
  );
}

/** Several contacts share the customer's number (ADR-068): a person picks which one it is. */
export function SuggestedContacts({
  conversationId,
  contactLabel,
  suggestions,
}: {
  conversationId: string;
  contactLabel: string;
  suggestions: { id: string; name: string }[];
}) {
  const { run, error, isPending } = useActionRunner();
  return (
    <div className="flex flex-col gap-1.5 rounded-lg border border-dashed p-2 text-sm">
      <p className="text-xs text-muted-foreground">
        More than one {contactLabel.toLowerCase()} has this number. Which one is it?
      </p>
      <ul className="flex flex-col gap-1">
        {suggestions.map((suggestion) => (
          <li key={suggestion.id} className="flex items-center justify-between gap-2">
            <a
              href={`/contacts/${suggestion.id}`}
              className="truncate underline-offset-4 hover:underline"
              data-sensitive
            >
              {suggestion.name}
            </a>
            <Button
              variant="outline"
              size="sm"
              disabled={isPending}
              onClick={() =>
                run(() => linkContactAction({ conversationId, contactId: suggestion.id }))
              }
            >
              <Link2 aria-hidden /> Link
            </Button>
          </li>
        ))}
      </ul>
      <ErrorNote error={error} />
    </div>
  );
}

export function StatusButton({
  conversationId,
  status,
}: {
  conversationId: string;
  status: string;
}) {
  const { run, error, isPending } = useActionRunner();
  const done = status === 'done';
  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap gap-1.5">
        <Button
          variant="outline"
          size="sm"
          disabled={isPending}
          onClick={() =>
            run(() =>
              setConversationStatusAction({ conversationId, status: done ? 'open' : 'done' }),
            )
          }
        >
          {done ? <RotateCcw aria-hidden /> : <CheckCheck aria-hidden />}
          {done ? 'Reopen' : 'Mark done'}
        </Button>
        {status === 'snoozed' && (
          <Button
            variant="outline"
            size="sm"
            disabled={isPending}
            onClick={() =>
              run(() => setConversationStatusAction({ conversationId, status: 'open' }))
            }
          >
            <RotateCcw aria-hidden /> Unsnooze
          </Button>
        )}
      </div>
      <ErrorNote error={error} />
    </div>
  );
}

/** Opening a conversation with unread messages marks it read, once. */
export function MarkRead({ conversationId, unread }: { conversationId: string; unread: number }) {
  const router = useRouter();
  const sent = useRef(false);
  useEffect(() => {
    if (unread === 0 || sent.current) return;
    sent.current = true;
    void markReadAction({ conversationId }).then(() => router.refresh());
  }, [conversationId, unread, router]);
  return null;
}

/**
 * Whether someone who writes to this account and matches no contact becomes a new lead
 * (ADR-068), and with which lead source. Off by default: social accounts draw spam and one-off
 * questions, so the business opts in per account.
 */
export function AccountLeadSetting({
  accountId,
  createLeadForUnknown,
  leadSourceId,
  sources,
  contactLabel,
}: {
  accountId: string;
  createLeadForUnknown: boolean;
  leadSourceId: string | null;
  sources: { id: string; name: string }[];
  contactLabel: string;
}) {
  const { run, error, isPending } = useActionRunner();
  const save = (next: { createLeadForUnknown: boolean; leadSourceId: string | null }) =>
    run(() => accountSettingsAction({ accountId, ...next }));
  return (
    <div className="flex flex-col gap-1.5 text-sm">
      <label className="flex items-center gap-2">
        <input
          type="checkbox"
          className="size-4 accent-primary"
          checked={createLeadForUnknown}
          disabled={isPending}
          onChange={(event) => save({ createLeadForUnknown: event.target.checked, leadSourceId })}
        />
        Make a new lead when someone who is not a {contactLabel.toLowerCase()} writes
      </label>
      {createLeadForUnknown && (
        <label className="flex flex-wrap items-center gap-2 pl-6 text-muted-foreground">
          Lead source
          <NativeSelect
            className="h-8 w-auto min-w-40"
            value={leadSourceId ?? ''}
            disabled={isPending}
            onChange={(event) =>
              save({ createLeadForUnknown, leadSourceId: event.target.value || null })
            }
          >
            <option value="">None</option>
            {sources.map((source) => (
              <option key={source.id} value={source.id}>
                {source.name}
              </option>
            ))}
          </NativeSelect>
        </label>
      )}
      <ErrorNote error={error} />
    </div>
  );
}
