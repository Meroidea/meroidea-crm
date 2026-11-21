import 'server-only';

import { randomInt } from 'node:crypto';

import { and, desc, eq, isNull, notInArray, sql } from 'drizzle-orm';

import { socialAccounts, socialMessageTemplates } from '@/db/schema';
import { AppError } from '@/lib/errors';
import { audit } from '@/server/audit';
import { requirePermission, type TenantContext } from '@/server/context';
import { withRls } from '@/server/db/with-rls';

import { readCredentials, storeCredentials } from './credentials';
import { ProviderError } from './providers/types';
import {
  createWhatsAppTemplate,
  deleteWhatsAppTemplate,
  exchangeWhatsAppCode,
  findWhatsAppNumber,
  listWhatsAppTemplates,
  registerWhatsAppNumber,
  requestWhatsAppSync,
  subscribeWhatsAppAccount,
  whatsappConfigured,
  type WhatsAppNumber,
} from './providers/whatsapp';
import type { ConnectWhatsAppInput, CreateTemplateInput } from './schemas';

/*
 * WhatsApp numbers and their message templates (ADR-066). Everything runs as the signed-in
 * person under row-level security, like the rest of the inbox; Meta is called outside any
 * transaction, and its refusals become messages the person can act on.
 */

const asConflict = (error: unknown): never => {
  if (error instanceof ProviderError) throw new AppError('CONFLICT', error.message);
  throw error;
};

/**
 * Finishes connecting a WhatsApp number after the business completed Embedded Signup. The code
 * is exchanged for the business's own token, which must find the number the page named; the
 * number is saved with its sealed token, the account's webhook switched on, and then either the
 * number is registered for the Cloud API (a new number, with a PIN only Meroidea keeps) or, for
 * a number that stays on the WhatsApp Business app, its contacts and 180 days of chats are asked
 * for (WhatsApp allows that only within 24 hours of connecting).
 */
export async function connectWhatsApp(
  ctx: TenantContext,
  input: ConnectWhatsAppInput,
): Promise<{ accountId: string; warning: string | null }> {
  requirePermission(ctx, 'social.manage');
  if (!whatsappConfigured()) {
    throw new AppError(
      'CONFLICT',
      'WhatsApp is not set up on this platform yet. Ask the platform owner.',
    );
  }
  let token: string;
  let number: WhatsAppNumber;
  try {
    token = await exchangeWhatsAppCode(input.code);
    number = await findWhatsAppNumber(token, input.wabaId, input.phoneNumberId);
  } catch (error) {
    return asConflict(error);
  }
  const pin = input.coexistence ? null : String(randomInt(0, 1_000_000)).padStart(6, '0');

  let accountId: string;
  try {
    accountId = await withRls(ctx, async (tx) => {
      const [existing] = await tx
        .select({ id: socialAccounts.id })
        .from(socialAccounts)
        .where(
          and(
            eq(socialAccounts.tenantId, ctx.tenantId),
            eq(socialAccounts.platform, 'whatsapp'),
            eq(socialAccounts.externalId, number.phoneNumberId),
          ),
        )
        .orderBy(desc(socialAccounts.connectedAt))
        .limit(1);
      const details = {
        name: number.verifiedName ?? number.displayPhone ?? 'WhatsApp number',
        username: number.displayPhone,
        avatarUrl: null,
        providerBusinessId: number.wabaId,
        coexistence: input.coexistence,
        historySync: input.coexistence ? 'requested' : null,
        historyProgress: null,
        status: 'active',
        lastError: null,
        disconnectedAt: null,
        updatedAt: new Date(),
      };
      let id = existing?.id;
      if (id) {
        await tx
          .update(socialAccounts)
          .set(details)
          .where(and(eq(socialAccounts.tenantId, ctx.tenantId), eq(socialAccounts.id, id)));
      } else {
        const [row] = await tx
          .insert(socialAccounts)
          .values({
            ...details,
            tenantId: ctx.tenantId,
            platform: 'whatsapp',
            externalId: number.phoneNumberId,
            connectedBy: ctx.userId,
          })
          .returning({ id: socialAccounts.id });
        id = row!.id;
      }
      await storeCredentials(tx, ctx.tenantId, id, {
        accessToken: token,
        accessExpiresAt: null,
        refreshToken: pin,
        refreshExpiresAt: null,
      });
      await audit(tx, ctx, {
        action: existing ? 'update' : 'create',
        entityType: 'social_account',
        entityId: id,
        context: {
          platform: 'whatsapp',
          reconnected: Boolean(existing),
          coexistence: input.coexistence,
        },
      });
      return id;
    });
  } catch (error) {
    // The live-account index: this number is connected to another business.
    if ((error as { cause?: { code?: string } }).cause?.code === '23505') {
      throw new AppError(
        'CONFLICT',
        'This WhatsApp number is already connected to another business.',
      );
    }
    throw error;
  }

  let warning: string | null = null;
  let historySync: string | null = input.coexistence ? 'requested' : null;
  try {
    await subscribeWhatsAppAccount(token, number.wabaId);
  } catch (error) {
    if (!(error instanceof ProviderError)) throw error;
    warning = `WhatsApp did not switch on new messages for this number: ${error.message}`;
  }
  if (!warning && pin) {
    try {
      await registerWhatsAppNumber(token, number.phoneNumberId, pin);
    } catch (error) {
      if (!(error instanceof ProviderError)) throw error;
      warning =
        error.code === 133005
          ? 'This number already has a two-step verification PIN from before. If messages do not arrive, turn the PIN off in WhatsApp Manager and connect again.'
          : `WhatsApp did not finish registering the number: ${error.message}`;
    }
  }
  if (!warning && input.coexistence) {
    try {
      await requestWhatsAppSync(token, number.phoneNumberId, 'smb_app_state_sync');
      await requestWhatsAppSync(token, number.phoneNumberId, 'history');
    } catch (error) {
      if (!(error instanceof ProviderError)) throw error;
      historySync = 'failed';
      warning = `WhatsApp did not start importing the app's chats: ${error.message}`;
    }
  }
  await withRls(ctx, (tx) =>
    tx
      .update(socialAccounts)
      .set({ lastSyncedAt: new Date(), lastError: warning, historySync, updatedAt: new Date() })
      .where(and(eq(socialAccounts.tenantId, ctx.tenantId), eq(socialAccounts.id, accountId))),
  );
  if (!warning) {
    // Its templates, so the reply box can offer them straight away; best effort.
    await refreshTemplates(ctx, accountId).catch(() => undefined);
  }
  return { accountId, warning };
}

