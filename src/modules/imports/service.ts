import 'server-only';

import { contacts } from '@/db/schema';
import { AppError } from '@/lib/errors';
import { normalizeEmail, normalizePhone } from '@/lib/normalize';
import { findDuplicateContacts } from '@/modules/contacts/duplicates';
import { contactFieldsSchema } from '@/modules/contacts/schemas';
import { audit } from '@/server/audit';
import { requirePermission, type TenantContext } from '@/server/context';
import { withRls } from '@/server/db/with-rls';

import type { ImportChunkInput, ImportChunkResult } from './schemas';

function splitName(raw: Record<string, string>) {
  if (raw.firstName?.trim()) return { firstName: raw.firstName, lastName: raw.lastName };
  const parts = (raw.fullName ?? '').trim().split(/\s+/).filter(Boolean);
  return { firstName: parts[0] ?? '', lastName: parts.slice(1).join(' ') || raw.lastName };
}

/**
 * One chunk of a CSV import, in one transaction (docs/architecture.md §8). Every row goes
 * through the same Zod schema as the contact form; duplicates are checked against the whole
 * workspace and within the file. The importer becomes the owner.
 */
export async function importContactsChunk(
  ctx: TenantContext,
  input: ImportChunkInput,
): Promise<ImportChunkResult> {
  requirePermission(ctx, 'contacts.import');
  requirePermission(ctx, 'contacts.create');

  return withRls(ctx, async (tx) => {
    const result: ImportChunkResult = { created: 0, skippedDuplicates: 0, invalid: [] };
    const seenEmails = new Set<string>();
    const seenPhones = new Set<string>();
    const values: (typeof contacts.$inferInsert)[] = [];

    for (const [index, raw] of input.rows.entries()) {
      const rowNumber = input.firstRowNumber + index;
      const parsed = contactFieldsSchema.safeParse({
        ...splitName(raw),
        email: raw.email ?? '',
        phone: raw.phone ?? '',
        city: raw.city ?? '',
        region: raw.region ?? '',
        country: (raw.country ?? '').length === 2 ? raw.country : '',
        gender: raw.gender ?? '',
      });
      if (!parsed.success) {
        const issue = parsed.error.issues[0];
        result.invalid.push({
          row: rowNumber,
          reason: `${issue?.path.join('.') || 'row'}: ${issue?.message ?? 'invalid'}`,
        });
        continue;
      }

      const email = normalizeEmail(parsed.data.email);
      const phone = normalizePhone(parsed.data.phone, ctx.tenant.country);
      const inFile = (email && seenEmails.has(email)) || (phone && seenPhones.has(phone));
      if (input.duplicates === 'skip') {
        const existing = inFile ? [1] : await findDuplicateContacts(tx, ctx, { email, phone });
        if (existing.length > 0) {
          result.skippedDuplicates += 1;
          continue;
        }
      }
      if (email) seenEmails.add(email);
      if (phone) seenPhones.add(phone);

      values.push({
        tenantId: ctx.tenantId,
        firstName: parsed.data.firstName,
        lastName: parsed.data.lastName,
        email: parsed.data.email,
        emailNormalized: email,
        phone: parsed.data.phone,
        phoneE164: phone,
        city: parsed.data.city,
        region: parsed.data.region,
        country: parsed.data.country,
        gender: parsed.data.gender,
        ownerUserId: ctx.userId,
        sourceId: input.sourceId,
        createdBy: ctx.userId,
        updatedBy: ctx.userId,
      });
    }

    if (values.length > 0) {
      const created = await tx.insert(contacts).values(values).returning({ id: contacts.id });
      result.created = created.length;
      if (created.length !== values.length)
        throw new AppError('INTERNAL', 'Import did not complete.');
    }
    await audit(tx, ctx, {
      action: 'import',
      entityType: 'contact',
      entityId: null,
      context: {
        rows: input.rows.length,
        created: result.created,
        skippedDuplicates: result.skippedDuplicates,
        invalid: result.invalid.length,
      },
    });
    return result;
  });
}
