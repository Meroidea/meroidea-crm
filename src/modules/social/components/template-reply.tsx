'use client';

import { FileText, Send } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useMemo, useState, useTransition } from 'react';

import { NativeSelect } from '@/components/forms/native-select';
import { ErrorNote } from '@/components/forms/use-action-runner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { templateReplyAction } from '@/modules/social/actions';

export type TemplateOption = {
  id: string;
  name: string;
  language: string;
  body: string;
  headerText: string | null;
  footerText: string | null;
  parameters: string[];
};

function render(body: string, parameters: string[], values: string[]) {
  return body.replace(/\{\{\s*([A-Za-z0-9_]+)\s*\}\}/g, (whole, name: string) => {
    const index = parameters.indexOf(name);
    return index >= 0 && values[index]?.trim() ? values[index]!.trim() : whole;
  });
}

/**
 * Sends an approved WhatsApp template: the only message WhatsApp allows once 24 hours have
 * passed since the customer last wrote. The preview shows the message as the customer will get
 * it; Meta charges the business for each one (ADR-066).
 */
export function TemplateReply({
  conversationId,
  templates,
  canManage,
  notice,
}: {
  conversationId: string;
  templates: TemplateOption[];
  canManage: boolean;
  /** Why only a template can go now, shown above the form. */
  notice?: string;
}) {
  const router = useRouter();
  const [templateId, setTemplateId] = useState(templates[0]?.id ?? '');
  const [values, setValues] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const template = templates.find((option) => option.id === templateId) ?? null;
  const preview = useMemo(
    () => (template ? render(template.body, template.parameters, values) : ''),
    [template, values],
  );

  if (templates.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        {notice ? `${notice} ` : ''}There is no approved template to send yet.{' '}
        {canManage ? (
          <Link href="/social/templates" className="text-primary underline underline-offset-4">
            Create one
          </Link>
        ) : (
          'Ask an admin to create one.'
        )}{' '}
        Meta usually reviews a template within minutes, sometimes up to a day.
      </p>
    );
  }

  const ready = template && template.parameters.every((_, index) => values[index]?.trim());

  return (
    <form
      className="flex flex-col gap-3"
      onSubmit={(event) => {
        event.preventDefault();
        if (!template || !ready) return;
        startTransition(async () => {
          setError(null);
          const result = await templateReplyAction({
            conversationId,
            templateId: template.id,
            values: template.parameters.map((_, index) => values[index]!.trim()),
          });
          if (!result.ok) {
            setError(result.error.message);
          } else {
            setValues([]);
          }
          router.refresh();
        });
      }}
    >
      {notice && <p className="text-sm text-muted-foreground">{notice}</p>}
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="flex flex-col gap-1.5 sm:col-span-2">
          <Label htmlFor="template-choice">Template</Label>
          <NativeSelect
            id="template-choice"
            value={templateId}
            onChange={(event) => {
              setTemplateId(event.target.value);
              setValues([]);
            }}
          >
            {templates.map((option) => (
              <option key={option.id} value={option.id}>
                {option.name} ({option.language})
              </option>
            ))}
          </NativeSelect>
        </div>
        {template?.parameters.map((name, index) => (
          <div key={`${template.id}-${name}`} className="flex flex-col gap-1.5">
            <Label htmlFor={`template-value-${index}`}>Value for {`{{${name}}}`}</Label>
            <Input
              id={`template-value-${index}`}
              value={values[index] ?? ''}
              maxLength={500}
              onChange={(event) => {
                const next = [...values];
                next[index] = event.target.value;
                setValues(next);
              }}
            />
          </div>
        ))}
      </div>
      {template && (
        <div className="rounded-lg border bg-muted/40 p-3 text-sm" aria-label="Preview">
          <p className="mb-1 flex items-center gap-1 text-xs text-muted-foreground">
            <FileText aria-hidden className="size-3" /> What the customer receives
          </p>
          {template.headerText && <p className="font-medium">{template.headerText}</p>}
          <p className="whitespace-pre-wrap" data-sensitive>
            {preview}
          </p>
          {template.footerText && (
            <p className="mt-1 text-xs text-muted-foreground">{template.footerText}</p>
          )}
        </div>
      )}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs text-muted-foreground">Meta charges your business for templates.</p>
        <Button type="submit" size="sm" disabled={!ready || isPending}>
          <Send aria-hidden /> {isPending ? 'Sending…' : 'Send template'}
        </Button>
      </div>
      <ErrorNote error={error} />
    </form>
  );
}
