import 'server-only';

import { randomUUID } from 'node:crypto';

import { and, count, eq, isNotNull, isNull, sql } from 'drizzle-orm';

import { contacts, importBatches } from '@/db/schema';
import { AppError } from '@/lib/errors';
import { normalizeEmail, normalizePhone } from '@/lib/normalize';
import { canAccess } from '@/lib/permissions/scope';
import { recordSystemActivities } from '@/modules/activities/service';
import { assertCanAssignContact, contactRecord } from '@/modules/contacts/access';
import { findDuplicateContacts } from '@/modules/contacts/duplicates';
import { contactFieldsSchema, type ContactFieldsInput } from '@/modules/contacts/schemas';
import { mergeDetailsInto } from '@/modules/contacts/service';
import { loadCustomFields } from '@/modules/custom-fields/queries';
import { cleanCustomFields, type CustomFieldDefinition } from '@/modules/custom-fields/validation';
import { loadLeadConfig, systemStatus, validateSource } from '@/modules/leads/config';
import { routeLead } from '@/modules/leads/routing';
import { allowedLeadTypes } from '@/modules/leads/settings';
import { deliverEmails, notify } from '@/modules/notifications/service';
import { audit } from '@/server/audit';
import { hasPermission, requirePermission, type TenantContext } from '@/server/context';
import { withRls, type Tx } from '@/server/db/with-rls';

import type {
  ImportChunkInput,
  ImportChunkResult,
  ImportReportRow,
  StartImportInput,
} from './schemas';

type BatchSettings = {
  id: string | null;
  asLeads: boolean;
  leadType: 'b2b' | 'b2c' | null;
  sourceId: string | null;
  subSourceId: string | null;
  campaignName: string | null;
  duplicates: 'skip' | 'merge' | 'create';
  assignment: 'me' | 'auto' | 'queue';
};

function splitName(raw: Record<string, string>) {
  if (raw.firstName?.trim()) return { firstName: raw.firstName, lastName: raw.lastName };
  const parts = (raw.fullName ?? '').trim().split(/\s+/).filter(Boolean);
  return { firstName: parts[0] ?? '', lastName: parts.slice(1).join(' ') || raw.lastName };
}

/**
 * A spreadsheet holds what people typed: a choice may be its label rather than its stored value,
 * and a multi-choice cell lists several, separated by commas or semicolons.
 */
function customFromRow(definitions: CustomFieldDefinition[], raw: Record<string, string>) {
  const submitted: Record<string, unknown> = {};
  for (const field of definitions) {
    const cell = raw[`custom.${field.key}`]?.trim();
    if (!cell) continue;
    const choice = (text: string) =>
      field.choices.find(
        (option) =>
          option.value.toLowerCase() === text.toLowerCase() ||
          option.label.toLowerCase() === text.toLowerCase(),
      )?.value ?? text;
    if (field.fieldType === 'select') submitted[field.key] = choice(cell);
    else if (field.fieldType === 'multi_select') {
      submitted[field.key] = cell
        .split(/[;,]/)
        .map((item) => item.trim())
        .filter(Boolean)
        .map(choice);
    } else if (field.fieldType === 'boolean') {
      submitted[field.key] = ['yes', 'y', 'true', '1'].includes(cell.toLowerCase());
    } else submitted[field.key] = cell;
  }
  return submitted;
}

/** Field problems name the column, never the value: the report must not repeat personal data. */
function describeIssue(path: PropertyKey[], message: string) {
  return `${path.map(String).join('.') || 'row'}: ${message}`;
}

async function loadBatch(tx: Tx, ctx: TenantContext, id: string, forUpdate = false) {
  const query = tx
    .select()
    .from(importBatches)
    .where(and(eq(importBatches.tenantId, ctx.tenantId), eq(importBatches.id, id)))
    .limit(1);
  const [batch] = forUpdate ? await query.for('update') : await query;
  // Only the person who started an upload adds rows to it, and only until it is finished.
  if (!batch || batch.createdBy !== ctx.userId) {
    throw new AppError('NOT_FOUND', 'That upload was not found.');
  }
  return batch;
}

