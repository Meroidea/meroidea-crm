import 'server-only';

import { and, asc, eq } from 'drizzle-orm';

import { customFieldDefinitions } from '@/db/schema';
import type { TenantContext } from '@/server/context';
import { withRls, type Tx } from '@/server/db/with-rls';

import { choicesOf, type CustomEntity, type CustomFieldDefinition } from './validation';

export async function loadCustomFields(
  tx: Tx,
  tenantId: string,
  entity: CustomEntity,
): Promise<CustomFieldDefinition[]> {
  const rows = await tx
    .select()
    .from(customFieldDefinitions)
    .where(
      and(
        eq(customFieldDefinitions.tenantId, tenantId),
        eq(customFieldDefinitions.entityType, entity),
      ),
    )
    .orderBy(asc(customFieldDefinitions.position), asc(customFieldDefinitions.label));
  return rows.map((row) => ({
    id: row.id,
    key: row.key,
    label: row.label,
    description: row.description,
    fieldType: row.fieldType,
    choices: choicesOf(row.options),
    isRequired: row.isRequired,
    isActive: row.isActive,
    showInList: row.showInList,
  }));
}

export async function getCustomFields(
  ctx: TenantContext,
  entity: CustomEntity,
): Promise<CustomFieldDefinition[]> {
  return withRls(ctx, (tx) => loadCustomFields(tx, ctx.tenantId, entity));
}
