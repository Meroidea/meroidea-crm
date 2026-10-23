'use client';

import { Check, Copy, KeyRound, LifeBuoy, LogOut, MapPin, Pause, Play, Trash2 } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';

import { Field, fieldA11y } from '@/components/forms/field';
import { NativeSelect } from '@/components/forms/native-select';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { BUSINESS_TYPES, FEATURES, type FeatureKey } from '@/lib/features';
import { cn } from '@/lib/utils';
import type { AgreementLinkDelivery } from '@/modules/platform/service';
import {
  createBusinessAction,
  deleteBusinessAction,
  endSupportAccessAction,
  reencryptPayrollDetailsAction,
  setBusinessFeaturesAction,
  setBusinessStatusAction,
  startSupportAccessAction,
  setBusinessLocationAction,
} from '@/modules/platform/actions';

function FeaturePicker({
  value,
  onChange,
}: {
  value: FeatureKey[];
  onChange: (next: FeatureKey[]) => void;
}) {
  return (
    <div className="grid gap-2 sm:grid-cols-2">
      {FEATURES.map((feature) => {
        const on = value.includes(feature.key);
        return (
          <label
            key={feature.key}
            className={cn(
              'flex cursor-pointer items-start gap-2.5 rounded-lg border px-3 py-2.5 transition-colors',
              on ? 'border-primary bg-accent' : 'hover:bg-muted',
            )}
          >
            <input
              type="checkbox"
              checked={on}
              onChange={() =>
                onChange(on ? value.filter((key) => key !== feature.key) : [...value, feature.key])
              }
              className="mt-0.5 size-4 accent-primary"
            />
            <span>
              <span className="block text-sm font-medium">{feature.label}</span>
              <span className="block text-xs text-muted-foreground">{feature.description}</span>
            </span>
          </label>
        );
      })}
    </div>
  );
}

type NewBusiness = {
  companyName: string;
  legalName: string;
  businessNumber: string;
  businessType: string;
  primaryContactName: string;
  primaryContactEmail: string;
  primaryContactPhone: string;
  adminName: string;
  adminEmail: string;
  latitude: string;
  longitude: string;
  radiusMetres: string;
};

/** Hands over a one-time link: says it was emailed, or shows it once to pass on. */
export function LinkHandover({ delivery, to }: { delivery: AgreementLinkDelivery; to: string }) {
  const [copied, setCopied] = useState(false);
  if (delivery.emailed) {
    return (
      <p className="text-sm text-muted-foreground">
        The link to accept the service agreement was emailed to {to}.
      </p>
    );
  }
  return (
    <div className="flex flex-col gap-2">
      <p className="text-sm text-muted-foreground">
        Email is not set up, so send this link to {to} yourself. It is shown only now, works once
        and expires in 14 days.
      </p>
      <pre className="overflow-x-auto rounded-lg bg-muted p-3 text-sm" data-sensitive>
        {delivery.link}
      </pre>
      <Button
        variant="outline"
        className="self-start"
        onClick={async () => {
          await navigator.clipboard.writeText(delivery.link);
          setCopied(true);
        }}
      >
        {copied ? <Check aria-hidden /> : <Copy aria-hidden />} {copied ? 'Copied' : 'Copy link'}
      </Button>
    </div>
  );
}

