'use client';

import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';

import { Field, fieldA11y } from '@/components/forms/field';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { updateBusinessDetailsAction } from '@/modules/settings/actions';
import type { BusinessDetailsValues } from '@/modules/settings/business';

/** How to reach the business, as printed on payslips and other documents it issues. */
export function BusinessForm({ initial }: { initial: BusinessDetailsValues }) {
  const router = useRouter();
  const [values, setValues] = useState(initial);
  const [errors, setErrors] = useState<Record<string, string[]>>({});
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const [isPending, startTransition] = useTransition();
  const input = (key: keyof BusinessDetailsValues) => ({
    value: values[key],
    onChange: (event: { target: { value: string } }) =>
      setValues({ ...values, [key]: event.target.value }),
    ...fieldA11y(`business-${key}`, errors[key]?.[0]),
  });

  return (
    <form
      className="grid max-w-2xl gap-4 sm:grid-cols-2"
      onSubmit={(event) => {
        event.preventDefault();
        startTransition(async () => {
          const result = await updateBusinessDetailsAction(values);
          setErrors(result.ok ? {} : (result.error.fieldErrors ?? {}));
          setMessage(
            result.ok ? { ok: true, text: 'Saved.' } : { ok: false, text: result.error.message },
          );
          if (result.ok) router.refresh();
        });
      }}
    >
      <Field
        name="business-address"
        label="Address"
        className="sm:col-span-2"
        error={errors.address?.[0]}
      >
        <Textarea rows={2} maxLength={240} {...input('address')} />
      </Field>
      <Field name="business-phone" label="Phone" error={errors.phone?.[0]}>
        <Input type="tel" maxLength={40} {...input('phone')} />
      </Field>
      <Field name="business-email" label="Email" error={errors.email?.[0]}>
        <Input type="email" maxLength={120} {...input('email')} />
      </Field>
      <Field name="business-website" label="Website" error={errors.website?.[0]}>
        <Input maxLength={120} {...input('website')} />
      </Field>
      <Field
        name="business-payrollContact"
        label="Payroll contact"
        hint="Who staff should ask about their pay"
        error={errors.payrollContact?.[0]}
      >
        <Input maxLength={80} {...input('payrollContact')} />
      </Field>
      <div className="flex items-center gap-3 sm:col-span-2">
        <Button type="submit" disabled={isPending}>
          {isPending ? 'Saving…' : 'Save business details'}
        </Button>
        {message && (
          <p
            role="status"
            className={
              message.ok ? 'text-sm text-muted-foreground' : 'text-sm text-destructive-text'
            }
          >
            {message.text}
          </p>
        )}
      </div>
    </form>
  );
}
