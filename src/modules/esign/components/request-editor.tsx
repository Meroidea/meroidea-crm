'use client';

import {
  ArrowDown,
  ArrowUp,
  CalendarDays,
  CheckSquare,
  Copy,
  PenLine,
  Plus,
  Send,
  Signature,
  Trash2,
  Type,
  UserRound,
  type LucideIcon,
} from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useRef, useState, useTransition } from 'react';

import { NativeSelect } from '@/components/forms/native-select';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { cn } from '@/lib/utils';
import { deleteDraftAction, saveDraftAction, sendSignRequestAction } from '@/modules/esign/actions';
import {
  clampBox,
  DEFAULT_FIELD_SIZE,
  FIELD_KIND_LABELS,
  FIELD_KINDS,
  type FieldKind,
} from '@/modules/esign/geometry';
import { MAX_SIGNERS } from '@/modules/esign/schemas';
import type { SignRequestDetail } from '@/modules/esign/types';

import { signerColour } from '../colours';
import { PdfPages } from './pdf-pages';

const KIND_ICONS: Record<FieldKind, LucideIcon> = {
  signature: Signature,
  initials: PenLine,
  name: UserRound,
  date: CalendarDays,
  text: Type,
  checkbox: CheckSquare,
};

type DraftSigner = { key: string; name: string; email: string };
type DraftField = {
  key: string;
  signerKey: string;
  kind: FieldKind;
  page: number;
  x: number;
  y: number;
  width: number;
  height: number;
  required: boolean;
  label: string | null;
};
type Invitation = { signerId: string; name: string; emailed: boolean; link: string | null };

let counter = 0;
const tempKey = (prefix: string) => `${prefix}-${Date.now().toString(36)}-${(counter += 1)}`;