export function NewBusinessForm() {
  const router = useRouter();
  const [values, setValues] = useState<NewBusiness>({
    companyName: '',
    legalName: '',
    businessNumber: '',
    businessType: BUSINESS_TYPES[0].key,
    primaryContactName: '',
    primaryContactEmail: '',
    primaryContactPhone: '',
    adminName: '',
    adminEmail: '',
    latitude: '',
    longitude: '',
    radiusMetres: '10',
  });
  const [features, setFeatures] = useState<FeatureKey[]>([...BUSINESS_TYPES[0].features]);
  const [errors, setErrors] = useState<Record<string, string[]>>({});
  const [error, setError] = useState<string | null>(null);
  const [created, setCreated] = useState<
    ({ tenantId: string; adminEmail: string } & AgreementLinkDelivery) | null
  >(null);
  const [isPending, startTransition] = useTransition();

  const set = (key: keyof NewBusiness, value: string) => setValues({ ...values, [key]: value });
  const field = (
    key: keyof NewBusiness,
    label: string,
    options: { type?: string; inputMode?: 'numeric' | 'decimal' | 'tel'; hint?: string } = {},
  ) => (
    <Field name={`business-${key}`} label={label} hint={options.hint} error={errors[key]?.[0]}>
      <Input
        type={options.type ?? 'text'}
        inputMode={options.inputMode}
        autoComplete="off"
        value={values[key]}
        onChange={(event) => set(key, event.target.value)}
        {...fieldA11y(`business-${key}`, errors[key]?.[0])}
      />
    </Field>
  );

  const submit = () =>
    startTransition(async () => {
      setError(null);
      const result = await createBusinessAction({ ...values, features });
      if (!result.ok) {
        setErrors(result.error.fieldErrors ?? {});
        return setError(result.error.message);
      }
      setErrors({});
      setCreated(result.data);
    });

  if (created) {
    return (
      <div className="flex flex-col gap-4 rounded-xl border bg-card p-6">
        <div>
          <h2 className="text-lg font-semibold">{values.companyName} is set up</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Their workspace opens once their admin accepts the service agreement. They then choose
            their own password; nobody else ever knows it.
          </p>
        </div>
        <LinkHandover delivery={created} to={created.adminEmail} />
        <Button className="self-start" onClick={() => router.push(`/platform/${created.tenantId}`)}>
          Open the business
        </Button>
      </div>
    );
  }

  return (
    <form
      className="flex flex-col gap-6 rounded-xl border bg-card p-6"
      onSubmit={(event) => {
        event.preventDefault();
        submit();
      }}
    >
      <fieldset className="grid gap-4 sm:grid-cols-2">
        <legend className="mb-2 font-semibold">The business</legend>
        {field('companyName', 'Business name')}
        {field('legalName', 'Legal name', { hint: 'Only if it differs from the business name' })}
        {field('businessNumber', 'ABN', { inputMode: 'numeric' })}
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="business-type">Type of business</Label>
          <NativeSelect
            id="business-type"
            value={values.businessType}
            onChange={(event) => {
              set('businessType', event.target.value);
              // Choosing a type suggests its usual features; anything can still be changed below.
              setFeatures([
                ...(BUSINESS_TYPES.find((type) => type.key === event.target.value)?.features ?? []),
              ]);
            }}
          >
            {BUSINESS_TYPES.map((type) => (
              <option key={type.key} value={type.key}>
                {type.label}
              </option>
            ))}
          </NativeSelect>
        </div>
        <p className="text-xs text-muted-foreground sm:col-span-2">
          Their admin sees these but cannot change them. Only you can, from this console.
        </p>
      </fieldset>

      <fieldset className="grid gap-4 sm:grid-cols-3">
        <legend className="mb-2 font-semibold">Primary contact</legend>
        {field('primaryContactName', 'Name')}
        {field('primaryContactEmail', 'Email', { type: 'email' })}
        {field('primaryContactPhone', 'Phone', { type: 'tel', inputMode: 'tel' })}
      </fieldset>

      <fieldset className="grid gap-4 sm:grid-cols-2">
        <legend className="mb-2 font-semibold">Their admin’s login</legend>
        {field('adminName', 'Admin’s full name', {
          hint: 'They type this name to accept the agreement',
        })}
        {field('adminEmail', 'Admin’s email', {
          type: 'email',
          hint: 'The agreement link is sent here',
        })}
      </fieldset>

      <fieldset className="grid gap-4 sm:grid-cols-3">
        <legend className="mb-2 font-semibold">Location for clocking in</legend>
        {field('latitude', 'Latitude', { inputMode: 'decimal' })}
        {field('longitude', 'Longitude', { inputMode: 'decimal' })}
        {field('radiusMetres', 'Radius (metres)', { inputMode: 'numeric' })}
        <p className="text-xs text-muted-foreground sm:col-span-3">
          Once set, staff can clock in and out only within the radius. Leave empty for no
          restriction; you can add it later on the business’s page.
        </p>
      </fieldset>

      <fieldset>
        <legend className="font-semibold">Features for this business</legend>
        <p className="mb-2 text-xs text-muted-foreground">
          Their workspace shows only what is ticked. You can change this at any time.
        </p>
        <FeaturePicker value={features} onChange={setFeatures} />
      </fieldset>
      {error && (
        <p role="alert" className="text-sm text-destructive-text">
          {error}
        </p>
      )}
      <Button type="submit" size="lg" disabled={isPending} className="self-start">
        {isPending ? 'Setting up…' : 'Create business and send the agreement'}
      </Button>
    </form>
  );
}

