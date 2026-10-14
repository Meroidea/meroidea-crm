'use client';

import { Mail, Play, Square } from 'lucide-react';
import { useState } from 'react';

import { Field } from '@/components/forms/field';
import { NativeSelect } from '@/components/forms/native-select';
import { ErrorNote, useActionRunner } from '@/components/forms/use-action-runner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';
import { Textarea } from '@/components/ui/textarea';
import {
  enrollInSequenceAction,
  sendContactEmailAction,
  stopEnrollmentAction,
} from '@/modules/outreach/actions';

type Template = { id: string; name: string; subject: string; body: string };

/** Write or pick a template and send an email from the CRM; it lands on the timeline. */
export function SendEmailButton({
  contactId,
  to,
  templates,
}: {
  contactId: string;
  to: string;
  templates: Template[];
}) {
  const { run, error, isPending } = useActionRunner();
  const [open, setOpen] = useState(false);
  const [templateId, setTemplateId] = useState('');
  const [subject, setSubject] = useState('');
  const [body, setBody] = useState('');
  return (
    <>
      <Button variant="outline" className="flex-1 sm:flex-none" onClick={() => setOpen(true)}>
        <Mail aria-hidden /> Email
      </Button>
      <Sheet open={open} onOpenChange={setOpen}>
        <SheetContent className="w-full gap-0 overflow-y-auto sm:max-w-lg">
          <SheetHeader>
            <SheetTitle>Send an email</SheetTitle>
            <SheetDescription>
              To {to}. Sent under your name; replies come to your own inbox. It is logged on the
              timeline.
            </SheetDescription>
          </SheetHeader>
          <form
            className="flex flex-1 flex-col gap-4 px-4 pb-4"
            onSubmit={(event) => {
              event.preventDefault();
              run(
                () => sendContactEmailAction({ contactId, templateId, subject, body }),
                () => {
                  setOpen(false);
                  setSubject('');
                  setBody('');
                  setTemplateId('');
                },
              );
            }}
          >
            {templates.length > 0 && (
              <Field name="email-template" label="Template">
                <NativeSelect
                  id="email-template"
                  value={templateId}
                  onChange={(event) => {
                    const template = templates.find((item) => item.id === event.target.value);
                    setTemplateId(event.target.value);
                    if (template) {
                      setSubject(template.subject);
                      setBody(template.body);
                    }
                  }}
                >
                  <option value="">Write my own</option>
                  {templates.map((template) => (
                    <option key={template.id} value={template.id}>
                      {template.name}
                    </option>
                  ))}
                </NativeSelect>
              </Field>
            )}
            <Field name="email-subject" label="Subject" required>
              <Input
                id="email-subject"
                value={subject}
                onChange={(e) => setSubject(e.target.value)}
              />
            </Field>
            <Field
              name="email-body"
              label="Message"
              required
              hint="Merge fields such as {{contact.first_name}} are filled in when it is sent."
            >
              <Textarea
                id="email-body"
                rows={10}
                value={body}
                onChange={(e) => setBody(e.target.value)}
              />
            </Field>
            <ErrorNote error={error} />
            <SheetFooter className="mt-auto flex-row justify-end px-0">
              <Button type="button" variant="ghost" onClick={() => setOpen(false)}>
                Cancel
              </Button>
              <Button type="submit" disabled={isPending || !subject.trim() || !body.trim()}>
                {isPending ? 'Sending…' : 'Send'}
              </Button>
            </SheetFooter>
          </form>
        </SheetContent>
      </Sheet>
    </>
  );
}

export function SequencePanel({
  contactId,
  enrollments,
  sequences,
  people,
  canManage,
}: {
  contactId: string;
  enrollments: {
    id: string;
    name: string;
    status: string;
    assignedName: string | null;
    total: number;
    done: number;
  }[];
  sequences: { value: string; label: string }[];
  people: { value: string; label: string }[];
  canManage: boolean;
}) {
  const { run, error, isPending } = useActionRunner();
  const [sequenceId, setSequenceId] = useState('');
  const [assignedTo, setAssignedTo] = useState('');
  return (
    <div className="flex flex-col gap-3">
      {enrollments.length === 0 ? (
        <p className="text-sm text-muted-foreground">Not on a sequence.</p>
      ) : (
        <ul className="flex flex-col divide-y">
          {enrollments.map((item) => (
            <li key={item.id} className="flex items-center justify-between gap-2 py-2">
              <span className="min-w-0">
                <span className="block truncate text-sm font-medium">{item.name}</span>
                <span className="text-xs text-muted-foreground">
                  {item.status === 'active'
                    ? `${item.done} of ${item.total} steps done`
                    : item.status === 'stopped'
                      ? 'Stopped'
                      : 'Completed'}
                  {item.assignedName ? ` · ${item.assignedName}` : ''}
                </span>
              </span>
              {canManage && item.status === 'active' && (
                <Button
                  size="sm"
                  variant="ghost"
                  disabled={isPending}
                  onClick={() => run(() => stopEnrollmentAction({ enrollmentId: item.id }))}
                >
                  <Square aria-hidden /> Stop
                </Button>
              )}
            </li>
          ))}
        </ul>
      )}
      {canManage && sequences.length > 0 && (
        <form
          className="flex flex-col gap-2"
          onSubmit={(event) => {
            event.preventDefault();
            run(
              () => enrollInSequenceAction({ contactId, sequenceId, assignedTo }),
              () => setSequenceId(''),
            );
          }}
        >
          <NativeSelect
            aria-label="Sequence"
            value={sequenceId}
            onChange={(e) => setSequenceId(e.target.value)}
          >
            <option value="">Choose a sequence…</option>
            {sequences.map((sequence) => (
              <option key={sequence.value} value={sequence.value}>
                {sequence.label}
              </option>
            ))}
          </NativeSelect>
          {people.length > 1 && (
            <NativeSelect
              aria-label="Tasks for"
              value={assignedTo}
              onChange={(e) => setAssignedTo(e.target.value)}
            >
              <option value="">Tasks for the owner</option>
              {people.map((person) => (
                <option key={person.value} value={person.value}>
                  Tasks for {person.label}
                </option>
              ))}
            </NativeSelect>
          )}
          <Button
            type="submit"
            size="sm"
            variant="outline"
            className="w-fit"
            disabled={isPending || !sequenceId}
          >
            <Play aria-hidden /> Start sequence
          </Button>
        </form>
      )}
      <ErrorNote error={error} />
    </div>
  );
}
