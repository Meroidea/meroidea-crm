'use client';

import { CircleCheck, Send } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';

import { NativeSelect } from '@/components/forms/native-select';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { linkEmployeeLoginAction } from '@/modules/hiring/staff-actions';
import {
  authoriseRosterAction,
  releasePayslipsAction,
  setTaxWithheldAction,
} from '@/modules/payroll/actions';
import type { SkippedPerson } from '@/modules/payroll/types';

export function AuthoriseForm({
  rosterId,
  defaultPaymentDate,
  defaultEmployerDetails,
  canUseTimesheets = false,
}: {
  rosterId: string;
  defaultPaymentDate: string;
  defaultEmployerDetails: string;
  /** True when the business records clocked time and this person may approve it. */
  canUseTimesheets?: boolean;
}) {
  const router = useRouter();
  const [paymentDate, setPaymentDate] = useState(defaultPaymentDate);
  const [superRate, setSuperRate] = useState('12');
  const [hoursFrom, setHoursFrom] = useState<'roster' | 'timesheets'>('roster');
  const [employerDetails, setEmployerDetails] = useState(defaultEmployerDetails);
  const [error, setError] = useState<string | null>(null);
  const [skipped, setSkipped] = useState<SkippedPerson[] | null>(null);
  const [isPending, startTransition] = useTransition();

  const submit = () =>
    startTransition(async () => {
      setError(null);
      const result = await authoriseRosterAction({
        rosterId,
        paymentDate,
        superRate,
        employerDetails,
        hoursFrom,
      });
      if (!result.ok) {
        const fieldError = Object.values(result.error.fieldErrors ?? {})[0]?.[0];
        return setError(fieldError ?? result.error.message);
      }
      setSkipped(result.data.skipped);
      router.refresh();
    });

  if (skipped) {
    return skipped.length === 0 ? null : (
      <div className="rounded-lg border border-warning-border bg-warning px-4 py-3 text-sm text-warning-text">
        <p className="font-medium">Not everyone on the roster got a payslip</p>
        <ul className="mt-1.5 list-disc space-y-1 pl-5">
          {skipped.map((person) => (
            <li key={person.name}>
              <span className="font-medium">{person.name}:</span> {person.reason}
            </li>
          ))}
        </ul>
      </div>
    );
  }

  return (
    <form
      className="flex flex-col gap-4 rounded-xl border bg-card p-5"
      onSubmit={(event) => {
        event.preventDefault();
        submit();
      }}
    >
      <div>
        <h2 className="font-medium">Authorise the worked hours</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Check the roster shows the hours people actually worked, and correct it first if not.
          Authorising locks the roster and drafts a payslip for each person. Nobody sees their
          payslip until you release it.
        </p>
      </div>
      {canUseTimesheets && (
        <fieldset className="flex flex-col gap-2">
          <legend className="text-sm font-medium">Which hours to pay</legend>
          {(
            [
              ['roster', 'The rostered hours', 'What is on the roster for this period.'],
              [
                'timesheets',
                'Approved timesheets',
                'What people clocked in this period, once every entry is approved or rejected.',
              ],
            ] as const
          ).map(([value, label, hint]) => (
            <label key={value} className="flex items-start gap-2 text-sm">
              <input
                type="radio"
                name="hours-from"
                className="mt-1"
                checked={hoursFrom === value}
                onChange={() => setHoursFrom(value)}
              />
              <span>
                <span className="font-medium">{label}</span>
                <span className="block text-muted-foreground">{hint}</span>
              </span>
            </label>
          ))}
        </fieldset>
      )}
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="payment-date">Payment date</Label>
          <Input
            id="payment-date"
            type="date"
            required
            value={paymentDate}
            onChange={(event) => setPaymentDate(event.target.value)}
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="super-rate">Super (% of gross)</Label>
          <Input
            id="super-rate"
            inputMode="decimal"
            required
            value={superRate}
            onChange={(event) => setSuperRate(event.target.value)}
          />
          <p className="text-xs text-muted-foreground">
            Check the current legal rate before you authorise.
          </p>
        </div>
        <div className="flex flex-col gap-1.5 sm:col-span-2">
          <Label htmlFor="employer-details">Employer details on the payslip</Label>
          <Textarea
            id="employer-details"
            rows={2}
            value={employerDetails}
            onChange={(event) => setEmployerDetails(event.target.value)}
          />
          <p className="text-xs text-muted-foreground">Your business name and business number.</p>
        </div>
      </div>
      {error && (
        <p role="alert" className="text-sm text-destructive-text">
          {error}
        </p>
      )}
      <Button type="submit" disabled={isPending} className="self-start">
        <CircleCheck aria-hidden /> Authorise and draft payslips
      </Button>
    </form>
  );
}

