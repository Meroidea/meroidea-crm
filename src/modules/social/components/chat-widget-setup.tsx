'use client';

import { Check, Copy, KeyRound, MessageCircle } from 'lucide-react';
import { useState } from 'react';
import { useForm } from 'react-hook-form';

import { Field } from '@/components/forms/field';
import { ErrorNote, useActionRunner } from '@/components/forms/use-action-runner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import {
  createChatWidgetAction,
  rotateChatIdentitySecretAction,
  updateChatWidgetAction,
} from '@/modules/social/actions';

import { chatWidgetSchema, type ChatWidgetInput } from '../livechat-schemas';

/*
 * Setting up live chat (ADR-072): a widget's name, the sites allowed to show it, its greeting,
 * and whether an email is asked for first; then the code to paste into the site, and the identity
 * secret for a site whose visitors sign in.
 */

type FormValues = { name: string; sites: string; greeting: string; requireEmail: boolean };
type FieldErrors = Partial<Record<keyof FormValues, string>>;

/** The form's values as the action takes them, or the first problem with each field. */
function parseWidget(
  values: FormValues,
): { ok: true; data: ChatWidgetInput } | { ok: false; errors: FieldErrors } {
  const parsed = chatWidgetSchema.safeParse({
    name: values.name,
    allowedOrigins: values.sites
      .split(/[\s,]+/)
      .map((site) => site.trim())
      .filter(Boolean),
    greeting: values.greeting,
    requireEmail: values.requireEmail,
  });
  if (parsed.success) return { ok: true, data: parsed.data };
  const errors: FieldErrors = {};
  for (const issue of parsed.error.issues) {
    const field =
      issue.path[0] === 'allowedOrigins' ? 'sites' : (issue.path[0] as keyof FormValues);
    errors[field] ??= issue.message;
  }
  return { ok: false, errors };
}

function CopyBox({ label, value }: { label: string; value: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="flex flex-col gap-1">
      <span className="text-xs font-medium text-muted-foreground">{label}</span>
      <div className="flex items-start gap-2">
        <pre className="min-w-0 flex-1 overflow-x-auto rounded-md bg-muted px-3 py-2 text-xs">
          {value}
        </pre>
        <Button
          type="button"
          size="icon"
          variant="outline"
          aria-label={`Copy ${label.toLowerCase()}`}
          onClick={async () => {
            await navigator.clipboard.writeText(value);
            setCopied(true);
            window.setTimeout(() => setCopied(false), 1500);
          }}
        >
          {copied ? <Check aria-hidden /> : <Copy aria-hidden />}
        </Button>
      </div>
    </div>
  );
}

export function embedCode(appUrl: string, key: string) {
  return `<script src="${appUrl}/widget/v1.js" data-key="${key}" async></script>`;
}

function SecretNote({ secret }: { secret: string }) {
  return (
    <div className="flex flex-col gap-2 rounded-md border border-dashed p-3">
      <CopyBox label="Identity secret" value={secret} />
      <p className="text-xs text-muted-foreground">
        Shown only now. Keep it on your website&rsquo;s server, never in the page. For a signed-in
        visitor, sign their email address with it (HMAC-SHA256, lower case, hex) and pass{' '}
        <code>{'{ email, name, signature }'}</code> as <code>window.meroideaChat.identity</code>, so
        their chat joins their record.
      </p>
    </div>
  );
}

function WidgetFields({
  form,
  errors,
}: {
  form: ReturnType<typeof useForm<FormValues>>;
  errors: FieldErrors;
}) {
  return (
    <>
      <Field name="name" label="Shown as" error={errors.name} hint="The name visitors see.">
        <Input id="name" {...form.register('name')} />
      </Field>
      <Field
        name="sites"
        label="Your sites"
        error={errors.sites}
        hint="One per line, like https://www.example.com. Only these can show the chat."
      >
        <Textarea id="sites" rows={2} {...form.register('sites')} />
      </Field>
      <Field name="greeting" label="Greeting" error={errors.greeting}>
        <Input
          id="greeting"
          placeholder="Hi! How can we help?"
          maxLength={300}
          {...form.register('greeting')}
        />
      </Field>
      <label className="flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          className="size-4 accent-primary"
          {...form.register('requireEmail')}
        />
        Ask for an email address before the first message
      </label>
    </>
  );
}