/** A live WhatsApp number of the business with its token, or NOT_FOUND. */
async function liveNumber(ctx: TenantContext, accountId: string) {
  return withRls(ctx, async (tx) => {
    const [account] = await tx
      .select()
      .from(socialAccounts)
      .where(
        and(
          eq(socialAccounts.tenantId, ctx.tenantId),
          eq(socialAccounts.id, accountId),
          eq(socialAccounts.platform, 'whatsapp'),
          isNull(socialAccounts.disconnectedAt),
        ),
      )
      .limit(1);
    if (!account || !account.providerBusinessId) {
      throw new AppError('NOT_FOUND', 'That WhatsApp number is not connected.');
    }
    const credentials = await readCredentials(tx, ctx.tenantId, account.id);
    if (!credentials) {
      throw new AppError('CONFLICT', 'This number needs to be connected again first.');
    }
    return { account, wabaId: account.providerBusinessId, token: credentials.accessToken };
  });
}

/**
 * Brings the number's templates up to date with WhatsApp Manager: new and changed ones saved,
 * ones deleted there removed here. Returns how many there are.
 */
export async function refreshTemplates(ctx: TenantContext, accountId: string): Promise<number> {
  requirePermission(ctx, 'social.manage');
  const { account, wabaId, token } = await liveNumber(ctx, accountId);
  let templates;
  try {
    templates = await listWhatsAppTemplates(token, wabaId);
  } catch (error) {
    return asConflict(error);
  }
  await withRls(ctx, async (tx) => {
    const now = new Date();
    for (const template of templates) {
      await tx
        .insert(socialMessageTemplates)
        .values({ tenantId: ctx.tenantId, accountId: account.id, ...template, syncedAt: now })
        .onConflictDoUpdate({
          target: [socialMessageTemplates.accountId, socialMessageTemplates.externalId],
          set: {
            name: template.name,
            language: template.language,
            category: template.category,
            status: template.status,
            parameterFormat: template.parameterFormat,
            body: template.body,
            headerText: template.headerText,
            footerText: template.footerText,
            parameters: template.parameters,
            sendable: template.sendable,
            reason: template.reason,
            syncedAt: now,
            updatedAt: now,
          },
        });
    }
    const kept = templates.map((template) => template.externalId);
    await tx
      .delete(socialMessageTemplates)
      .where(
        and(
          eq(socialMessageTemplates.tenantId, ctx.tenantId),
          eq(socialMessageTemplates.accountId, account.id),
          kept.length > 0 ? notInArray(socialMessageTemplates.externalId, kept) : sql`true`,
        ),
      );
  });
  return templates.length;
}