/** What happened when features were saved, so a failed email is never mistaken for a sent one. */
function featuresSavedNote({ notified, emailed }: { notified: number; emailed: boolean }) {
  if (notified === 0) return 'Features saved.';
  const who = notified === 1 ? 'Their Admin has' : `Their ${notified} Admins have`;
  return emailed
    ? `Features saved. ${who} been told in their workspace and by email.`
    : `Features saved. ${who} been told in their workspace, but the email could not be sent (is email set up?), so let them know yourself.`;
}

export function BusinessControls({
  tenantId,
  initialFeatures,
  status,
}: {
  tenantId: string;
  initialFeatures: FeatureKey[];
  status: string;
}) {
  const router = useRouter();
  const [features, setFeatures] = useState(initialFeatures);
  const [note, setNote] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const changed = [...features].sort().join() !== [...initialFeatures].sort().join();
  const suspended = status === 'suspended';

  const run = <T,>(
    action: () => Promise<{ ok: true; data: T } | { ok: false; error: { message: string } }>,
    done: string | ((data: T) => string),
    then?: () => void,
  ) =>
    startTransition(async () => {
      const result = await action();
      setNote(
        result.ok
          ? typeof done === 'string'
            ? done
            : done(result.data)
          : (result.error.message ?? 'Something went wrong.'),
      );
      if (result.ok) {
        then?.();
        router.refresh();
      }
    });

  return (
    <div className="flex flex-col gap-6">
      <section className="rounded-xl border bg-card p-5">
        <h2 className="font-medium">Features</h2>
        <p className="mt-1 mb-3 text-sm text-muted-foreground">
          Switching a feature on tells the business’s Admins, in their workspace and by email.
          Switching one off hides it from everyone in the business. Their records are kept and come
          back if it is switched on again.
        </p>
        <FeaturePicker value={features} onChange={setFeatures} />
        <Button
          className="mt-4"
          disabled={isPending || !changed}
          onClick={() =>
            run(() => setBusinessFeaturesAction({ tenantId, features }), featuresSavedNote)
          }
        >
          Save features
        </Button>
      </section>

      <section className="flex flex-wrap items-center gap-3 rounded-xl border bg-card p-5">
        <div className="min-w-0 flex-1 basis-64">
          <h2 className="font-medium">Support access</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Opens their workspace with full access. You appear in their team list and audit log as
            support until you leave.
          </p>
        </div>
        <Button
          variant="outline"
          disabled={isPending}
          onClick={() =>
            run(
              () => startSupportAccessAction({ tenantId }),
              'Opening…',
              () => router.push('/dashboard'),
            )
          }
        >
          <LifeBuoy aria-hidden /> Open their workspace
        </Button>
      </section>

      <section className="flex flex-wrap items-center gap-3 rounded-xl border bg-card p-5">
        <div className="min-w-0 flex-1 basis-64">
          <h2 className="font-medium">
            {suspended ? 'This business is suspended' : 'Suspend this business'}
          </h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Suspending locks their people out and keeps every record. Nothing is deleted.
          </p>
        </div>
        <Button
          variant="outline"
          className={suspended ? undefined : 'text-destructive-text'}
          disabled={isPending}
          onClick={() => {
            if (
              !suspended &&
              !window.confirm(
                'Suspend this business? Their staff will be locked out until you reactivate it.',
              )
            )
              return;
            run(
              () =>
                setBusinessStatusAction({ tenantId, status: suspended ? 'active' : 'suspended' }),
              suspended ? 'Reactivated.' : 'Suspended.',
            );
          }}
        >
          {suspended ? <Play aria-hidden /> : <Pause aria-hidden />}{' '}
          {suspended ? 'Reactivate' : 'Suspend'}
        </Button>
      </section>
      {note && (
        <p role="status" className="text-sm text-muted-foreground">
          {note}
        </p>
      )}
    </div>
  );
}

/**
 * Deletes a test or example business for good (ADR-056). Only a suspended business can be
 * deleted, and its name must be typed exactly, so a slip cannot remove a live client.
 */