export function RequestEditor({ request }: { request: SignRequestDetail }) {
  const router = useRouter();
  const [title, setTitle] = useState(request.title);
  const [message, setMessage] = useState(request.message ?? '');
  const [signingOrder, setSigningOrder] = useState(request.signingOrder);
  const [verifyEmail, setVerifyEmail] = useState(request.verifyEmail);
  const [expiryDays, setExpiryDays] = useState<string>(request.expiryDays?.toString() ?? '');
  const [signers, setSigners] = useState<DraftSigner[]>(() =>
    request.signers.map((signer) => ({ key: signer.id, name: signer.name, email: signer.email })),
  );
  const [fields, setFields] = useState<DraftField[]>(() =>
    request.fields.map((field) => ({
      key: field.id,
      signerKey: field.signerId,
      kind: field.kind,
      page: field.page,
      x: field.x,
      y: field.y,
      width: field.width,
      height: field.height,
      required: field.required,
      label: field.label,
    })),
  );
  const [activeSigner, setActiveSigner] = useState<string | null>(signers[0]?.key ?? null);
  const [armed, setArmed] = useState<FieldKind | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [invitations, setInvitations] = useState<Invitation[] | null>(null);
  const [dirty, setDirty] = useState(false);
  const [isPending, startTransition] = useTransition();

  const touch = () => {
    setDirty(true);
    setNotice(null);
  };
  const signerIndex = (key: string) => signers.findIndex((signer) => signer.key === key);
  const selectedField = fields.find((field) => field.key === selected) ?? null;

  const updateField = useCallback((key: string, change: Partial<DraftField>) => {
    setFields((current) =>
      current.map((field) => (field.key === key ? { ...field, ...change } : field)),
    );
    setDirty(true);
  }, []);

  const removeField = useCallback((key: string) => {
    setFields((current) => current.filter((field) => field.key !== key));
    setSelected(null);
    setDirty(true);
  }, []);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (target && ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName)) return;
      if ((event.key === 'Delete' || event.key === 'Backspace') && selected) {
        event.preventDefault();
        removeField(selected);
      }
      if (event.key === 'Escape') {
        setArmed(null);
        setSelected(null);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [selected, removeField]);

  // Leaving with unsaved changes asks first.
  useEffect(() => {
    if (!dirty) return;
    const warn = (event: BeforeUnloadEvent) => event.preventDefault();
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [dirty]);

  const placeField = (page: number, x: number, y: number) => {
    if (!armed) {
      setSelected(null);
      return;
    }
    if (!activeSigner) {
      setError('Add a signer first, then place their fields.');
      return;
    }
    const size = DEFAULT_FIELD_SIZE[armed];
    const box = clampBox({ x: x - size.width / 2, y: y - size.height / 2, ...size });
    const key = tempKey('field');
    setFields((current) => [
      ...current,
      { key, signerKey: activeSigner, kind: armed, page, ...box, required: true, label: null },
    ]);
    setSelected(key);
    setArmed(null);
    touch();
  };

  const addSigner = () => {
    const key = tempKey('signer');
    setSigners((current) => [...current, { key, name: '', email: '' }]);
    setActiveSigner(key);
    touch();
  };

  const removeSigner = (key: string) => {
    setSigners((current) => current.filter((signer) => signer.key !== key));
    setFields((current) => current.filter((field) => field.signerKey !== key));
    if (activeSigner === key)
      setActiveSigner(signers.find((signer) => signer.key !== key)?.key ?? null);
    touch();
  };

  const moveSigner = (index: number, delta: number) => {
    setSigners((current) => {
      const next = [...current];
      const [moved] = next.splice(index, 1);
      if (moved) next.splice(index + delta, 0, moved);
      return next;
    });
    touch();
  };

  const payload = () => ({
    id: request.id,
    title,
    message,
    signingOrder,
    verifyEmail,
    expiryDays: expiryDays ? Number(expiryDays) : null,
    signers: signers.map(({ key, name, email }) => ({ key, name, email })),
    fields: fields.map((field) => ({
      signerKey: field.signerKey,
      kind: field.kind,
      page: field.page,
      x: field.x,
      y: field.y,
      width: field.width,
      height: field.height,
      required: field.required,
      label: field.label,
    })),
  });

  const save = async (): Promise<boolean> => {
    setError(null);
    const result = await saveDraftAction(payload());
    if (!result.ok) {
      const firstField = Object.values(result.error.fieldErrors ?? {})[0]?.[0];
      setError(firstField ? `${result.error.message} ${firstField}` : result.error.message);
      return false;
    }
    // New signers now have ids; keep the editor pointing at them.
    const ids = result.data.signerIds;
    setSigners((current) =>
      current.map((signer) => ({ ...signer, key: ids[signer.key] ?? signer.key })),
    );
    setFields((current) =>
      current.map((field) => ({ ...field, signerKey: ids[field.signerKey] ?? field.signerKey })),
    );
    setActiveSigner((current) => (current ? (ids[current] ?? current) : current));
    setDirty(false);
    return true;
  };

  const onSave = () =>
    startTransition(async () => {
      if (await save()) {
        setNotice('Draft saved.');
        router.refresh();
      }
    });

  const onSend = () =>
    startTransition(async () => {
      if (!(await save())) return;
      const result = await sendSignRequestAction({ id: request.id });
      if (!result.ok) {
        setError(result.error.message);
        return;
      }
      if (result.data.invitations.some((invitation) => !invitation.emailed)) {
        setInvitations(result.data.invitations);
      } else {
        router.refresh();
      }
    });

  const onDelete = () =>
    startTransition(async () => {
      if (!window.confirm('Delete this draft? Nobody has been asked to sign it yet.')) return;
      const result = await deleteDraftAction({ id: request.id });
      if (result.ok) router.push('/documents/signatures');
      else setError(result.error.message);
    });

  if (invitations) {
    return <InvitationLinks invitations={invitations} onDone={() => router.refresh()} />;
  }

  return (
    <div className="grid gap-5 lg:grid-cols-[20rem_minmax(0,1fr)]">
      <aside className="flex flex-col gap-5 lg:sticky lg:top-4 lg:max-h-[calc(100svh-2rem)] lg:self-start lg:overflow-y-auto lg:pr-1">
        <section className="flex flex-col gap-3 rounded-xl border bg-card p-4">
          <h2 className="text-sm font-semibold">Details</h2>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="request-title">Title</Label>
            <Input
              id="request-title"
              value={title}
              maxLength={200}
              onChange={(event) => {
                setTitle(event.target.value);
                touch();
              }}
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="request-message">Message to signers (optional)</Label>
            <Textarea
              id="request-message"
              value={message}
              maxLength={2000}
              rows={3}
              onChange={(event) => {
                setMessage(event.target.value);
                touch();
              }}
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="request-order">Signing order</Label>
            <NativeSelect
              id="request-order"
              value={signingOrder}
              onChange={(event) => {
                setSigningOrder(event.target.value as 'parallel' | 'sequential');
                touch();
              }}
            >
              <option value="parallel">Everyone at once</option>
              <option value="sequential">One after another, in the order below</option>
            </NativeSelect>
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="request-expiry">Can be signed for</Label>
            <NativeSelect
              id="request-expiry"
              value={expiryDays}
              onChange={(event) => {
                setExpiryDays(event.target.value);
                touch();
              }}
            >
              {[7, 14, 30, 60, 90].map((days) => (
                <option key={days} value={days}>
                  {days} days after sending
                </option>
              ))}
              <option value="">No time limit</option>
            </NativeSelect>
          </div>
          <label className="flex items-start gap-2.5 text-sm">
            <input
              type="checkbox"
              checked={verifyEmail}
              onChange={(event) => {
                setVerifyEmail(event.target.checked);
                touch();
              }}
              className="mt-0.5 size-4 accent-primary"
            />
            <span>
              Check signers with an emailed code
              <span className="block text-xs text-muted-foreground">
                Before they can open the document, each signer enters a one-time code sent to their
                address. Recommended: a forwarded link alone is then not enough.
              </span>
            </span>
          </label>
        </section>

        <section className="flex flex-col gap-3 rounded-xl border bg-card p-4">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold">Signers</h2>
            <span className="text-xs text-muted-foreground">
              {signers.length}/{MAX_SIGNERS}
            </span>
          </div>
          {signers.length === 0 && (
            <p className="text-sm text-muted-foreground">Add the people who need to sign.</p>
          )}
          <ol className="flex flex-col gap-3">
            {signers.map((signer, index) => (
              <li
                key={signer.key}
                className={cn(
                  'flex flex-col gap-2 rounded-lg border-l-4 bg-muted/40 p-2.5',
                  signerColour(index).split(' ')[0],
                  activeSigner === signer.key && 'ring-2 ring-ring/40',
                )}
                onFocusCapture={() => setActiveSigner(signer.key)}
                onClick={() => setActiveSigner(signer.key)}
              >
                <div className="flex items-center justify-between gap-2 text-xs font-medium">
                  <span>
                    {signingOrder === 'sequential' ? `${index + 1}. ` : ''}Signer {index + 1}
                    <span className="ml-1 font-normal text-muted-foreground">
                      · {fields.filter((field) => field.signerKey === signer.key).length} fields
                    </span>
                  </span>
                  <span className="flex">
                    {signingOrder === 'sequential' && (
                      <>
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon-sm"
                          aria-label={`Move signer ${index + 1} up`}
                          disabled={index === 0}
                          onClick={() => moveSigner(index, -1)}
                        >
                          <ArrowUp aria-hidden />
                        </Button>
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon-sm"
                          aria-label={`Move signer ${index + 1} down`}
                          disabled={index === signers.length - 1}
                          onClick={() => moveSigner(index, 1)}
                        >
                          <ArrowDown aria-hidden />
                        </Button>
                      </>
                    )}
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon-sm"
                      aria-label={`Remove signer ${index + 1}`}
                      onClick={() => removeSigner(signer.key)}
                    >
                      <Trash2 aria-hidden />
                    </Button>
                  </span>
                </div>
                <Input
                  aria-label={`Signer ${index + 1} name`}
                  placeholder="Full name"
                  value={signer.name}
                  maxLength={120}
                  onChange={(event) => {
                    const name = event.target.value;
                    setSigners((current) =>
                      current.map((item) => (item.key === signer.key ? { ...item, name } : item)),
                    );
                    touch();
                  }}
                />
                <Input
                  aria-label={`Signer ${index + 1} email`}
                  placeholder="name@example.com"
                  type="email"
                  value={signer.email}
                  maxLength={254}
                  onChange={(event) => {
                    const email = event.target.value;
                    setSigners((current) =>
                      current.map((item) => (item.key === signer.key ? { ...item, email } : item)),
                    );
                    touch();
                  }}
                />
              </li>
            ))}
          </ol>
          <Button
            type="button"
            variant="outline"
            onClick={addSigner}
            disabled={signers.length >= MAX_SIGNERS}
          >
            <Plus aria-hidden /> Add signer
          </Button>
        </section>

        <section className="flex flex-col gap-3 rounded-xl border bg-card p-4">
          <h2 className="text-sm font-semibold">Fields</h2>
          {signers.length > 0 ? (
            <>
              <p className="text-xs text-muted-foreground">
                Choose a field for{' '}
                <strong>
                  {signers[signerIndex(activeSigner ?? '')]?.name ||
                    `Signer ${signerIndex(activeSigner ?? '') + 1}`}
                </strong>
                , then tap the page where it goes. Drag to move; drag the corner to resize.
              </p>
              <div className="grid grid-cols-2 gap-2">
                {FIELD_KINDS.map((kind) => {
                  const Icon = KIND_ICONS[kind];
                  return (
                    <Button
                      key={kind}
                      type="button"
                      variant={armed === kind ? 'default' : 'outline'}
                      size="sm"
                      aria-pressed={armed === kind}
                      onClick={() => setArmed((current) => (current === kind ? null : kind))}
                      className="justify-start"
                    >
                      <Icon aria-hidden /> {FIELD_KIND_LABELS[kind]}
                    </Button>
                  );
                })}
              </div>
            </>
          ) : (
            <p className="text-sm text-muted-foreground">Add a signer to start placing fields.</p>
          )}

          {selectedField && (
            <div className="flex flex-col gap-2 border-t pt-3">
              <h3 className="text-xs font-semibold">
                Selected: {FIELD_KIND_LABELS[selectedField.kind]} on page {selectedField.page}
              </h3>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="field-signer">For</Label>
                <NativeSelect
                  id="field-signer"
                  value={selectedField.signerKey}
                  onChange={(event) =>
                    updateField(selectedField.key, { signerKey: event.target.value })
                  }
                >
                  {signers.map((signer, index) => (
                    <option key={signer.key} value={signer.key}>
                      {signer.name || `Signer ${index + 1}`}
                    </option>
                  ))}
                </NativeSelect>
              </div>
              {selectedField.kind === 'text' && (
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="field-label">Hint for the signer</Label>
                  <Input
                    id="field-label"
                    value={selectedField.label ?? ''}
                    maxLength={60}
                    placeholder="e.g. Job title"
                    onChange={(event) =>
                      updateField(selectedField.key, { label: event.target.value || null })
                    }
                  />
                </div>
              )}
              {selectedField.kind !== 'signature' && selectedField.kind !== 'date' && (
                <label className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    className="size-4 accent-primary"
                    checked={selectedField.required}
                    onChange={(event) =>
                      updateField(selectedField.key, { required: event.target.checked })
                    }
                  />
                  {selectedField.kind === 'checkbox' ? 'Must be ticked' : 'Required'}
                </label>
              )}
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => removeField(selectedField.key)}
              >
                <Trash2 aria-hidden /> Remove field
              </Button>
            </div>
          )}
        </section>

        {error && (
          <p
            role="alert"
            className="rounded-lg bg-destructive/10 px-3 py-2 text-sm text-destructive-text"
          >
            {error}
          </p>
        )}
        {notice && !error && (
          <p role="status" className="text-sm text-muted-foreground">
            {notice}
          </p>
        )}
        <div className="flex flex-wrap gap-2">
          <Button type="button" onClick={onSend} disabled={isPending}>
            <Send aria-hidden /> Send for signature
          </Button>
          <Button type="button" variant="outline" onClick={onSave} disabled={isPending}>
            Save draft
          </Button>
          <Button type="button" variant="ghost" onClick={onDelete} disabled={isPending}>
            Delete
          </Button>
        </div>
      </aside>

      <div className={cn('min-w-0', armed && '[&_[role=group]]:cursor-crosshair')}>
        <PdfPages
          url={`/api/esign/requests/${request.id}/document`}
          onPagePointerDown={placeField}
          overlay={(page) =>
            fields
              .filter((field) => field.page === page)
              .map((field) => (
                <FieldBox
                  key={field.key}
                  field={field}
                  colour={signerColour(signerIndex(field.signerKey))}
                  signerName={
                    signers[signerIndex(field.signerKey)]?.name ||
                    `Signer ${signerIndex(field.signerKey) + 1}`
                  }
                  selected={selected === field.key}
                  onSelect={() => {
                    setSelected(field.key);
                    setActiveSigner(field.signerKey);
                  }}
                  onChange={(box) => updateField(field.key, box)}
                />
              ))
          }
        />
      </div>
    </div>
  );
}