/** Submits a new template for Meta's review and keeps it here as pending. */
export async function createTemplate(
  ctx: TenantContext,
  input: CreateTemplateInput,
): Promise<{ templateId: string }> {
  requirePermission(ctx, 'social.manage');
  const { account, wabaId, token } = await liveNumber(ctx, input.accountId);
  let created;
  try {
    created = await createWhatsAppTemplate(token, wabaId, {
      name: input.name,
      category: input.category,
      language: input.language,
      body: input.body,
      examples: input.examples,
      headerText: input.headerText,
      footerText: input.footerText,
    });
  } catch (error) {
    return asConflict(error);
  }
  const templateId = await withRls(ctx, async (tx) => {
    // A template belongs to the WhatsApp Business Account: every live number of it gets it.
    const numbers = await tx
      .select({ id: socialAccounts.id })
      .from(socialAccounts)
      .where(
        and(
          eq(socialAccounts.tenantId, ctx.tenantId),
          eq(socialAccounts.platform, 'whatsapp'),
          eq(socialAccounts.providerBusinessId, wabaId),
          isNull(socialAccounts.disconnectedAt),
        ),
      );
    const rows = await tx
      .insert(socialMessageTemplates)
      .values(
        numbers.map((number) => ({
          tenantId: ctx.tenantId,
          accountId: number.id,
          externalId: created.externalId,
          name: input.name,
          language: input.language,
          category: created.category,
          status: created.status,
          body: input.body,
          headerText: input.headerText,
          footerText: input.footerText,
          parameters: input.examples.map((_, index) => String(index + 1)),
          createdBy: ctx.userId,
        })),
      )
      .onConflictDoNothing({
        target: [socialMessageTemplates.accountId, socialMessageTemplates.externalId],
      })
      .returning({ id: socialMessageTemplates.id, accountId: socialMessageTemplates.accountId });
    const row = rows.find((candidate) => candidate.accountId === account.id);
    if (!row) throw new AppError('CONFLICT', 'That template is already here.');
    await audit(tx, ctx, {
      action: 'create',
      entityType: 'social_message_template',
      entityId: row.id,
      context: { name: input.name, language: input.language, category: created.category },
    });
    return row.id;
  });
  return { templateId };
}

/** Deletes a template from WhatsApp and from here. */
export async function deleteTemplate(ctx: TenantContext, templateId: string): Promise<void> {
  requirePermission(ctx, 'social.manage');
  const [template] = await withRls(ctx, (tx) =>
    tx
      .select()
      .from(socialMessageTemplates)
      .where(
        and(
          eq(socialMessageTemplates.tenantId, ctx.tenantId),
          eq(socialMessageTemplates.id, templateId),
        ),
      )
      .limit(1),
  );
  if (!template) throw new AppError('NOT_FOUND', 'That template was not found.');
  const { wabaId, token } = await liveNumber(ctx, template.accountId);
  try {
    await deleteWhatsAppTemplate(token, wabaId, template);
  } catch (error) {
    return asConflict(error);
  }
  await withRls(ctx, async (tx) => {
    // Every number of the account carries it; Meta's ids are unique, so its id finds them all.
    await tx
      .delete(socialMessageTemplates)
      .where(
        and(
          eq(socialMessageTemplates.tenantId, ctx.tenantId),
          eq(socialMessageTemplates.externalId, template.externalId),
        ),
      );
    await audit(tx, ctx, {
      action: 'delete',
      entityType: 'social_message_template',
      entityId: template.id,
      context: { name: template.name, language: template.language },
    });
  });
}
