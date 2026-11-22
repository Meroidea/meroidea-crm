import { ArrowLeft } from 'lucide-react';
import type { Metadata } from 'next';
import Link from 'next/link';

import { PageHeader } from '@/components/data/page-header';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { formatDateTime } from '@/lib/format';
import {
  DeleteTemplateButton,
  NewTemplateForm,
  RefreshTemplatesButton,
} from '@/modules/social/components/template-tools';
import { TEMPLATE_STATUS_LABELS } from '@/modules/social/format';
import { listAccounts, listTemplates } from '@/modules/social/queries';
import { TEMPLATE_LANGUAGES } from '@/modules/social/schemas';
import { requirePermission, requireTenantContext } from '@/server/context';

export const metadata: Metadata = { title: 'WhatsApp templates' };

const STATUS_VARIANT: Record<string, 'secondary' | 'outline' | 'destructive'> = {
  approved: 'secondary',
  pending: 'outline',
  in_appeal: 'outline',
  rejected: 'destructive',
  paused: 'destructive',
  disabled: 'destructive',
};

/**
 * WhatsApp message templates (ADR-066): what may be sent to a customer more than 24 hours after
 * they last wrote. Each is reviewed by Meta; the business pays Meta for each one sent.
 */
export default async function WhatsAppTemplatesPage() {
  const ctx = await requireTenantContext();
  requirePermission(ctx, 'social.manage');
  const [{ accounts }, templates] = await Promise.all([listAccounts(ctx), listTemplates(ctx)]);
  const numbers = accounts.filter((account) => account.platform === 'whatsapp');

  return (
    <div className="flex w-full max-w-4xl flex-col gap-5">
      <Link
        href="/social"
        className="flex w-fit items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft aria-hidden className="size-4" /> Inbox
      </Link>
      <PageHeader
        title="WhatsApp templates"
        description="Messages Meta has approved for sending at any time. After 24 hours without a word from the customer, WhatsApp allows only these. Meta charges your business for each one sent."
      />

      {numbers.length === 0 ? (
        <p className="rounded-xl border bg-card px-4 py-6 text-sm text-muted-foreground">
          Connect a WhatsApp number first, in{' '}
          <Link href="/social/accounts" className="text-primary underline underline-offset-4">
            Connected accounts
          </Link>
          .
        </p>
      ) : (
        <>
          <Card>
            <CardHeader>
              <CardTitle>New template</CardTitle>
              <CardDescription>
                Keep it specific: Meta refuses vague or misleading templates, and marketing ones
                need the customer to have agreed to hear from you.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <NewTemplateForm
                accounts={numbers.map((number) => ({
                  id: number.id,
                  name: number.name,
                  phone: number.username,
                }))}
              />
            </CardContent>
          </Card>

          {numbers.map((number) => {
            const own = templates.filter((template) => template.accountId === number.id);
            return (
              <section
                key={number.id}
                aria-label={`Templates for ${number.name}`}
                className="overflow-hidden rounded-xl border bg-card"
              >
                <header className="flex flex-wrap items-center justify-between gap-2 border-b bg-muted/40 px-4 py-2.5">
                  <h2 className="text-sm font-medium">
                    {number.name}
                    {number.username ? ` · ${number.username}` : ''}
                  </h2>
                  <RefreshTemplatesButton accountId={number.id} />
                </header>
                {own.length === 0 ? (
                  <p className="px-4 py-6 text-sm text-muted-foreground">
                    No templates yet. Create one above, or Refresh to bring in ones made in WhatsApp
                    Manager.
                  </p>
                ) : (
                  <ul className="divide-y">
                    {own.map((template) => (
                      <li key={template.id} className="flex flex-wrap items-start gap-3 px-4 py-3">
                        <div className="min-w-0 flex-1 basis-60">
                          <p className="flex flex-wrap items-center gap-2">
                            <span className="font-medium break-all">{template.name}</span>
                            <Badge variant="outline">
                              {TEMPLATE_LANGUAGES[
                                template.language as keyof typeof TEMPLATE_LANGUAGES
                              ] ?? template.language}
                            </Badge>
                            <Badge variant="outline" className="capitalize">
                              {template.category}
                            </Badge>
                            <Badge variant={STATUS_VARIANT[template.status] ?? 'outline'}>
                              {TEMPLATE_STATUS_LABELS[template.status] ?? template.status}
                            </Badge>
                          </p>
                          {template.headerText && (
                            <p className="mt-1 text-sm font-medium">{template.headerText}</p>
                          )}
                          <p className="mt-1 text-sm whitespace-pre-wrap text-muted-foreground">
                            {template.body}
                          </p>
                          {template.footerText && (
                            <p className="text-xs text-muted-foreground">{template.footerText}</p>
                          )}
                          {template.reason && (
                            <p className="mt-1 text-sm text-destructive-text">
                              Meta&rsquo;s reason: {template.reason}
                            </p>
                          )}
                          {!template.sendable && (
                            <p className="mt-1 text-xs text-muted-foreground">
                              Uses a picture, button value or code Meroidea does not fill in yet:
                              send it from WhatsApp Manager.
                            </p>
                          )}
                          <p className="mt-1 text-xs text-muted-foreground">
                            Checked {formatDateTime(ctx, template.syncedAt)}
                          </p>
                        </div>
                        <DeleteTemplateButton templateId={template.id} name={template.name} />
                      </li>
                    ))}
                  </ul>
                )}
              </section>
            );
          })}
        </>
      )}
    </div>
  );
}