export function DeleteBusiness({
  tenantId,
  name,
  suspended,
}: {
  tenantId: string;
  name: string;
  suspended: boolean;
}) {
  const router = useRouter();
  const [confirmName, setConfirmName] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  return (
    <section className="flex flex-col gap-3 rounded-xl border border-destructive/30 bg-card p-5">
      <div>
        <h2 className="font-medium">Delete this business</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          {suspended
            ? 'Removes the business and everything in it: its people, records, files and audit log. Logins are removed for anyone who belongs to no other business. This cannot be undone. A record that you deleted it is kept in the platform log.'
            : 'Suspend the business first. Only a suspended business can be deleted, and deleting cannot be undone.'}
        </p>
      </div>
      {suspended && (
        <form
          className="flex flex-col gap-3"
          onSubmit={(event) => {
            event.preventDefault();
            startTransition(async () => {
              setError(null);
              const result = await deleteBusinessAction({ tenantId, confirmName });
              if (!result.ok) {
                return setError(
                  Object.values(result.error.fieldErrors ?? {})[0]?.[0] ?? result.error.message,
                );
              }
              router.push('/platform');
            });
          }}
        >
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="confirm-name">
              Type <span className="font-semibold">{name}</span> to confirm
            </Label>
            <Input
              id="confirm-name"
              autoComplete="off"
              className="max-w-sm"
              value={confirmName}
              onChange={(event) => setConfirmName(event.target.value)}
              aria-invalid={Boolean(error)}
            />
          </div>
          {error && (
            <p role="alert" className="text-sm text-destructive-text">
              {error}
            </p>
          )}
          <Button
            type="submit"
            variant="destructive"
            className="self-start"
            disabled={isPending || confirmName.trim() !== name}
          >
            <Trash2 aria-hidden /> Delete {name}
          </Button>
        </form>
      )}
    </section>
  );
}

/** Shown across the top of a business's workspace while a platform owner is inside it. */
/** Where the business is. Once set, its staff can only clock in and out near it. */
export function BusinessLocation({
  tenantId,
  latitude,
  longitude,
  radiusMetres,
}: {
  tenantId: string;
  latitude: string | null;
  longitude: string | null;
  radiusMetres: number;
}) {
  const router = useRouter();
  const [lat, setLat] = useState(latitude ?? '');
  const [lng, setLng] = useState(longitude ?? '');
  const [radius, setRadius] = useState(String(radiusMetres));
  const [note, setNote] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const save = (values: { latitude: string; longitude: string }) =>
    startTransition(async () => {
      const result = await setBusinessLocationAction({
        tenantId,
        ...values,
        radiusMetres: radius,
      });
      if (!result.ok) {
        return setNote(
          Object.values(result.error.fieldErrors ?? {})[0]?.[0] ?? result.error.message,
        );
      }
      setNote(values.latitude ? 'Location saved.' : 'Location removed.');
      router.refresh();
    });

  /** Accepts "-33.868820, 151.209290" pasted from a map into the latitude box. */
  const onLatitude = (value: string) => {
    const pair = value.split(',').map((part) => part.trim());
    if (pair.length === 2 && pair[0] && pair[1]) {
      setLat(pair[0]);
      setLng(pair[1]);
    } else setLat(value);
  };

  return (
    <section className="flex flex-col gap-4 rounded-xl border bg-card p-5">
      <div>
        <h2 className="flex items-center gap-2 font-medium">
          <MapPin aria-hidden className="size-4" /> Location for clocking in
        </h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Enter the coordinates of the workplace. Staff can then clock in and out only within the
          radius, and can no longer type their own hours in. Leave empty for no restriction. Tip: in
          a maps app, press and hold on the entrance and copy the two numbers it shows.
        </p>
      </div>
      <form
        className="grid gap-3 sm:grid-cols-3"
        onSubmit={(event) => {
          event.preventDefault();
          save({ latitude: lat.trim(), longitude: lng.trim() });
        }}
      >
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="location-latitude">Latitude</Label>
          <Input
            id="location-latitude"
            inputMode="decimal"
            placeholder="-33.868820"
            value={lat}
            onChange={(event) => onLatitude(event.target.value)}
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="location-longitude">Longitude</Label>
          <Input
            id="location-longitude"
            inputMode="decimal"
            placeholder="151.209290"
            value={lng}
            onChange={(event) => setLng(event.target.value)}
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="location-radius">Radius (metres)</Label>
          <Input
            id="location-radius"
            inputMode="numeric"
            value={radius}
            onChange={(event) => setRadius(event.target.value)}
          />
        </div>
        <div className="flex flex-wrap items-center gap-2 sm:col-span-3">
          <Button type="submit" disabled={isPending}>
            Save location
          </Button>
          {latitude && (
            <Button
              type="button"
              variant="ghost"
              disabled={isPending}
              onClick={() => {
                setLat('');
                setLng('');
                save({ latitude: '', longitude: '' });
              }}
            >
              Remove restriction
            </Button>
          )}
          {note && (
            <p role="status" className="text-sm text-muted-foreground">
              {note}
            </p>
          )}
        </div>
      </form>
    </section>
  );
}