/** Creates a chat widget, then shows its code and identity secret once. */
export function ChatWidgetCreate({ appUrl, defaultName }: { appUrl: string; defaultName: string }) {
  const { run, error, isPending } = useActionRunner();
  const [errors, setErrors] = useState<FieldErrors>({});
  const [created, setCreated] = useState<{ key: string; identitySecret: string } | null>(null);
  const form = useForm<FormValues>({
    defaultValues: { name: defaultName, sites: '', greeting: '', requireEmail: false },
  });
  if (created) {
    return (
      <div className="flex flex-col gap-3" role="status">
        <p className="text-sm">
          Created. Paste this just before <code>&lt;/body&gt;</code> on each page of your site:
        </p>
        <CopyBox label="Embed code" value={embedCode(appUrl, created.key)} />
        <SecretNote secret={created.identitySecret} />
        <Button type="button" variant="outline" className="w-fit" onClick={() => setCreated(null)}>
          Done
        </Button>
      </div>
    );
  }
  return (
    <form
      className="flex flex-col gap-3"
      onSubmit={form.handleSubmit((values) => {
        const parsed = parseWidget(values);
        setErrors(parsed.ok ? {} : parsed.errors);
        if (!parsed.ok) return;
        run(
          () => createChatWidgetAction(parsed.data),
          (data) => {
            setCreated({ key: data.key, identitySecret: data.identitySecret });
            form.reset();
          },
        );
      })}
    >
      <WidgetFields form={form} errors={errors} />
      <ErrorNote error={error} />
      <Button type="submit" className="w-fit" disabled={isPending}>
        <MessageCircle aria-hidden /> {isPending ? 'Creating…' : 'Create chat widget'}
      </Button>
    </form>
  );
}

/** A connected widget's code, settings and identity secret, on the accounts list. */
export function ChatWidgetSettings({
  appUrl,
  accountId,
  widgetKey,
  name,
  settings,
}: {
  appUrl: string;
  accountId: string;
  widgetKey: string;
  name: string;
  settings: { allowedOrigins: string[]; greeting: string | null; requireEmail: boolean };
}) {
  const { run, error, isPending } = useActionRunner();
  const [editing, setEditing] = useState(false);
  const [errors, setErrors] = useState<FieldErrors>({});
  const [secret, setSecret] = useState<string | null>(null);
  const form = useForm<FormValues>({
    defaultValues: {
      name,
      sites: settings.allowedOrigins.join('\n'),
      greeting: settings.greeting ?? '',
      requireEmail: settings.requireEmail,
    },
  });
  return (
    <div className="flex flex-col gap-3 text-sm">
      <CopyBox label="Embed code" value={embedCode(appUrl, widgetKey)} />
      <p className="text-muted-foreground">
        {settings.allowedOrigins.length > 0
          ? `Shown on ${settings.allowedOrigins.join(', ')}.`
          : 'Not allowed on any site yet: add your site so the chat can appear.'}
      </p>
      {secret && <SecretNote secret={secret} />}
      {editing ? (
        <form
          className="flex flex-col gap-3"
          onSubmit={form.handleSubmit((values) => {
            const parsed = parseWidget(values);
            setErrors(parsed.ok ? {} : parsed.errors);
            if (!parsed.ok) return;
            run(
              () => updateChatWidgetAction({ ...parsed.data, accountId }),
              () => setEditing(false),
            );
          })}
        >
          <WidgetFields form={form} errors={errors} />
          <ErrorNote error={error} />
          <div className="flex flex-wrap gap-2">
            <Button type="submit" disabled={isPending}>
              {isPending ? 'Saving…' : 'Save'}
            </Button>
            <Button type="button" variant="outline" onClick={() => setEditing(false)}>
              Cancel
            </Button>
          </div>
        </form>
      ) : (
        <>
          <ErrorNote error={error} />
          <div className="flex flex-wrap gap-2">
            <Button type="button" variant="outline" size="sm" onClick={() => setEditing(true)}>
              Change settings
            </Button>
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={isPending}
              onClick={() => {
                if (
                  !window.confirm(
                    'Make a new identity secret? The current one stops working straight away.',
                  )
                ) {
                  return;
                }
                run(
                  () => rotateChatIdentitySecretAction({ accountId }),
                  (data) => setSecret(data.identitySecret),
                );
              }}
            >
              <KeyRound aria-hidden /> New identity secret
            </Button>
          </div>
        </>
      )}
    </div>
  );
}