function FieldBox({
  field,
  colour,
  signerName,
  selected,
  onSelect,
  onChange,
}: {
  field: DraftField;
  colour: string;
  signerName: string;
  selected: boolean;
  onSelect: () => void;
  onChange: (box: { x: number; y: number; width: number; height: number }) => void;
}) {
  const drag = useRef<{
    mode: 'move' | 'resize';
    startX: number;
    startY: number;
    box: { x: number; y: number; width: number; height: number };
    pageWidth: number;
    pageHeight: number;
  } | null>(null);
  const Icon = KIND_ICONS[field.kind];

  const begin = (mode: 'move' | 'resize', event: React.PointerEvent<HTMLElement>) => {
    event.stopPropagation();
    event.preventDefault();
    onSelect();
    const page = (
      event.currentTarget.closest('[role=group]') as HTMLElement | null
    )?.getBoundingClientRect();
    if (!page) return;
    (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
    drag.current = {
      mode,
      startX: event.clientX,
      startY: event.clientY,
      box: { x: field.x, y: field.y, width: field.width, height: field.height },
      pageWidth: page.width,
      pageHeight: page.height,
    };
  };

  const move = (event: React.PointerEvent<HTMLElement>) => {
    const state = drag.current;
    if (!state) return;
    const dx = (event.clientX - state.startX) / state.pageWidth;
    const dy = (event.clientY - state.startY) / state.pageHeight;
    onChange(
      clampBox(
        state.mode === 'move'
          ? { ...state.box, x: state.box.x + dx, y: state.box.y + dy }
          : { ...state.box, width: state.box.width + dx, height: state.box.height + dy },
      ),
    );
  };

  const end = () => {
    drag.current = null;
  };

  return (
    <div
      role="button"
      tabIndex={0}
      aria-label={`${FIELD_KIND_LABELS[field.kind]} for ${signerName}`}
      aria-pressed={selected}
      className={cn(
        'absolute flex cursor-move touch-none items-center gap-1 overflow-hidden rounded-sm border-2 px-1 text-[10px] leading-none font-medium',
        colour,
        selected && 'ring-2 ring-ring ring-offset-1',
      )}
      style={{
        left: `${field.x * 100}%`,
        top: `${field.y * 100}%`,
        width: `${field.width * 100}%`,
        height: `${field.height * 100}%`,
      }}
      onPointerDown={(event) => begin('move', event)}
      onPointerMove={move}
      onPointerUp={end}
      onPointerCancel={end}
      onKeyDown={(event) => {
        const step = event.shiftKey ? 0.02 : 0.005;
        const nudge: Record<string, [number, number]> = {
          ArrowLeft: [-step, 0],
          ArrowRight: [step, 0],
          ArrowUp: [0, -step],
          ArrowDown: [0, step],
        };
        const delta = nudge[event.key];
        if (delta) {
          event.preventDefault();
          onChange(clampBox({ ...field, x: field.x + delta[0], y: field.y + delta[1] }));
        }
      }}
      onFocus={onSelect}
    >
      <Icon aria-hidden className="size-3 shrink-0" />
      <span className="truncate">
        {field.kind === 'checkbox' ? '' : field.label || FIELD_KIND_LABELS[field.kind]}
      </span>
      <span
        aria-hidden
        className="absolute right-0 bottom-0 size-2.5 cursor-se-resize bg-current"
        onPointerDown={(event) => begin('resize', event)}
        onPointerMove={move}
        onPointerUp={end}
        onPointerCancel={end}
      />
    </div>
  );
}

/**
 * Shown only when an invitation could not be emailed: the link is the signer's credential, so it
 * is shown once here, to be passed on directly, and never stored.
 */
export function InvitationLinks({
  invitations,
  onDone,
}: {
  invitations: Invitation[];
  onDone: () => void;
}) {
  const [copied, setCopied] = useState<string | null>(null);
  return (
    <section className="flex max-w-2xl flex-col gap-4 rounded-xl border bg-card p-5">
      <h2 className="text-lg font-semibold">Pass these links on yourself</h2>
      <p className="text-sm text-muted-foreground">
        Email isn’t set up or a message couldn’t be sent, so these signers have not been told yet.
        Send each their own link directly. Each link is personal: anyone holding it can open the
        document {invitations.length > 1 ? 'as that signer' : ''}. It is shown only now.
      </p>
      <ul className="flex flex-col gap-3">
        {invitations.map((invitation) => (
          <li key={invitation.signerId} className="flex flex-col gap-1.5">
            <span className="text-sm font-medium">
              {invitation.name}
              {invitation.emailed && (
                <span className="ml-2 font-normal text-muted-foreground">emailed</span>
              )}
            </span>
            {invitation.link && (
              <div className="flex gap-2">
                <Input
                  readOnly
                  value={invitation.link}
                  aria-label={`Link for ${invitation.name}`}
                  onFocus={(event) => event.target.select()}
                />
                <Button
                  type="button"
                  variant="outline"
                  onClick={async () => {
                    await navigator.clipboard.writeText(invitation.link ?? '');
                    setCopied(invitation.signerId);
                  }}
                >
                  <Copy aria-hidden /> {copied === invitation.signerId ? 'Copied' : 'Copy'}
                </Button>
              </div>
            )}
          </li>
        ))}
      </ul>
      <div>
        <Button type="button" onClick={onDone}>
          Done
        </Button>
      </div>
    </section>
  );
}