/**
 * Opens an upload batch (docs/leads.md §3.1): the source, sub-source, campaign, lead type,
 * duplicate rule and assignment chosen once for the whole file. Each chunk then reads them from
 * here, so a chunk can't quietly change them half-way through.
 */
export async function startImport(
  ctx: TenantContext,
  input: StartImportInput,
): Promise<{ id: string }> {
  requirePermission(ctx, 'contacts.import');
  requirePermission(ctx, 'contacts.create');
  if (input.duplicates === 'merge') requirePermission(ctx, 'contacts.edit');
  if (input.assignment === 'queue') {
    requirePermission(ctx, 'contacts.assign');
    assertCanAssignContact(ctx, null);
  }
  if (input.assignment !== 'me' && !input.asLeads) {
    throw new AppError('VALIDATION', 'Routing and the queue are for leads.', {
      assignment: ['Import as leads to route them'],
    });
  }

  return withRls(ctx, async (tx) => {
    const config = await loadLeadConfig(tx, ctx);
    validateSource(config, input.sourceId, input.subSourceId, { required: input.asLeads });
    let leadType: 'b2b' | 'b2c' | null = null;
    if (input.asLeads) {
      const allowed = allowedLeadTypes(config.settings);
      leadType = input.leadType ?? (allowed.length === 1 ? (allowed[0] ?? null) : null);
      if (!leadType || !allowed.includes(leadType)) {
        throw new AppError('VALIDATION', 'Choose whether these are businesses or individuals.', {
          leadType: ['Choose B2B or B2C'],
        });
      }
    }
    const [batch] = await tx
      .insert(importBatches)
      .values({
        tenantId: ctx.tenantId,
        fileName: input.fileName,
        sourceId: input.sourceId,
        subSourceId: input.subSourceId,
        campaignName: input.campaignName,
        leadType,
        duplicateStrategy: input.duplicates,
        rowCount: input.rowCount,
        report: { asLeads: input.asLeads, assignment: input.assignment, rows: [] },
        createdBy: ctx.userId,
      })
      .returning({ id: importBatches.id });
    if (!batch) throw new AppError('INTERNAL', 'Could not start the upload.');
    await audit(tx, ctx, {
      action: 'create',
      entityType: 'import_batch',
      entityId: batch.id,
      context: {
        rows: input.rowCount,
        asLeads: input.asLeads,
        duplicates: input.duplicates,
        assignment: input.assignment,
      },
    });
    return batch;
  });
}

function settingsOf(batch: typeof importBatches.$inferSelect): BatchSettings {
  const meta = (batch.report ?? {}) as { asLeads?: unknown; assignment?: unknown };
  const assignment =
    meta.assignment === 'auto' || meta.assignment === 'queue' ? meta.assignment : 'me';
  return {
    id: batch.id,
    asLeads: meta.asLeads === true,
    leadType: batch.leadType,
    sourceId: batch.sourceId,
    subSourceId: batch.subSourceId,
    campaignName: batch.campaignName,
    duplicates:
      batch.duplicateStrategy === 'merge' || batch.duplicateStrategy === 'create'
        ? batch.duplicateStrategy
        : 'skip',
    assignment,
  };
}

/**
 * One chunk of an upload, in one transaction (docs/architecture.md §8). Every row goes through
 * the same Zod schema as the contact form; duplicates are checked against the whole workspace and
 * within the file, then skipped, merged into the existing record or created anyway. Each row's
 * outcome is added to the batch's report.
 */