export function SupportBanner({
  tenantId,
  businessName,
}: {
  tenantId: string;
  businessName: string;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  return (
    <div className="no-print flex flex-wrap items-center justify-center gap-3 bg-primary px-4 py-2 text-sm text-primary-foreground">
      <span>
        Support access: you are inside <span className="font-semibold">{businessName}</span> with
        full access.
      </span>
      {error && (
        <span role="alert" className="font-medium">
          Could not leave: {error}
        </span>
      )}
      <Button
        size="sm"
        variant="secondary"
        disabled={isPending}
        onClick={() =>
          startTransition(async () => {
            // Only once access has really ended: a failure must never look like leaving.
            const result = await endSupportAccessAction({ tenantId });
            if (!result.ok) {
              setError(result.error.message);
              return;
            }
            router.push('/platform');
            router.refresh();
          })
        }
      >
        <LogOut aria-hidden /> Leave
      </Button>
    </div>
  );
}

/**
 * The state of the key that seals staff tax, bank and super numbers, and the one control needed
 * to finish a key rotation (ADR-040).
 */
export function EncryptionKeyPanel({
  configured,
  currentKeyId,
  previousKeys,
  pending,
}: {
  configured: boolean;
  currentKeyId: string | null;
  previousKeys: number;
  pending: number;
}) {
  const router = useRouter();
  const [note, setNote] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const reencrypt = () =>
    startTransition(async () => {
      const result = await reencryptPayrollDetailsAction();
      if (!result.ok) {
        setNote(result.error.message);
        return;
      }
      const { reencrypted, failed } = result.data;
      setNote(
        failed > 0
          ? `Re-encrypted ${reencrypted}. ${failed} could not be opened with any configured key and were left unchanged — keep the previous keys set until they are resolved.`
          : `Re-encrypted ${reencrypted}. Nothing is left on an old key, so the previous keys can now be removed.`,
      );
      router.refresh();
    });

  return (
    <section className="rounded-xl border bg-card p-5">
      <h2 className="flex items-center gap-2 font-medium">
        <KeyRound aria-hidden className="size-4" /> Staff details encryption
      </h2>
      {!configured ? (
        <p className="mt-1 text-sm text-muted-foreground">
          No key is set, so new hires cannot submit tax, bank or super details. Set{' '}
          <code>HR_ENCRYPTION_KEY</code> in the server environment.
        </p>
      ) : (
        <>
          <p className="mt-1 text-sm text-muted-foreground">
            Current key <code>{currentKeyId}</code>
            {previousKeys > 0 &&
              ` · ${previousKeys} previous ${previousKeys === 1 ? 'key' : 'keys'} still readable`}
            {' · '}
            {pending === 0
              ? 'every stored value uses the current key.'
              : `${pending} staff ${pending === 1 ? 'record' : 'records'} still on an older key.`}
          </p>
          <p className="mt-2 text-sm text-muted-foreground">
            To rotate: put the old key in <code>HR_ENCRYPTION_KEYS_PREVIOUS</code>, set the new one
            as <code>HR_ENCRYPTION_KEY</code>, deploy, re-encrypt here, then remove the old key.
          </p>
          <Button
            className="mt-4"
            variant="outline"
            disabled={isPending || pending === 0}
            onClick={reencrypt}
          >
            Re-encrypt now
          </Button>
        </>
      )}
      {note && (
        <p role="status" className="mt-3 text-sm text-muted-foreground">
          {note}
        </p>
      )}
    </section>
  );
}
