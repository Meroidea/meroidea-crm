'use client';

import { ArrowUp, Paperclip, RotateCcw, X } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState, useSyncExternalStore, useTransition } from 'react';

import { NativeSelect } from '@/components/forms/native-select';
import { MeroOrb } from '@/components/motion/mero-orb';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { addDaysToDate } from '@/lib/dates';
import { formatCalendarDate } from '@/lib/format';
import { cn } from '@/lib/utils';
import {
  createRosterAction,
  reassignShiftAction,
  removeShiftsAction,
} from '@/modules/roster/actions';
import type { TeamColor } from '@/modules/roster/rules';

import {
  applyVacantFillAction,
  approveRosterAction,
  buildRosterWithAgentAction,
  chatAboutRosterAction,
  checkRosterAction,
} from '../actions';
import { ATTACHMENT_ACCEPT } from '../attachments';
import type { RosterAgentSetup } from '../roster-agent';
import { ROSTER_STRATEGY_TEXT } from '../types';
import { useRosterAgent } from './roster-agent-layout';
import {
  getConversation,
  serverConversation,
  subscribeConversation,
  updateConversation,
  type AgentMessage,
} from './roster-agent-store';
import {
  ChangeCard,
  CheckCard,
  FillCard,
  PlanCard,
  RemoveCard,
  type CardStatus,
} from './roster-agent-cards';

type Message = AgentMessage;

type Priority = 'even_hours' | 'lowest_cost' | 'most_productive';

const EXAMPLES = [
  'Sam can’t work Friday or Saturday',
  'Keep wages to a minimum',
  'Put my most experienced people on first',
  'Only roster Priya, Alex and Jordan',
];

const newId = () => Math.random().toString(36).slice(2);

/**
 * MeroAI's roster agent (ADR-079): a panel beside the roster. It starts from a short form (how to
 * start, contracted hours, staff numbers, replace what is there, notes and a file), shows its plan,
 * applies it when the manager approves, checks the result, and then takes follow-ups in words.
 * Every change it proposes waits for the manager's click; staff see nothing until they publish.
 */
