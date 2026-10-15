import 'server-only';

import { sql } from 'drizzle-orm';

import { normalizeEmail, normalizePhone } from '@/lib/normalize';
import { canAccess } from '@/lib/permissions/scope';
import { hasPermission, type TenantContext } from '@/server/context';
import type { Tx } from '@/server/db/with-rls';

import type { DuplicateMatch } from './types';

type DuplicateProbe = {
  firstName?: string | null | undefined;
  lastName?: string | null | undefined;
  email?: string | null | undefined;
  phone?: string | null | undefined;
  dateOfBirth?: string | null | undefined;
  companyName?: string | null | undefined;
  excludeId?: string | null | undefined;
};

type Row = {
  contact_id: string;
  owner_user_id: string | null;
  owner_name: string | null;
  match_kind: DuplicateMatch['matchKind'];
};

/**
 * Same email or phone ⇒ strong match; similar name + same date of birth ⇒ possible match
 * (docs/database.md §10). Searches the whole workspace through a security-definer function, then
 * reveals the record itself only if the viewer's scope covers it — otherwise just the owner's
 * name, so a consultant learns "already with Sarah" without seeing Sarah's contact.
 */
export async function findDuplicateContacts(
  tx: Tx,
  ctx: TenantContext,
  probe: DuplicateProbe,
): Promise<DuplicateMatch[]> {
  const email = normalizeEmail(probe.email);
  const phone = normalizePhone(probe.phone, ctx.tenant.country);
  const fullName = [probe.firstName, probe.lastName].filter(Boolean).join(' ').trim() || null;
  // Matching on a date of birth tells whoever asks whether that date is right for a name, so it
  // counts only for someone allowed to see dates of birth (contacts.view_sensitive).
  const dateOfBirth = hasPermission(ctx, 'contacts.view_sensitive')
    ? probe.dateOfBirth || null
    : null;
  const companyName = probe.companyName?.trim() || null;
  if (!email && !phone && !(fullName && dateOfBirth) && !(fullName && companyName)) return [];

  const rows = (await tx.execute(
    sql`select * from app.find_contact_duplicates(${email}, ${phone}, ${fullName}, ${dateOfBirth}::date, ${probe.excludeId ?? null}::uuid)`,
  )) as unknown as Row[];
  if (fullName && companyName) {
    const byCompany = (await tx.execute(
      sql`select * from app.find_company_contact_duplicates(${companyName}, ${fullName}, ${probe.excludeId ?? null}::uuid)`,
    )) as unknown as Row[];
    for (const row of byCompany) {
      if (!rows.some((existing) => existing.contact_id === row.contact_id)) rows.push(row);
    }
  }

  return rows.map((row) => ({
    matchKind: row.match_kind,
    ownerName: row.owner_name,
    contact: canAccess(ctx, 'contacts.view', { ownerUserId: row.owner_user_id })
      ? { id: row.contact_id }
      : null,
  }));
}
