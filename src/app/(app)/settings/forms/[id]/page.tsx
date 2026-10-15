import { ArrowLeft } from 'lucide-react';
import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { z } from 'zod';

import { PageHeader } from '@/components/data/page-header';
import { WebFormBuilder } from '@/modules/crm-config/components/web-form-builder';
import { getWebForm } from '@/modules/crm-config/queries';
import { getCustomFields } from '@/modules/custom-fields/queries';
import { getLeadConfig } from '@/modules/leads/config';
import { allowedLeadTypes } from '@/modules/leads/settings';
import { hasFeature, requirePermission, requireTenantContext } from '@/server/context';
import { serverEnv } from '@/server/env';

export const metadata: Metadata = { title: 'Website form' };

/** Settings → Website forms → one form, built by the business's admin (docs/leads.md §3.1). */
export default async function WebFormBuilderPage({ params }: PageProps<'/settings/forms/[id]'>) {
  const ctx = await requireTenantContext();
  requirePermission(ctx, 'settings.manage');
  if (!hasFeature(ctx, 'crm')) notFound();
  const { id } = await params;
  const isNew = id === 'new';
  if (!isNew && !z.uuid().safeParse(id).success) notFound();

  const [form, leadConfig, customFields] = await Promise.all([
    isNew ? null : getWebForm(ctx, id),
    getLeadConfig(ctx),
    getCustomFields(ctx, 'contact'),
  ]);
  if (!isNew && !form) notFound();

  return (
    <div className="mx-auto flex w-full max-w-6xl flex-col gap-5">
      <Link
        href="/settings?tab=forms"
        className="flex w-fit items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft aria-hidden className="size-4" /> Website forms
      </Link>
      <PageHeader
        title={form ? form.name : 'New website form'}
        description="Choose what the form asks and how it reads, check the preview, then publish it."
      />
      <WebFormBuilder
        form={form}
        businessName={ctx.tenant.name}
        sources={leadConfig.sources
          .filter((source) => source.isActive || source.id === form?.sourceId)
          .map((source) => ({
            id: source.id,
            name: source.name,
            subSources: source.subSources.filter(
              (sub) => sub.isActive || sub.id === form?.subSourceId,
            ),
          }))}
        leadTypes={allowedLeadTypes(leadConfig.settings)}
        customFields={customFields.map((field) => ({
          key: field.key,
          label: field.label,
          fieldType: field.fieldType,
          choices: field.choices,
          isActive: field.isActive,
        }))}
        appUrl={serverEnv().APP_URL}
      />
    </div>
  );
}