export async function importContactsChunk(
  ctx: TenantContext,
  input: ImportChunkInput,
): Promise<ImportChunkResult> {
  requirePermission(ctx, 'contacts.import');
  requirePermission(ctx, 'contacts.create');

  return withRls(ctx, async (tx) => {
    let settings: BatchSettings;
    if (input.batchId) {
      const batch = await loadBatch(tx, ctx, input.batchId, true);
      if (batch.completedAt) throw new AppError('CONFLICT', 'That upload has already finished.');
      settings = settingsOf(batch);
    } else {
      settings = {
        id: null,
        asLeads: false,
        leadType: null,
        sourceId: input.sourceId,
        subSourceId: null,
        campaignName: null,
        duplicates: input.duplicates,
        assignment: 'me',
      };
    }
    if (settings.duplicates === 'merge') requirePermission(ctx, 'contacts.edit');
    if (settings.assignment === 'queue') {
      requirePermission(ctx, 'contacts.assign');
      assertCanAssignContact(ctx, null);
    }

    const config = await loadLeadConfig(tx, ctx);
    // Settings re-checked on every chunk: a source switched off mid-upload stops it.
    validateSource(config, settings.sourceId, settings.subSourceId, {
      required: settings.asLeads,
    });
    const status = settings.asLeads ? systemStatus(config, 'new', settings.leadType) : null;
    // A column the business requires but the file lacks is a gap to fill later, not a reason to
    // drop the row; values that are there are still checked.
    const definitions = (await loadCustomFields(tx, ctx.tenantId, 'contact')).map((field) => ({
      ...field,
      isRequired: false,
    }));
    const canViewSensitive = hasPermission(ctx, 'contacts.view_sensitive');

    const result: ImportChunkResult = {
      created: 0,
      merged: 0,
      skippedDuplicates: 0,
      duplicatesCreated: 0,
      invalid: [],
    };
    const report: ImportReportRow[] = [];
    const values: (typeof contacts.$inferInsert)[] = [];
    // Leads this batch has given out but not saved yet, so least-loaded routing spreads them.
    const batchLoad = new Map<string, number>();
    const seenEmails = new Map<string, string>();
    const seenPhones = new Map<string, string>();
    const now = new Date();

    // Rows already in this upload count as duplicates too, across chunks.
    if (settings.id) {
      const earlier = await tx
        .select({
          id: contacts.id,
          email: contacts.emailNormalized,
          phone: contacts.phoneE164,
        })
        .from(contacts)
        .where(and(eq(contacts.tenantId, ctx.tenantId), eq(contacts.importBatchId, settings.id)));
      for (const row of earlier) {
        if (row.email) seenEmails.set(row.email, row.id);
        if (row.phone) seenPhones.set(row.phone, row.id);
      }
    }

    for (const [index, raw] of input.rows.entries()) {
      const rowNumber = input.firstRowNumber + index;
      const parsed = contactFieldsSchema.safeParse({
        ...splitName(raw),
        email: raw.email ?? '',
        phone: raw.phone ?? '',
        city: raw.city ?? '',
        region: raw.region ?? '',
        country: (raw.country ?? '').trim().length === 2 ? raw.country : '',
        gender: raw.gender ?? '',
        jobTitle: raw.jobTitle ?? '',
        companyName: raw.companyName ?? '',
        companyWebsite: raw.companyWebsite ?? '',
        companySize: raw.companySize ?? '',
        industry: raw.industry ?? '',
        linkedinUrl: raw.linkedinUrl ?? '',
        language: raw.language ?? '',
        interest: raw.interest ?? '',
        sourceId: settings.sourceId ?? '',
        subSourceId: settings.subSourceId ?? '',
        campaignName: settings.campaignName ?? '',
        leadType: settings.leadType ?? '',
      });
      if (!parsed.success) {
        const issue = parsed.error.issues[0];
        const reason = describeIssue(issue?.path ?? [], issue?.message ?? 'invalid');
        result.invalid.push({ row: rowNumber, reason });
        report.push({ row: rowNumber, outcome: 'error', reason });
        continue;
      }
      const custom = cleanCustomFields(definitions, customFromRow(definitions, raw));
      const [customError] = Object.entries(custom.errors);
      if (customError) {
        const reason = describeIssue([customError[0]], customError[1][0] ?? 'invalid');
        result.invalid.push({ row: rowNumber, reason });
        report.push({ row: rowNumber, outcome: 'error', reason });
        continue;
      }
      const fields: ContactFieldsInput = parsed.data;
      const email = normalizeEmail(fields.email);
      const phone = normalizePhone(fields.phone, ctx.tenant.country);

      const inFileMatch =
        (email ? seenEmails.get(email) : undefined) ?? (phone ? seenPhones.get(phone) : undefined);
      const matches = inFileMatch
        ? []
        : await findDuplicateContacts(tx, ctx, {
            firstName: fields.firstName,
            lastName: fields.lastName,
            email,
            phone,
            companyName: fields.companyName,
          });
      // Only the same email or phone is the same person for certain. A similar name at the same
      // company is created anyway and flagged for someone to check: skipping it, or merging it
      // into the other record, would lose or overwrite a different person.
      const strong = matches.filter(
        (match) => match.matchKind === 'email' || match.matchKind === 'phone',
      );
      const duplicate = Boolean(inFileMatch) || strong.length > 0;
      const possible = !duplicate && matches.length > 0;

      if (duplicate && settings.duplicates === 'skip') {
        result.skippedDuplicates += 1;
        report.push({
          row: rowNumber,
          outcome: 'skipped',
          reason: inFileMatch
            ? 'Repeats an earlier row of this file'
            : `Matches an existing record (${strong[0]?.matchKind})`,
          ...(strong[0]?.contact ? { contactId: strong[0].contact.id } : {}),
        });
        continue;
      }
      if (duplicate && settings.duplicates === 'merge') {
        // Repeats within the file have nothing new to merge into a row made a moment ago.
        if (inFileMatch) {
          result.skippedDuplicates += 1;
          report.push({
            row: rowNumber,
            outcome: 'skipped',
            reason: 'Repeats an earlier row of this file',
          });
          continue;
        }
        const target = strong.find((match) => match.contact)?.contact;
        if (!target) {
          result.skippedDuplicates += 1;
          report.push({
            row: rowNumber,
            outcome: 'skipped',
            reason: 'Matches a record you cannot edit',
          });
          continue;
        }
        const [existing] = await tx
          .select({
            ownerUserId: contacts.ownerUserId,
            originatorUserId: contacts.originatorUserId,
            handoverToUserId: contacts.handoverToUserId,
          })
          .from(contacts)
          .where(and(eq(contacts.tenantId, ctx.tenantId), eq(contacts.id, target.id)))
          .limit(1);
        if (!existing || !canAccess(ctx, 'contacts.edit', contactRecord(existing))) {
          result.skippedDuplicates += 1;
          report.push({
            row: rowNumber,
            outcome: 'skipped',
            reason: 'Matches a record you cannot edit',
          });
          continue;
        }
        await mergeDetailsInto(tx, ctx, target.id, fields, custom.values, {
          subject: 'Details merged in from an upload',
          metadata: { importBatchId: settings.id, row: rowNumber },
        });
        result.merged += 1;
        report.push({ row: rowNumber, outcome: 'merged', contactId: target.id });
        continue;
      }

      let ownerUserId: string | null = ctx.userId;
      if (settings.assignment === 'queue') ownerUserId = null;
      else if (settings.assignment === 'auto') {
        const chosen = await routeLead(
          tx,
          ctx.tenantId,
          {
            leadType: settings.leadType,
            sourceId: settings.sourceId,
            subSourceId: settings.subSourceId,
            country: fields.country,
            region: fields.region,
            industry: fields.industry,
            companySize: fields.companySize,
            language: fields.language,
            interest: fields.interest,
          },
          'intake',
          batchLoad,
        );
        ownerUserId = chosen ?? ctx.userId;
        if (chosen) batchLoad.set(chosen, (batchLoad.get(chosen) ?? 0) + 1);
      }

      const id = randomUUID();
      if (email) seenEmails.set(email, id);
      if (phone) seenPhones.set(phone, id);
      values.push({
        id,
        tenantId: ctx.tenantId,
        firstName: fields.firstName,
        lastName: fields.lastName,
        email: fields.email,
        emailNormalized: email,
        phone: fields.phone,
        phoneE164: phone,
        city: fields.city,
        region: fields.region,
        country: fields.country,
        gender: fields.gender,
        dateOfBirth: canViewSensitive ? fields.dateOfBirth : null,
        jobTitle: fields.jobTitle,
        companyName: fields.companyName,
        companyWebsite: fields.companyWebsite,
        companySize: fields.companySize,
        industry: fields.industry,
        linkedinUrl: fields.linkedinUrl,
        language: fields.language,
        interest: fields.interest,
        customFields: custom.values,
        ownerUserId,
        assignedAt: ownerUserId ? now : null,
        sourceId: settings.sourceId,
        subSourceId: settings.subSourceId,
        campaignName: settings.campaignName,
        importBatchId: settings.id,
        leadType: settings.asLeads ? settings.leadType : null,
        leadStatusId: status?.id ?? null,
        leadStatusChangedAt: status ? now : null,
        createdBy: ctx.userId,
        updatedBy: ctx.userId,
      });
      if (duplicate || possible) {
        result.duplicatesCreated += 1;
        report.push({
          row: rowNumber,
          outcome: 'duplicate_created',
          reason: inFileMatch
            ? 'Repeats an earlier row of this file'
            : possible
              ? 'Possibly the same person as an existing record (similar name, same company): check it'
              : 'Matches an existing record',
          contactId: id,
        });
      } else report.push({ row: rowNumber, outcome: 'created', contactId: id });
    }

    if (values.length > 0) {
      const created = await tx.insert(contacts).values(values).returning({ id: contacts.id });
      if (created.length !== values.length) {
        throw new AppError('INTERNAL', 'Import did not complete.');
      }
      result.created = created.length - result.duplicatesCreated;
      if (settings.asLeads) {
        const source = config.sources.find((candidate) => candidate.id === settings.sourceId);
        const sub = source?.subSources.find((candidate) => candidate.id === settings.subSourceId);
        await recordSystemActivities(
          tx,
          ctx,
          values.map((value) => ({
            type: 'imported' as const,
            subject: `Lead uploaded${source ? ` from ${source.name}${sub ? ` – ${sub.name}` : ''}` : ''}`,
            contactId: value.id!,
            metadata: { importBatchId: settings.id, campaignName: settings.campaignName },
          })),
        );
      }
    }

    if (settings.id) {
      await tx
        .update(importBatches)
        .set({
          createdCount: sql`${importBatches.createdCount} + ${result.created}`,
          mergedCount: sql`${importBatches.mergedCount} + ${result.merged}`,
          skippedCount: sql`${importBatches.skippedCount} + ${result.skippedDuplicates}`,
          duplicateCreatedCount: sql`${importBatches.duplicateCreatedCount} + ${result.duplicatesCreated}`,
          errorCount: sql`${importBatches.errorCount} + ${result.invalid.length}`,
          report: sql`jsonb_set(${importBatches.report}, '{rows}', coalesce(${importBatches.report} -> 'rows', '[]'::jsonb) || ${JSON.stringify(report)}::jsonb)`,
        })
        .where(and(eq(importBatches.tenantId, ctx.tenantId), eq(importBatches.id, settings.id)));
    }

    await audit(tx, ctx, {
      action: 'import',
      entityType: 'contact',
      entityId: settings.id,
      context: {
        rows: input.rows.length,
        created: result.created,
        merged: result.merged,
        skippedDuplicates: result.skippedDuplicates,
        duplicatesCreated: result.duplicatesCreated,
        invalid: result.invalid.length,
      },
    });
    return result;
  });
}

