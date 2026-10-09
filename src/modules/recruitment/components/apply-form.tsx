'use client';

import { CheckCircle2 } from 'lucide-react';
import { useState, useTransition } from 'react';

import { Field } from '@/components/forms/field';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { MAX_RESUME_BYTES, RESUME_ACCEPT } from '@/modules/recruitment/resumes';

type Reply = { ok: boolean; error?: { message: string; fieldErrors?: Record<string, string[]> } };

/** The public application form. Posts as multipart so a résumé can travel with it. */
export function ApplyForm({ token }: { token: string }) {
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string[]>>({});
  const [isPending, startTransition] = useTransition();

  if (done) {
    return (
      <div role="status" className="flex flex-col items-center gap-2 py-6 text-center">
        <CheckCircle2 aria-hidden className="size-10 text-primary" />
        <p className="text-lg font-semibold">Application received</p>
        <p className="text-sm text-muted-foreground">
          Thank you. The team will be in touch if they would like to take it further.
        </p>
      </div>
    );
  }

  return (
    <form
      className="flex flex-col gap-4"
      onSubmit={(event) => {
        event.preventDefault();
        const data = new FormData(event.currentTarget);
        const resume = data.get('resume');
        if (resume instanceof File && resume.size > MAX_RESUME_BYTES) {
          return setError('The résumé can be up to 5 MB.');
        }
        startTransition(async () => {
          setError(null);
          setFieldErrors({});
          try {
            const response = await fetch(`/api/jobs/${token}/apply`, {
              method: 'POST',
              body: data,
            });
            const reply = (await response.json()) as Reply;
            if (reply.ok) return setDone(true);
            setFieldErrors(reply.error?.fieldErrors ?? {});
            setError(reply.error?.message ?? 'Something went wrong. Try again.');
          } catch {
            setError('Could not send your application. Check your connection and try again.');
          }
        });
      }}
    >
      <Field name="fullName" label="Full name" required error={fieldErrors.fullName?.[0]}>
        <Input id="fullName" name="fullName" autoComplete="name" required maxLength={120} />
      </Field>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field name="email" label="Email" required error={fieldErrors.email?.[0]}>
          <Input id="email" name="email" type="email" autoComplete="email" required />
        </Field>
        <Field name="phone" label="Phone (optional)" error={fieldErrors.phone?.[0]}>
          <Input id="phone" name="phone" type="tel" autoComplete="tel" maxLength={40} />
        </Field>
      </div>
      <Field
        name="coverNote"
        label="Why are you a good fit? (optional)"
        error={fieldErrors.coverNote?.[0]}
      >
        <Textarea id="coverNote" name="coverNote" rows={5} maxLength={3000} />
      </Field>
      <Field
        name="resume"
        label="Résumé (optional)"
        hint="PDF or Word (.docx), up to 5 MB."
        error={fieldErrors.resume?.[0]}
      >
        <Input id="resume" name="resume" type="file" accept={RESUME_ACCEPT} />
      </Field>
      {/* Hidden from people; scripts that fill every field give themselves away. */}
      <div aria-hidden className="absolute -left-[9999px] size-px overflow-hidden">
        <label>
          Website
          <input name="website" tabIndex={-1} autoComplete="off" />
        </label>
      </div>
      {error && (
        <p role="alert" className="text-sm text-destructive-text">
          {error}
        </p>
      )}
      <Button type="submit" size="lg" disabled={isPending}>
        {isPending ? 'Sending…' : 'Send application'}
      </Button>
      <p className="text-xs text-muted-foreground">
        Your details go only to this employer, to consider you for this job.
      </p>
    </form>
  );
}