export function RosterAgent({
  storageKey,
  startsOn,
  span,
  rosterId,
  existingShifts,
  setup,
  teamColors,
  canChat,
  canEditSettings,
  variant,
}: {
  /** Per business and period, so a conversation never follows the person elsewhere. */
  storageKey: string;
  startsOn: string;
  span: 'week' | 'fortnight';
  /** Null on a week with no roster yet: approving creates it. */
  rosterId: string | null;
  existingShifts: number;
  setup: RosterAgentSetup;
  teamColors: Record<string, TeamColor>;
  /** A model is set up: notes, files and chat need one; the plan itself does not. */
  canChat: boolean;
  canEditSettings: boolean;
  variant: 'panel' | 'card';
}) {
  const router = useRouter();
  const agent = useRosterAgent();
  const messages = useSyncExternalStore(
    subscribeConversation,
    () => getConversation(storageKey),
    serverConversation,
  );
  const setMessages = (update: Message[] | ((current: Message[]) => Message[])) =>
    updateConversation(storageKey, typeof update === 'function' ? update : () => update);
  const [pending, startTransition] = useTransition();
  const cancelled = useRef(false);
  const bottom = useRef<HTMLDivElement>(null);

  const [start, setStart] = useState<'figure_out' | 'saved'>('figure_out');
  const [copyRosterId, setCopyRosterId] = useState(setup.earlierRosters[0]?.id ?? '');
  const [priority, setPriority] = useState<Priority>('even_hours');
  const [contractedFirst, setContractedFirst] = useState(setup.contracted.available);
  const [useStaffCounts, setUseStaffCounts] = useState(false);
  const [replaceExisting, setReplaceExisting] = useState(false);
  const [instructions, setInstructions] = useState('');
  const [showExamples, setShowExamples] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [prompt, setPrompt] = useState('');
  const fileInput = useRef<HTMLInputElement>(null);
  const endsOn = addDaysToDate(startsOn, (span === 'fortnight' ? 14 : 7) - 1);

  useEffect(() => {
    bottom.current?.scrollIntoView({ block: 'end', behavior: 'smooth' });
  }, [messages.length, pending]);

  const push = (...items: Message[]) => setMessages((current) => [...current, ...items]);
  const setStatus = (id: string, status: CardStatus) =>
    setMessages((current) =>
      current.map((item) =>
        item.id === id && item.role === 'artifact' ? { ...item, status } : item,
      ),
    );

  const runCheck = async (id: string | null) => {
    if (!id) return;
    push({ id: newId(), role: 'status', text: 'Checking the roster…' });
    const result = await checkRosterAction({ rosterId: id });
    if (result.ok) push({ id: newId(), role: 'check', check: result.data });
  };

  const build = () =>
    startTransition(async () => {
      cancelled.current = false;
      setFormError(null);
      const chosen = setup.earlierRosters.find((roster) => roster.id === copyRosterId);
      const summary = [
        start === 'saved' && chosen
          ? `Copy my roster for ${formatCalendarDate(chosen.startsOn)} to ${formatCalendarDate(chosen.endsOn)}`
          : useStaffCounts
            ? 'Cover my trading hours with the staff numbers I set'
            : 'Figure it out from my last 4 weeks',
        priority !== 'even_hours' ? ROSTER_STRATEGY_TEXT[priority].title.toLowerCase() : null,
        contractedFirst ? 'contracted hours first' : null,
        replaceExisting ? 'delete existing shifts first' : null,
      ]
        .filter(Boolean)
        .join(' · ');
      push({
        id: newId(),
        role: 'user',
        text: [summary, instructions.trim(), file ? `Attached: ${file.name}` : '']
          .filter(Boolean)
          .join('\n'),
      });
      const result = await buildRosterWithAgentAction({
        startsOn,
        span,
        start,
        copyRosterId: start === 'saved' ? copyRosterId || undefined : undefined,
        priority,
        contractedFirst,
        useStaffCounts,
        replaceExisting,
        instructions: instructions.trim() || undefined,
        ...(file ? { file } : {}),
      });
      if (cancelled.current) return;
      if (!result.ok) {
        push({ id: newId(), role: 'error', text: result.error.message });
        return;
      }
      push(
        { id: newId(), role: 'agent', text: result.data.reply },
        { id: newId(), role: 'artifact', artifact: result.data.artifact, status: 'open' },
      );
      setInstructions('');
      setFile(null);
    });

  const approve = (message: Extract<Message, { role: 'artifact' }>) =>
    startTransition(async () => {
      cancelled.current = false;
      setStatus(message.id, 'applying');
      const { artifact } = message;
      let targetRoster = rosterId;
      let failure: string | null = null;
      if (artifact.kind === 'roster_preview') {
        if (!targetRoster) {
          // A week with no roster: create it for the whole period first, so the roster starts on
          // the day the manager is looking at even when that day has no shifts.
          const created = await createRosterAction({ startsOn, span, copyPrevious: false });
          if (created.ok) targetRoster = created.data.id;
        }
        push({
          id: newId(),
          role: 'status',
          text: `Applying ${artifact.shifts.length} shifts${artifact.replaces?.length ? ` and removing ${artifact.replaces.length}` : ''}…`,
        });
        const result = await approveRosterAction({
          shifts: artifact.shifts.map((shift) => ({
            date: shift.date,
            startTime: shift.startTime,
            endTime: shift.endTime,
            userId: shift.userId,
            teamId: shift.teamId,
            breaks: shift.breaks,
            note: shift.note,
          })),
          replaceShiftIds: artifact.replaces ?? [],
        });
        if (!result.ok) failure = result.error.message;
        else {
          targetRoster ??= result.data.rosterIds[0] ?? null;
          push({
            id: newId(),
            role: 'agent',
            text: [
              `Added ${result.data.saved} shift${result.data.saved === 1 ? '' : 's'} as unpublished changes${result.data.removed ? ` and removed ${result.data.removed}` : ''}.`,
              result.data.skipped.length
                ? `${result.data.skipped.length} could not be added: ${result.data.skipped
                    .slice(0, 3)
                    .map(
                      (item) =>
                        `${formatCalendarDate(item.date)} ${item.startTime}: ${item.reason}`,
                    )
                    .join(' ')}`
                : '',
            ]
              .filter(Boolean)
              .join(' '),
          });
        }
      } else if (artifact.kind === 'fill_vacant') {
        const result = await applyVacantFillAction({
          rosterId: artifact.rosterId,
          assignments: artifact.assignments.map(({ shiftId, userId }) => ({ shiftId, userId })),
        });
        if (!result.ok) failure = result.error.message;
        else {
          push({
            id: newId(),
            role: 'agent',
            text: `Filled ${result.data.filled} shift${result.data.filled === 1 ? '' : 's'}${result.data.skipped.length ? `; ${result.data.skipped.length} had changed and were left` : ''}.`,
          });
        }
      } else if (artifact.kind === 'remove_shifts') {
        const result = await removeShiftsAction({
          rosterId: artifact.rosterId,
          shiftIds: artifact.shiftIds,
          reason: 'agent',
        });
        if (!result.ok) failure = result.error.message;
        else push({ id: newId(), role: 'agent', text: `Removed ${result.data.removed} shifts.` });
      } else {
        const result = await reassignShiftAction({
          shiftId: artifact.shiftId,
          userId: artifact.toUserId,
        });
        if (!result.ok) failure = result.error.message;
        else {
          push({
            id: newId(),
            role: 'agent',
            text: artifact.toName
              ? `${artifact.toName} has the shift now.`
              : 'The shift is vacant now.',
          });
        }
      }
      if (failure) {
        setStatus(message.id, 'open');
        push({ id: newId(), role: 'error', text: failure });
        return;
      }
      setStatus(message.id, 'applied');
      router.refresh();
      await runCheck(targetRoster ?? ('rosterId' in artifact ? artifact.rosterId : null));
      if (artifact.kind === 'roster_preview') {
        push({ id: newId(), role: 'status', text: 'Build complete' });
      }
    });

  const send = () => {
    const text = prompt.trim();
    if (!text || !rosterId) return;
    setPrompt('');
    const history = messages
      .flatMap((item): { role: 'user' | 'model'; text: string }[] =>
        item.role === 'user'
          ? [{ role: 'user' as const, text: item.text.slice(0, 4000) }]
          : item.role === 'agent'
            ? [{ role: 'model' as const, text: item.text.slice(0, 4000) }]
            : [],
      )
      .slice(-10);
    push({ id: newId(), role: 'user', text });
    startTransition(async () => {
      cancelled.current = false;
      const result = await chatAboutRosterAction({ rosterId, prompt: text, history });
      if (cancelled.current) return;
      if (!result.ok) {
        push({ id: newId(), role: 'error', text: result.error.message });
        return;
      }
      push({ id: newId(), role: 'agent', text: result.data.reply });
      if (result.data.artifact) {
        push({ id: newId(), role: 'artifact', artifact: result.data.artifact, status: 'open' });
      }
    });
  };

  const stop = () => {
    cancelled.current = true;
    push({ id: newId(), role: 'status', text: 'Stopped. Nothing was changed.' });
  };

  const showForm = messages.length === 0;
  const strategyOf = (key: Priority) => setup.strategies.find((option) => option.key === key);

  const form = (
    <div className="flex flex-col gap-4">
      <fieldset>
        <legend className="text-sm font-medium">How should I start?</legend>
        <div className="mt-2 grid grid-cols-2 gap-2">
          {(
            [
              [
                'figure_out',
                'MeroAI figures it out',
                'Looks for patterns in your last 4 weeks of rosters',
              ],
              ['saved', 'Use something saved', 'Copies one of your earlier rosters, day for day'],
            ] as const
          ).map(([key, title, description]) => {
            const disabled = key === 'saved' && setup.earlierRosters.length === 0;
            return (
              <label
                key={key}
                className={cn(
                  'flex flex-col gap-1 rounded-lg border px-3 py-2.5 text-left transition-colors',
                  disabled ? 'cursor-not-allowed opacity-60' : 'cursor-pointer',
                  start === key
                    ? 'border-primary bg-accent text-accent-foreground'
                    : !disabled && 'hover:bg-muted',
                )}
              >
                <input
                  type="radio"
                  name="agent-start"
                  className="sr-only"
                  checked={start === key}
                  disabled={disabled}
                  onChange={() => setStart(key)}
                />
                <span className="text-sm font-medium">{title}</span>
                <span className="text-xs text-muted-foreground">
                  {disabled ? 'There are no earlier rosters yet.' : description}
                </span>
              </label>
            );
          })}
        </div>
      </fieldset>

      {start === 'saved' && setup.earlierRosters.length > 0 && (
        <label className="flex flex-col gap-1.5 text-sm">
          <span className="font-medium">Roster to copy</span>
          <NativeSelect
            value={copyRosterId}
            onChange={(event) => setCopyRosterId(event.target.value)}
          >
            {setup.earlierRosters.map((roster) => (
              <option key={roster.id} value={roster.id}>
                {formatCalendarDate(roster.startsOn)} – {formatCalendarDate(roster.endsOn)}
              </option>
            ))}
          </NativeSelect>
        </label>
      )}

      <div className="flex flex-col gap-2 text-sm">
        <Check
          checked={contractedFirst}
          onChange={setContractedFirst}
          disabled={!setup.contracted.available}
          label="Give contracted hours first"
          hint={
            setup.contracted.reason ??
            'Full- and part-time staff get their contracted hours before casuals.'
          }
        />
        {start === 'figure_out' && (
          <Check
            checked={useStaffCounts}
            onChange={setUseStaffCounts}
            disabled={!setup.staffCountsSet}
            label="Use my staff numbers"
            hint={
              setup.staffCountsSet
                ? 'Shifts cover your trading hours with the number of staff you set for each day.'
                : 'Set trading hours and staff numbers in Settings → Workspace first.'
            }
          />
        )}
        {existingShifts > 0 && (
          <Check
            checked={replaceExisting}
            onChange={setReplaceExisting}
            label="Delete existing shifts first"
            hint={`Removes the ${existingShifts} shift${existingShifts === 1 ? '' : 's'} on this roster when you approve.`}
          />
        )}
      </div>

      <fieldset>
        <legend className="text-sm font-medium">Who goes on first?</legend>
        <div className="mt-2 flex flex-wrap gap-1.5">
          {(['even_hours', 'lowest_cost', 'most_productive'] as const).map((key) => {
            const option = strategyOf(key);
            const disabled = option ? !option.available : true;
            return (
              <button
                key={key}
                type="button"
                aria-pressed={priority === key}
                disabled={disabled}
                title={
                  disabled ? (option?.reason ?? undefined) : ROSTER_STRATEGY_TEXT[key].description
                }
                onClick={() => setPriority(key)}
                className={cn(
                  'rounded-full border px-3 py-1 text-xs transition-colors disabled:cursor-not-allowed disabled:opacity-50',
                  priority === key
                    ? 'border-primary bg-accent font-medium text-accent-foreground'
                    : 'hover:bg-muted',
                )}
              >
                {key === 'most_productive' ? 'Most reliable' : ROSTER_STRATEGY_TEXT[key].title}
              </button>
            );
          })}
        </div>
      </fieldset>

      {canChat && (
        <div className="flex flex-col gap-1.5">
          <label htmlFor="agent-notes" className="text-sm font-medium">
            Anything else I should know?
          </label>
          <Textarea
            id="agent-notes"
            rows={3}
            maxLength={1000}
            value={instructions}
            onChange={(event) => setInstructions(event.target.value)}
          />
          <button
            type="button"
            aria-expanded={showExamples}
            onClick={() => setShowExamples((value) => !value)}
            className="self-start text-xs text-muted-foreground hover:text-foreground"
          >
            {showExamples ? '− Examples' : '+ Examples'}
          </button>
          {showExamples && (
            <div className="flex flex-wrap gap-1.5">
              {EXAMPLES.map((example) => (
                <button
                  key={example}
                  type="button"
                  onClick={() =>
                    setInstructions((value) => (value ? `${value}\n${example}` : example))
                  }
                  className="rounded-full bg-muted px-2.5 py-1 text-xs hover:bg-accent"
                >
                  {example}
                </button>
              ))}
            </div>
          )}
          <input
            ref={fileInput}
            type="file"
            accept={ATTACHMENT_ACCEPT}
            className="sr-only"
            tabIndex={-1}
            onChange={(event) => setFile(event.target.files?.[0] ?? null)}
          />
          {file ? (
            <span className="flex items-center gap-1.5 self-start rounded-md bg-muted px-2 py-1 text-xs">
              <Paperclip aria-hidden className="size-3" /> {file.name}
              <button
                type="button"
                aria-label="Remove the file"
                onClick={() => {
                  setFile(null);
                  if (fileInput.current) fileInput.current.value = '';
                }}
              >
                <X aria-hidden className="size-3" />
              </button>
            </span>
          ) : (
            <button
              type="button"
              onClick={() => fileInput.current?.click()}
              className="flex items-center gap-1.5 self-start text-xs text-muted-foreground hover:text-foreground"
            >
              <Paperclip aria-hidden className="size-3.5" /> Upload a file
            </button>
          )}
        </div>
      )}

      {!setup.tradingHoursSet && (
        <p className="text-xs text-muted-foreground">
          {canEditSettings ? (
            <>
              <Link href="/settings" className="text-primary underline underline-offset-4">
                Set your trading hours
              </Link>{' '}
              so MeroAI can check your cover.
            </>
          ) : (
            'Ask your admin to set the trading hours so MeroAI can check your cover.'
          )}
        </p>
      )}
      <p className="rounded-lg bg-muted px-3 py-2 text-xs text-muted-foreground">
        The roster agent is new. MeroAI can make mistakes, so check the roster before you publish
        it. Nothing changes until you approve, and staff see nothing until you publish.
      </p>
      {formError && (
        <p role="alert" className="text-sm text-destructive-text">
          {formError}
        </p>
      )}
      <div className="flex gap-2">
        {variant === 'panel' && (
          <Button variant="outline" onClick={() => agent?.setOpen(false)} disabled={pending}>
            Cancel
          </Button>
        )}
        <Button
          className="meroai-button flex-1"
          onClick={() => {
            if (start === 'saved' && !copyRosterId) setFormError('Choose a roster to copy.');
            else build();
          }}
          disabled={pending}
        >
          {pending ? 'Starting…' : 'Build roster'}
        </Button>
      </div>
    </div>
  );

  return (
    <section
      aria-label="Roster agent"
      className={cn(
        'meroai-surface flex min-h-0 flex-col',
        variant === 'panel' ? 'h-full' : 'meroai-edge flex-1 rounded-xl shadow-sm',
      )}
    >
      <header className="flex items-center gap-2.5 border-b px-4 py-3">
        <MeroOrb size={32} state={pending ? 'thinking' : 'idle'} />
        <div className="min-w-0 flex-1">
          <h2 className="text-sm font-semibold">
            <span className="meroai-text">MeroAI</span> roster agent
          </h2>
          <p className="truncate text-xs text-muted-foreground">
            {formatCalendarDate(startsOn)} – {formatCalendarDate(endsOn)}
          </p>
        </div>
        {!showForm && (
          <Button
            variant="ghost"
            size="icon"
            aria-label="Start a new build"
            title="Start a new build"
            disabled={pending}
            onClick={() => {
              // The panel follows the conversation until it is opened or closed by hand; keep it
              // open while the conversation is cleared for a new build.
              agent?.setOpen(true);
              setMessages([]);
            }}
          >
            <RotateCcw aria-hidden />
          </Button>
        )}
        {variant === 'panel' && (
          <Button
            variant="ghost"
            size="icon"
            aria-label="Close the roster agent"
            onClick={() => agent?.setOpen(false)}
          >
            <X aria-hidden />
          </Button>
        )}
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4" aria-live="polite">
        {showForm ? (
          form
        ) : (
          <ol className="flex flex-col gap-3">
            {messages.map((message) => (
              <li key={message.id}>
                {message.role === 'user' ? (
                  <p className="ml-6 rounded-xl bg-accent px-3 py-2 text-sm whitespace-pre-line text-accent-foreground">
                    {message.text}
                  </p>
                ) : message.role === 'agent' ? (
                  <div className="text-sm">
                    <p className="mb-0.5 text-xs font-medium text-muted-foreground">MeroAI</p>
                    <p className="whitespace-pre-line">{message.text}</p>
                  </div>
                ) : message.role === 'status' ? (
                  <p className="text-center text-xs text-muted-foreground italic">{message.text}</p>
                ) : message.role === 'error' ? (
                  <p
                    role="alert"
                    className="rounded-lg border border-destructive/30 px-3 py-2 text-sm text-destructive-text"
                  >
                    {message.text}
                  </p>
                ) : message.role === 'check' ? (
                  <div>
                    <p className="mb-0.5 text-xs font-medium text-muted-foreground">MeroAI</p>
                    <CheckCard check={message.check} />
                  </div>
                ) : message.artifact.kind === 'roster_preview' ? (
                  <PlanCard
                    artifact={message.artifact}
                    status={message.status}
                    teamColors={teamColors}
                    onApprove={() => approve(message)}
                    onDiscard={() => setStatus(message.id, 'discarded')}
                  />
                ) : message.artifact.kind === 'fill_vacant' ? (
                  <FillCard
                    artifact={message.artifact}
                    status={message.status}
                    onApprove={() => approve(message)}
                    onDiscard={() => setStatus(message.id, 'discarded')}
                  />
                ) : message.artifact.kind === 'remove_shifts' ? (
                  <RemoveCard
                    artifact={message.artifact}
                    status={message.status}
                    onApprove={() => approve(message)}
                    onDiscard={() => setStatus(message.id, 'discarded')}
                  />
                ) : (
                  <ChangeCard
                    artifact={message.artifact}
                    status={message.status}
                    onApprove={() => approve(message)}
                    onDiscard={() => setStatus(message.id, 'discarded')}
                  />
                )}
              </li>
            ))}
            {pending && (
              <li className="flex items-center gap-2 text-xs text-muted-foreground">
                <MeroOrb size={20} state="thinking" /> MeroAI is working…
              </li>
            )}
          </ol>
        )}
        <div ref={bottom} />
      </div>

      {!showForm && (
        <div className="border-t p-3">
          <form
            className="flex items-end gap-2"
            onSubmit={(event) => {
              event.preventDefault();
              send();
            }}
          >
            <Textarea
              rows={1}
              value={prompt}
              maxLength={4000}
              disabled={pending || !rosterId || !canChat}
              aria-label="Chat about the roster"
              placeholder={
                !canChat
                  ? 'Chat needs a Gemini API key'
                  : rosterId
                    ? 'Chat about the roster…'
                    : 'Approve a plan, then chat about it'
              }
              onKeyDown={(event) => {
                if (event.key === 'Enter' && !event.shiftKey) {
                  event.preventDefault();
                  send();
                }
              }}
              className="max-h-32 min-h-9 resize-none"
            />
            <Button
              type="submit"
              size="icon"
              aria-label="Send"
              disabled={pending || !prompt.trim() || !rosterId || !canChat}
            >
              <ArrowUp aria-hidden />
            </Button>
          </form>
          {pending && (
            <Button variant="outline" size="sm" className="mt-2" onClick={stop}>
              Stop
            </Button>
          )}
        </div>
      )}
    </section>
  );
}

function Check({
  checked,
  onChange,
  disabled,
  label,
  hint,
}: {
  checked: boolean;
  onChange: (value: boolean) => void;
  disabled?: boolean;
  label: string;
  hint: string;
}) {
  return (
    <label
      className={cn('flex gap-2.5', disabled ? 'cursor-not-allowed opacity-60' : 'cursor-pointer')}
    >
      <input
        type="checkbox"
        className="mt-0.5 size-4 accent-(--primary)"
        checked={checked && !disabled}
        disabled={disabled}
        onChange={(event) => onChange(event.target.checked)}
      />
      <span className="flex flex-col">
        <span>{label}</span>
        <span className="text-xs text-muted-foreground">{hint}</span>
      </span>
    </label>
  );
}