/**
 * Closes an upload. Everyone the routing gave leads to hears about it once, with how many,
 * rather than once per row.
 */
export async function finishImport(ctx: TenantContext, batchId: string): Promise<{ id: string }> {
  requirePermission(ctx, 'contacts.import');
  const emails = await withRls(ctx, async (tx) => {
    const batch = await loadBatch(tx, ctx, batchId, true);
    if (batch.completedAt) return [];
    await tx
      .update(importBatches)
      .set({ completedAt: new Date() })
      .where(and(eq(importBatches.tenantId, ctx.tenantId), eq(importBatches.id, batch.id)));
    if (!settingsOf(batch).asLeads) return [];
    const owners = await tx
      .select({ ownerUserId: contacts.ownerUserId, total: count() })
      .from(contacts)
      .where(
        and(
          eq(contacts.tenantId, ctx.tenantId),
          eq(contacts.importBatchId, batch.id),
          isNotNull(contacts.ownerUserId),
          isNull(contacts.deletedAt),
        ),
      )
      .groupBy(contacts.ownerUserId);
    return notify(
      tx,
      ctx,
      owners.map((owner) => ({
        userId: owner.ownerUserId!,
        type: 'lead_assigned',
        title: `${owner.total} new lead${owner.total === 1 ? '' : 's'} assigned to you from an upload`,
        url: '/leads?view=mine',
        dedupeKey: `import:${batch.id}`,
        email: true,
      })),
    );
  });
  await deliverEmails(ctx, emails);
  return { id: batchId };
}
