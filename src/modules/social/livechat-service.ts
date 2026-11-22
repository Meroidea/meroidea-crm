import 'server-only';

import { randomBytes } from 'node:crypto';

import { and, eq, isNull, sql } from 'drizzle-orm';

import { socialAccounts } from '@/db/schema';
import { AppError } from '@/lib/errors';
import { audit } from '@/server/audit';
import { requirePermission, type TenantContext } from '@/server/context';
import { withRls, type Tx } from '@/server/db/with-rls';

import { storeCredentials } from './credentials';
import type { ChatWidgetInput } from './livechat-schemas';
import { readAccountSettings } from './settings';

/*
 * Setting up live chat widgets (ADR-072), with social.manage. A widget is a connected account
 * (platform `livechat`) whose public key goes in the business's site, and whose identity secret,
 * kept sealed like any account token, lets the business's server vouch for a signed-in visitor.
 * The secret is shown once, when it is made.
 */

/** The public key in the embed code: 18 random bytes, 24 characters. */
const newWidgetKey = () => randomBytes(18).toString('base64url');
const newIdentitySecret = () => randomBytes(32).toString('base64url');

function pgCode(error: unknown): string | undefined {
  return (error as { code?: string }).code ?? (error as { cause?: { code?: string } }).cause?.code;
}

async function writeSettings(tx: Tx, accountId: string, settings: object) {
  await tx.execute(
    sql`select app.social_set_account_settings(${accountId}::uuid, ${JSON.stringify(settings)}::jsonb)`,
  );
}

async function liveWidget(tx: Tx, ctx: TenantContext, accountId: string) {
  const [widget] = await tx
    .select({ id: socialAccounts.id, name: socialAccounts.name, settings: socialAccounts.settings })
    .from(socialAccounts)
    .where(
      and(
        eq(socialAccounts.tenantId, ctx.tenantId),
        eq(socialAccounts.id, accountId),
        eq(socialAccounts.platform, 'livechat'),
        isNull(socialAccounts.disconnectedAt),
      ),
    )
    .limit(1);
  if (!widget) throw new AppError('NOT_FOUND', 'That chat widget was not found.');
  return widget;
}

function toAppError(error: unknown): never {
  const code = pgCode(error);
  if (code === '42501') {
    throw new AppError('FORBIDDEN', 'Live chat is not switched on for this business.');
  }
  if (code === '22023') {
    throw new AppError('VALIDATION', 'Check the sites, greeting and email setting.');
  }
  throw error;
}

/** Creates a widget, returning its key and its identity secret (shown this once). */
export async function createChatWidget(
  ctx: TenantContext,
  input: ChatWidgetInput,
): Promise<{ id: string; key: string; identitySecret: string }> {
  requirePermission(ctx, 'social.manage');
  const key = newWidgetKey();
  const identitySecret = newIdentitySecret();
  try {
    return await withRls(ctx, async (tx) => {
      const [created] = await tx
        .insert(socialAccounts)
        .values({
          tenantId: ctx.tenantId,
          platform: 'livechat',
          externalId: key,
          name: input.name,
          connectedBy: ctx.userId,
        })
        .returning({ id: socialAccounts.id });
      if (!created) throw new AppError('INTERNAL', 'The widget could not be created.');
      await writeSettings(tx, created.id, {
        allowedOrigins: input.allowedOrigins,
        greeting: input.greeting,
        requireEmail: input.requireEmail,
      });
      await storeCredentials(tx, ctx.tenantId, created.id, {
        accessToken: identitySecret,
        accessExpiresAt: null,
        refreshToken: null,
        refreshExpiresAt: null,
      });
      await audit(tx, ctx, {
        action: 'create',
        entityType: 'social_account',
        entityId: created.id,
        context: { platform: 'livechat', sites: input.allowedOrigins.length },
      });
      return { id: created.id, key, identitySecret };
    });
  } catch (error) {
    toAppError(error);
  }
}

/** Changes a widget's name, sites, greeting and whether an email is asked for first. */
export async function updateChatWidget(
  ctx: TenantContext,
  input: ChatWidgetInput & { accountId: string },
): Promise<void> {
  requirePermission(ctx, 'social.manage');
  try {
    await withRls(ctx, async (tx) => {
      const widget = await liveWidget(tx, ctx, input.accountId);
      const before = readAccountSettings(widget.settings);
      await writeSettings(tx, widget.id, {
        ...before,
        allowedOrigins: input.allowedOrigins,
        greeting: input.greeting,
        requireEmail: input.requireEmail,
      });
      await tx
        .update(socialAccounts)
        .set({ name: input.name, updatedAt: new Date() })
        .where(and(eq(socialAccounts.tenantId, ctx.tenantId), eq(socialAccounts.id, widget.id)));
      await audit(tx, ctx, {
        action: 'update',
        entityType: 'social_account',
        entityId: widget.id,
        changes: {
          name: [widget.name, input.name],
          allowedOrigins: [before.allowedOrigins, input.allowedOrigins],
          requireEmail: [before.requireEmail, input.requireEmail],
        },
      });
    });
  } catch (error) {
    toAppError(error);
  }
}

/**
 * A new identity secret for a widget, shown this once. The old one stops working at once, so
 * the business's server must be given the new one.
 */
export async function rotateChatIdentitySecret(
  ctx: TenantContext,
  accountId: string,
): Promise<{ identitySecret: string }> {
  requirePermission(ctx, 'social.manage');
  const identitySecret = newIdentitySecret();
  await withRls(ctx, async (tx) => {
    const widget = await liveWidget(tx, ctx, accountId);
    await storeCredentials(tx, ctx.tenantId, widget.id, {
      accessToken: identitySecret,
      accessExpiresAt: null,
      refreshToken: null,
      refreshExpiresAt: null,
    });
    await audit(tx, ctx, {
      action: 'update',
      entityType: 'social_account',
      entityId: widget.id,
      context: { rotated: 'identity_secret' },
    });
  });
  return { identitySecret };
}