/** Tax withheld on one draft payslip; saved when the field is left. */
export function TaxWithheldInput({
  id,
  value,
  employeeName,
}: {
  id: string;
  value: string;
  employeeName: string;
}) {
  const router = useRouter();
  const [amount, setAmount] = useState(value);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const save = () => {
    if (amount.trim() === value) return;
    startTransition(async () => {
      setError(null);
      const result = await setTaxWithheldAction({ id, taxWithheld: amount });
      if (!result.ok) {
        return setError(
          Object.values(result.error.fieldErrors ?? {})[0]?.[0] ?? result.error.message,
        );
      }
      router.refresh();
    });
  };

  return (
    <span className="flex flex-col items-end gap-1">
      <Input
        inputMode="decimal"
        aria-label={`Tax withheld for ${employeeName}`}
        aria-invalid={Boolean(error)}
        disabled={isPending}
        value={amount}
        onChange={(event) => setAmount(event.target.value)}
        onBlur={save}
        className="h-8 w-28 text-right tabular-nums"
      />
      {error && <span className="max-w-48 text-right text-xs text-destructive-text">{error}</span>}
    </span>
  );
}

export function ReleaseButton({ rosterId, count }: { rosterId: string; count: number }) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  return (
    <div className="flex flex-col items-start gap-2">
      <Button
        disabled={isPending}
        onClick={() => {
          if (
            !window.confirm(
              `Release ${count} ${count === 1 ? 'payslip' : 'payslips'}? Staff will be able to see them, and they can no longer be changed.`,
            )
          ) {
            return;
          }
          startTransition(async () => {
            const result = await releasePayslipsAction({ rosterId });
            if (!result.ok) return setError(result.error.message);
            router.refresh();
          });
        }}
      >
        <Send aria-hidden /> Release {count === 1 ? 'payslip' : `${count} payslips`} to staff
      </Button>
      {error && (
        <p role="alert" className="text-sm text-destructive-text">
          {error}
        </p>
      )}
    </div>
  );
}

/** On a staff profile: which workspace login this employee signs in with. */
export function LoginLinkSelect({
  employeeId,
  value,
  members,
}: {
  employeeId: string;
  value: string | null;
  members: { userId: string; fullName: string }[];
}) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  return (
    <div className="flex flex-col gap-1.5">
      <Label htmlFor="employee-login">Workspace login</Label>
      <NativeSelect
        id="employee-login"
        className="max-w-xs"
        value={value ?? ''}
        disabled={isPending}
        onChange={(event) =>
          startTransition(async () => {
            setError(null);
            const result = await linkEmployeeLoginAction({
              employeeId,
              userId: event.target.value,
            });
            if (!result.ok) return setError(result.error.message);
            router.refresh();
          })
        }
      >
        <option value="">Not linked</option>
        {members.map((member) => (
          <option key={member.userId} value={member.userId}>
            {member.fullName}
          </option>
        ))}
      </NativeSelect>
      <p className="text-xs text-muted-foreground">
        Linking lets their roster shifts be paid at their contract rate and lets them see their own
        payslips.
      </p>
      {error && (
        <p role="alert" className="text-sm text-destructive-text">
          {error}
        </p>
      )}
    </div>
  );
}
