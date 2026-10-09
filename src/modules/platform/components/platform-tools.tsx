'use client';

import { Check, Copy, LifeBuoy, LogOut, MapPin, Pause, Play } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';

import { NativeSelect } from '@/components/forms/native-select';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { BUSINESS_TYPES, FEATURES, type FeatureKey } from '@/lib/features';
import { cn } from '@/lib/utils';
import {
  createBusinessAction,
  endSupportAccessAction,
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

export function NewBusinessForm() {
  const router = useRouter();
  const [companyName, setCompanyName] = useState('');
  const [businessType, setBusinessType] = useState<string>(BUSINESS_TYPES[0].key);
  const [features, setFeatures] = useState<FeatureKey[]>([...BUSINESS_TYPES[0].features]);
  const [adminName, setAdminName] = useState('');
  const [adminEmail, setAdminEmail] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [created, setCreated] = useState<{
    tenantId: string;
    adminEmail: string;
    temporaryPassword: string;
  } | null>(null);
  const [copied, setCopied] = useState(false);
  const [isPending, startTransition] = useTransition();

  const submit = () =>
    startTransition(async () => {
      setError(null);
      const result = await createBusinessAction({
        companyName,
        businessType,
        adminName,
        adminEmail,
        features,
      });
      if (!result.ok) {
        return setError(
          Object.values(result.error.fieldErrors ?? {})[0]?.[0] ?? result.error.message,
        );
      }
      setCreated(result.data);
    });

  if (created) {
    const handover = `Sign in at ${window.location.origin}/login\nEmail: ${created.adminEmail}\nTemporary password: ${created.temporaryPassword}`;
    return (
      <div className="flex flex-col gap-4 rounded-xl border bg-card p-6">
        <div>
          <h2 className="text-lg font-semibold">{companyName} is ready</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Hand these sign-in details to their admin. The password is shown only now and is not
            stored anywhere you can read it again.
          </p>
        </div>
        <pre className="overflow-x-auto rounded-lg bg-muted p-4 text-sm" data-sensitive>
          {handover}
        </pre>
        <div className="flex flex-wrap gap-2">
          <Button
            variant="outline"
            onClick={async () => {
              await navigator.clipboard.writeText(handover);
              setCopied(true);
            }}
          >
            {copied ? <Check aria-hidden /> : <Copy aria-hidden />}{' '}
            {copied ? 'Copied' : 'Copy details'}
          </Button>
          <Button onClick={() => router.push(`/platform/${created.tenantId}`)}>
            Open the business
          </Button>
        </div>
      </div>
    );
  }

  return (
    <form
      className="flex flex-col gap-5 rounded-xl border bg-card p-6"
      onSubmit={(event) => {
        event.preventDefault();
        submit();
      }}
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="company-name">Business name</Label>
          <Input
            id="company-name"
            required
            value={companyName}
            onChange={(event) => setCompanyName(event.target.value)}
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="business-type">Type of business</Label>
          <NativeSelect
            id="business-type"
            value={businessType}
            onChange={(event) => {
              setBusinessType(event.target.value);
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
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="admin-name">Their admin’s name</Label>
          <Input
            id="admin-name"
            required
            autoComplete="off"
            value={adminName}
            onChange={(event) => setAdminName(event.target.value)}
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="admin-email">Their admin’s email</Label>
          <Input
            id="admin-email"
            type="email"
            required
            autoComplete="off"
            value={adminEmail}
            onChange={(event) => setAdminEmail(event.target.value)}
          />
        </div>
      </div>
      <fieldset>
        <legend className="text-sm font-medium">Features for this business</legend>
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
        Create business and admin login
      </Button>
    </form>
  );
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

  const run = (
    action: () => Promise<{ ok: boolean; error?: { message: string } }>,
    done: string,
    then?: () => void,
  ) =>
    startTransition(async () => {
      const result = await action();
      setNote(result.ok ? done : (result.error?.message ?? 'Something went wrong.'));
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
          Switching a feature off hides it from everyone in the business. Their records are kept and
          come back if it is switched on again.
        </p>
        <FeaturePicker value={features} onChange={setFeatures} />
        <Button
          className="mt-4"
          disabled={isPending || !changed}
          onClick={() =>
            run(() => setBusinessFeaturesAction({ tenantId, features }), 'Features saved.')
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
  return (
    <div className="no-print flex flex-wrap items-center justify-center gap-3 bg-primary px-4 py-2 text-sm text-primary-foreground">
      <span>
        Support access: you are inside <span className="font-semibold">{businessName}</span> with
        full access.
      </span>
      <Button
        size="sm"
        variant="secondary"
        disabled={isPending}
        onClick={() =>
          startTransition(async () => {
            await endSupportAccessAction({ tenantId });
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
