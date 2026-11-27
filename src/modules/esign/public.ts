import 'server-only';

import { createHmac, randomBytes, randomInt, randomUUID, timingSafeEqual } from 'node:crypto';

import { and, asc, eq, inArray, isNull, ne, sql } from 'drizzle-orm';

import {
  auditLogs,
  signRequestEvents,
  signRequestFields,
  signRequests,
  signRequestSigners,
  tenants,
  users,
} from '@/db/schema';
import { AppError } from '@/lib/errors';
import { OPEN_TENANT_STATUSES } from '@/lib/tenant/status';
import { createLinkToken, hashLinkToken } from '@/server/crypto';
import { adminDb } from '@/server/db/admin';
import { sendEmail } from '@/server/email';
import { serverEnv } from '@/server/env';
import { enforceRateLimit } from '@/server/rate-limit';
import { readObject, removeObject, writeObject } from '@/server/storage';

import {
  codeEmail,
  completedEmail,
  declinedEmail,
  invitationEmail,
  signedNoticeEmail,
} from './emails';
import type { FieldKind } from './geometry';
import { maskEmail, resolveFieldValues, signersWhoseTurnItIs, waitingOn } from './rules';
import { MAX_SIGNATURE_BYTES, type SubmitSignatureInput } from './schemas';
import { OPEN_LINK_DAYS } from './service';
import { pngSize, stampSignedPdf, type CertificateEvent } from './stamp';
import type { SignerStatus, SignRequestStatus, SigningView } from './types';

/**
 * The signer's side of a signature request (ADR-089). Signers have no account, so there is no
 * session for RLS to match: this file uses the privileged connection, and the link's secret is the
 * credential, with an emailed code on top when the request asks for one. Every function starts
 * from the link's hash and touches only the one signer and request it names. Nothing here takes a
 * tenant, request, signer or field id from the caller except field ids, which are checked against
 * the signer's own fields.
 */

const GONE = 'This link is no longer valid. Ask the person who sent it for a new one.';
const CODE_MINUTES = 10;
const MAX_CODE_TRIES = 5;
/** How long entering the right code keeps a browser trusted for that signer. */
export const SESSION_HOURS = 12;
/** After completion, links stay open this long so everyone can download their copy. */
const DOWNLOAD_DAYS = 30;
const DAY = 86_400_000;

type Db = ReturnType<typeof adminDb>;
type Tx = Parameters<Parameters<Db['transaction']>[0]>[0];
export type RequestMeta = { ip: string | null; userAgent: string | null };
/** Reads a cookie by name; the page and actions pass Next's cookie store in. */
export type CookieReader = (name: string) => string | undefined;

/** One cookie per signer, so a browser can hold several signing sessions at once. */
export const sessionCookieName = (signerId: string) => `msign_${signerId.replace(/-/g, '')}`;

function keyFor(purpose: string): Buffer {
  return createHmac('sha256', serverEnv().SUPABASE_SECRET_KEY).update(purpose).digest();
}

/** A keyed hash, bound to the signer, so a leaked table reveals no codes or sessions. */
function codeHash(signerId: string, code: string): string {
  return createHmac('sha256', keyFor('meroidea:esign-code:v1'))
    .update(`${signerId}:${code}`)
    .digest('hex');
}

function sessionHash(signerId: string, secret: string): string {
  return createHmac('sha256', keyFor('meroidea:esign-session:v1'))
    .update(`${signerId}:${secret}`)
    .digest('hex');
}

function sameHex(a: string | null, b: string): boolean {
  if (!a || a.length !== b.length) return false;
  return timingSafeEqual(Buffer.from(a, 'hex'), Buffer.from(b, 'hex'));
}

async function findByToken(db: Db | Tx, token: string, lock = false) {
  const query = db
    .select({
      signer: signRequestSigners,
      request: signRequests,
      businessName: tenants.name,
      businessColor: tenants.primaryColor,
      timezone: tenants.timezone,
    })
    .from(signRequestSigners)
    .innerJoin(
      signRequests,
      and(
        eq(signRequests.tenantId, signRequestSigners.tenantId),
        eq(signRequests.id, signRequestSigners.requestId),
      ),
    )
    .innerJoin(tenants, eq(tenants.id, signRequestSigners.tenantId))
    .where(
      and(
        eq(signRequestSigners.tokenHash, hashLinkToken(token)),
        isNull(signRequests.deletedAt),
        ne(signRequests.status, 'draft'),
        // A closed business, or one whose document library is off, takes no signatures.
        inArray(tenants.status, [...OPEN_TENANT_STATUSES]),
        sql`'files' = any(${tenants.features})`,
      ),
    )
    .limit(1);
  const [row] = await (lock
    ? query.for('update', { of: [signRequestSigners, signRequests] })
    : query);
  if (!row || !row.signer.tokenExpiresAt || row.signer.tokenExpiresAt < new Date()) return null;
  return row;
}

type Found = NonNullable<Awaited<ReturnType<typeof findByToken>>>;

const isExpired = (request: Found['request']) =>
  request.status === 'sent' && request.expiresAt !== null && request.expiresAt <= new Date();

/** Whether this browser may see the document: always without a code check, else a live session. */
function hasAccess(row: Found, readCookie: CookieReader): boolean {
  if (!row.request.verifyEmail) return true;
  const secret = readCookie(sessionCookieName(row.signer.id));
  const fresh =
    row.signer.verifiedAt !== null &&
    row.signer.verifiedAt.getTime() > Date.now() - SESSION_HOURS * 3_600_000;
  return (
    Boolean(secret) && fresh && sameHex(row.signer.sessionHash, sessionHash(row.signer.id, secret!))
  );
}

function signerEvent(
  tx: Db | Tx,
  row: Found,
  name: 'code_sent' | 'verified' | 'viewed' | 'signed' | 'declined' | 'completed' | 'invited',
  meta: RequestMeta | null,
  signerId: string | null = row.signer.id,
) {
  return tx.insert(signRequestEvents).values({
    tenantId: row.request.tenantId,
    requestId: row.request.id,
    signerId,
    event: name,
    ip: meta?.ip ?? null,
    userAgent: meta?.userAgent?.slice(0, 300) ?? null,
  });
}

function auditRow(tx: Tx, row: Found, action: string, meta: RequestMeta) {
  return tx.insert(auditLogs).values({
    tenantId: row.request.tenantId,
    actorUserId: null,
    actorType: 'signer_link',
    action,
    entityType: 'sign_request',
    entityId: row.request.id,
    context: { signerId: row.signer.id },
    ip: meta.ip,
    userAgent: meta.userAgent?.slice(0, 300) ?? null,
  });
}

async function signersOf(db: Db | Tx, row: Found) {
  return db
    .select({
      id: signRequestSigners.id,
      position: signRequestSigners.position,
      name: signRequestSigners.name,
      email: signRequestSigners.email,
      status: signRequestSigners.status,
      verifiedAt: signRequestSigners.verifiedAt,
      signedAt: signRequestSigners.signedAt,
      signedIp: signRequestSigners.signedIp,
      signedUserAgent: signRequestSigners.signedUserAgent,
    })
    .from(signRequestSigners)
    .where(
      and(
        eq(signRequestSigners.tenantId, row.request.tenantId),
        eq(signRequestSigners.requestId, row.request.id),
      ),
    )
    .orderBy(asc(signRequestSigners.position));
}

async function senderOf(db: Db | Tx, row: Found) {
  if (!row.request.sentBy) return { name: row.businessName, email: null };
  const [sender] = await db
    .select({ name: users.fullName, email: users.email })
    .from(users)
    .where(eq(users.id, row.request.sentBy))
    .limit(1);
  return { name: sender?.name || row.businessName, email: sender?.email ?? null };
}

const firstName = (name: string) => name.split(/\s+/)[0] ?? name;

export async function getSigningView(
  token: string,
  readCookie: CookieReader,
  meta: RequestMeta,
): Promise<SigningView | null> {
  const db = adminDb();
  const row = await findByToken(db, token);
  if (!row) return null;
  const { request, signer } = row;
  const signers = await signersOf(db, row);
  const sender = await senderOf(db, row);
  const access = hasAccess(row, readCookie);
  const expired = isExpired(request);
  const waiting = waitingOn(signers, signer.id, request.signingOrder as 'sequential');
  const canSign =
    access && request.status === 'sent' && !expired && signer.status === 'pending' && !waiting;

  const fields = canSign
    ? await db
        .select({
          id: signRequestFields.id,
          kind: signRequestFields.kind,
          page: signRequestFields.page,
          x: signRequestFields.x,
          y: signRequestFields.y,
          width: signRequestFields.width,
          height: signRequestFields.height,
          required: signRequestFields.required,
          label: signRequestFields.label,
        })
        .from(signRequestFields)
        .where(
          and(
            eq(signRequestFields.tenantId, request.tenantId),
            eq(signRequestFields.signerId, signer.id),
          ),
        )
        .orderBy(asc(signRequestFields.page), asc(signRequestFields.y))
    : [];

  if (access && !signer.viewedAt && request.status === 'sent' && !expired) {
    await db.transaction(async (tx) => {
      await tx
        .update(signRequestSigners)
        .set({ viewedAt: new Date() })
        .where(eq(signRequestSigners.id, signer.id));
      await signerEvent(tx, row, 'viewed', meta);
    });
  }

  return {
    businessName: row.businessName,
    timezone: row.timezone,
    title: request.title,
    message: request.message,
    senderName: sender.name,
    signerName: signer.name,
    maskedEmail: maskEmail(signer.email),
    requestStatus: request.status as SignRequestStatus,
    expired,
    expiresAt: request.expiresAt,
    signerStatus: signer.status as SignerStatus,
    signedAt: signer.signedAt,
    needsCode: !access,
    waitingFor: waiting ? firstName(waiting.name) : null,
    pageCount: request.pageCount ?? 0,
    fields: fields.map((field) => ({ ...field, kind: field.kind as FieldKind })),
    progress: {
      signed: signers.filter((candidate) => candidate.status === 'signed').length,
      total: signers.length,
    },
  };
}

/** Emails a fresh 6-digit code to the invited address. Limited per signer and per sender. */
export async function sendSigningCode(token: string, meta: RequestMeta): Promise<void> {
  const db = adminDb();
  const row = await findByToken(db, token);
  if (!row || !row.request.verifyEmail) throw new AppError('NOT_FOUND', GONE);
  if (
    row.request.status === 'declined' ||
    row.request.status === 'voided' ||
    isExpired(row.request)
  ) {
    throw new AppError('NOT_FOUND', GONE);
  }
  await enforceRateLimit(
    { bucket: `esign-code:${row.signer.id}`, subject: null, limit: 5, windowSeconds: 3600 },
    'Too many codes asked for. Wait an hour, then try again.',
  );
  await enforceRateLimit(
    { bucket: 'esign-code', subject: meta.ip, limit: 30, windowSeconds: 3600 },
    'Too many codes asked for from this connection. Try again later.',
  );

  const code = randomInt(0, 1_000_000).toString().padStart(6, '0');
  await db.transaction(async (tx) => {
    await tx
      .update(signRequestSigners)
      .set({
        otpHash: codeHash(row.signer.id, code),
        otpExpiresAt: new Date(Date.now() + CODE_MINUTES * 60_000),
        otpAttempts: 0,
      })
      .where(eq(signRequestSigners.id, row.signer.id));
    await signerEvent(tx, row, 'code_sent', meta);
  });

  const result = await sendEmail({
    to: row.signer.email,
    ...codeEmail({
      business: { name: row.businessName, color: row.businessColor },
      code,
      title: row.request.title,
    }),
  });
  if (!result.sent) {
    throw new AppError('INTERNAL', 'The code could not be emailed. Try again in a few minutes.');
  }
}

/**
 * Checks a code. The right one opens a session tied to this browser by a cookie; five wrong ones
 * spend the code, so guessing all million needs a fresh code (and email) every five tries.
 */
export async function verifySigningCode(
  token: string,
  code: string,
  meta: RequestMeta,
): Promise<{ cookieName: string; secret: string }> {
  await enforceRateLimit(
    { bucket: 'esign-verify', subject: meta.ip, limit: 60, windowSeconds: 3600 },
    'Too many tries from this connection. Try again later.',
  );
  const outcome = await adminDb().transaction(async (tx) => {
    const row = await findByToken(tx, token, true);
    if (!row || !row.request.verifyEmail) throw new AppError('NOT_FOUND', GONE);
    const { signer } = row;
    if (!signer.otpHash || !signer.otpExpiresAt || signer.otpExpiresAt < new Date()) {
      return { ok: false as const, message: 'That code has expired. Ask for a new one.' };
    }
    if (!sameHex(signer.otpHash, codeHash(signer.id, code))) {
      const attempts = signer.otpAttempts + 1;
      const spent = attempts >= MAX_CODE_TRIES;
      await tx
        .update(signRequestSigners)
        .set(
          spent ? { otpAttempts: 0, otpHash: null, otpExpiresAt: null } : { otpAttempts: attempts },
        )
        .where(eq(signRequestSigners.id, signer.id));
      return {
        ok: false as const,
        message: spent
          ? 'Too many wrong codes. Ask for a new one.'
          : `That code is not right. ${MAX_CODE_TRIES - attempts} ${
              MAX_CODE_TRIES - attempts === 1 ? 'try' : 'tries'
            } left.`,
      };
    }

    const secret = randomBytes(32).toString('base64url');
    await tx
      .update(signRequestSigners)
      .set({
        otpHash: null,
        otpExpiresAt: null,
        otpAttempts: 0,
        sessionHash: sessionHash(signer.id, secret),
        verifiedAt: new Date(),
      })
      .where(eq(signRequestSigners.id, signer.id));
    await signerEvent(tx, row, 'verified', meta);
    return { ok: true as const, cookieName: sessionCookieName(signer.id), secret };
  });
  // Wrong codes are counted in the committed transaction above, then reported.
  if (!outcome.ok) throw new AppError('VALIDATION', outcome.message, { code: [outcome.message] });
  return { cookieName: outcome.cookieName, secret: outcome.secret };
}

const BASE64 = /^[A-Za-z0-9+/]+={0,2}$/;

function decodePng(value: string, what: string): Buffer {
  const bytes = BASE64.test(value) ? Buffer.from(value, 'base64') : Buffer.alloc(0);
  const size = pngSize(bytes);
  if (!size || bytes.length > MAX_SIGNATURE_BYTES || size.width > 4000 || size.height > 4000) {
    throw new AppError('VALIDATION', `Your ${what} could not be read. Draw or type it again.`);
  }
  return bytes;
}

function signedOnText(timezone: string, date: Date): string {
  return new Intl.DateTimeFormat('en-AU', {
    timeZone: timezone,
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  }).format(date);
}

const EVENT_TEXT: Record<string, (name: string | null) => string> = {
  created: () => 'Request created',
  sent: () => 'Sent for signature',
  invited: (name) => `Signing link sent to ${name ?? 'a signer'}`,
  code_sent: (name) => `One-time code emailed to ${name ?? 'a signer'}`,
  verified: (name) => `${name ?? 'A signer'} entered the right code`,
  viewed: (name) => `${name ?? 'A signer'} opened the document`,
  signed: (name) => `${name ?? 'A signer'} signed`,
  completed: () => 'Completed: everyone has signed',
};

type Delivery = {
  to: string;
  message: { subject: string; html: string; text: string };
  fromName?: string;
};

/**
 * Records a signer's signature. The values are checked against their own fields; the signature
 * images are checked to be PNGs. When this is the last signature, the signed file is built and
 * stored in the same transaction: if that fails, the signature is not recorded either, so a
 * request is never left signed by everyone but unfinished.
 */
export async function submitSignature(
  input: SubmitSignatureInput,
  readCookie: CookieReader,
  meta: RequestMeta,
): Promise<{ completed: boolean }> {
  const signature = decodePng(input.signature, 'signature');
  const initials = input.initials ? decodePng(input.initials, 'initials') : null;
  const stored: string[] = [];
  const appUrl = serverEnv().APP_URL;

  try {
    const outcome = await adminDb().transaction(async (tx) => {
      const row = await findByToken(tx, input.token, true);
      if (!row) throw new AppError('NOT_FOUND', GONE);
      const { request, signer } = row;
      if (!hasAccess(row, readCookie)) {
        throw new AppError('UNAUTHENTICATED', 'Enter the code we emailed you first.');
      }
      if (request.status !== 'sent' || isExpired(request)) throw new AppError('NOT_FOUND', GONE);
      if (signer.status !== 'pending') {
        throw new AppError('CONFLICT', 'You have already answered this request.');
      }
      const signers = await signersOf(tx, row);
      if (waitingOn(signers, signer.id, request.signingOrder as 'sequential')) {
        throw new AppError('CONFLICT', 'It is not your turn to sign yet.');
      }

      const fields = await tx
        .select({
          id: signRequestFields.id,
          kind: signRequestFields.kind,
          required: signRequestFields.required,
        })
        .from(signRequestFields)
        .where(
          and(
            eq(signRequestFields.tenantId, request.tenantId),
            eq(signRequestFields.signerId, signer.id),
          ),
        );

      const folder = `${request.tenantId}/esign/${request.id}/${signer.id}`;
      const signaturePath = `${folder}/signature-${randomUUID()}.png`;
      const hasInitials = fields.some((field) => field.kind === 'initials');
      const initialsPath =
        hasInitials && initials ? `${folder}/initials-${randomUUID()}.png` : null;
      const now = new Date();
      const resolved = resolveFieldValues(
        fields.map((field) => ({ ...field, kind: field.kind as FieldKind })),
        input.values,
        { signedOn: signedOnText(row.timezone, now), signaturePath, initialsPath },
      );
      if ('error' in resolved) throw new AppError('VALIDATION', resolved.error);

      await writeObject(signaturePath, signature, 'image/png');
      stored.push(signaturePath);
      if (initialsPath && initials) {
        await writeObject(initialsPath, initials, 'image/png');
        stored.push(initialsPath);
      }

      for (const [fieldId, value] of resolved.values) {
        await tx
          .update(signRequestFields)
          .set({ value, filledAt: now })
          .where(
            and(
              eq(signRequestFields.tenantId, request.tenantId),
              eq(signRequestFields.id, fieldId),
            ),
          );
      }
      await tx
        .update(signRequestSigners)
        .set({
          status: 'signed',
          signedAt: now,
          signedIp: meta.ip,
          signedUserAgent: meta.userAgent?.slice(0, 300) ?? null,
        })
        .where(eq(signRequestSigners.id, signer.id));
      await signerEvent(tx, row, 'signed', meta);
      await auditRow(tx, row, 'sign', meta);

      const after = signers.map((candidate) =>
        candidate.id === signer.id
          ? {
              ...candidate,
              status: 'signed',
              signedAt: now,
              signedIp: meta.ip,
              signedUserAgent: meta.userAgent?.slice(0, 300) ?? null,
            }
          : candidate,
      );
      const sender = await senderOf(tx, row);
      const business = { name: row.businessName, color: row.businessColor };
      const requestLink = `${appUrl}/documents/signatures/${request.id}`;
      const deliveries: Delivery[] = [];

      if (after.some((candidate) => candidate.status !== 'signed')) {
        // Sequential: the next person's turn has come, so they get their link now.
        if (request.signingOrder === 'sequential') {
          for (const next of signersWhoseTurnItIs(after, 'sequential')) {
            const { token, hash } = createLinkToken();
            await tx
              .update(signRequestSigners)
              .set({
                tokenHash: hash,
                tokenExpiresAt: request.expiresAt ?? new Date(now.getTime() + OPEN_LINK_DAYS * DAY),
                invitedAt: now,
              })
              .where(eq(signRequestSigners.id, next.id));
            await signerEvent(tx, row, 'invited', null, next.id);
            deliveries.push({
              to: next.email,
              fromName: `${sender.name} at ${row.businessName}`,
              message: invitationEmail({
                business,
                senderName: sender.name,
                signerName: next.name,
                title: request.title,
                message: request.message,
                link: `${appUrl}/sign/${token}`,
                expiresAt: request.expiresAt,
                timezone: row.timezone,
              }),
            });
          }
        }
        if (sender.email) {
          deliveries.push({
            to: sender.email,
            message: signedNoticeEmail({
              business,
              signerName: signer.name,
              title: request.title,
              remaining: after.filter((candidate) => candidate.status !== 'signed').length,
              link: requestLink,
            }),
          });
        }
        return { completed: false, deliveries };
      }

      // Everyone has signed: build the signed file now, inside this transaction.
      const signedPath = await finalize(tx, row, after, sender.name, now, stored);
      await tx
        .update(signRequests)
        .set({ status: 'completed', completedAt: now, ...signedPath })
        .where(eq(signRequests.id, request.id));
      await signerEvent(tx, row, 'completed', null, null);

      // Everyone gets a link to download their copy. The person signing now keeps theirs; the
      // others get a fresh one, because only the hash of their earlier link was ever kept.
      const downloadUntil = new Date(now.getTime() + DOWNLOAD_DAYS * DAY);
      for (const candidate of after) {
        let token = input.token;
        if (candidate.id !== signer.id) {
          const fresh = createLinkToken();
          token = fresh.token;
          await tx
            .update(signRequestSigners)
            .set({ tokenHash: fresh.hash, tokenExpiresAt: downloadUntil })
            .where(eq(signRequestSigners.id, candidate.id));
        } else {
          await tx
            .update(signRequestSigners)
            .set({ tokenExpiresAt: downloadUntil })
            .where(eq(signRequestSigners.id, candidate.id));
        }
        deliveries.push({
          to: candidate.email,
          message: completedEmail({
            business,
            title: request.title,
            link: `${appUrl}/sign/${token}`,
            forSender: false,
          }),
        });
      }
      if (sender.email && !after.some((candidate) => candidate.email === sender.email)) {
        deliveries.push({
          to: sender.email,
          message: completedEmail({
            business,
            title: request.title,
            link: requestLink,
            forSender: true,
          }),
        });
      }
      return { completed: true, deliveries };
    });

    // After the commit, so a mail problem can never undo a signature.
    for (const delivery of outcome.deliveries) {
      await sendEmail({ to: delivery.to, fromName: delivery.fromName, ...delivery.message });
    }
    return { completed: outcome.completed };
  } catch (error) {
    for (const path of stored) await removeObject(path).catch(() => undefined);
    throw error;
  }
}

async function finalize(
  tx: Tx,
  row: Found,
  signers: Awaited<ReturnType<typeof signersOf>>,
  senderName: string,
  completedAt: Date,
  stored: string[],
): Promise<{ signedStoragePath: string; signedSha256: string }> {
  const { request } = row;
  if (!request.originalSha256) throw new AppError('INTERNAL', 'The request has no fingerprint.');
  const original = await readObject(request.originalStoragePath);
  if (!original) throw new AppError('INTERNAL', 'The document’s file could not be found.');

  const fields = await tx
    .select({
      signerId: signRequestFields.signerId,
      kind: signRequestFields.kind,
      page: signRequestFields.page,
      x: signRequestFields.x,
      y: signRequestFields.y,
      width: signRequestFields.width,
      height: signRequestFields.height,
      value: signRequestFields.value,
    })
    .from(signRequestFields)
    .where(
      and(
        eq(signRequestFields.tenantId, request.tenantId),
        eq(signRequestFields.requestId, request.id),
      ),
    );

  const images = new Map<string, Uint8Array>();
  const imageOf = async (path: string | null) => {
    // Only paths this request's own signers stored are ever read back.
    if (!path || !path.startsWith(`${request.tenantId}/esign/${request.id}/`)) return null;
    if (!images.has(path)) {
      const bytes = await readObject(path);
      if (!bytes) throw new AppError('INTERNAL', 'A signature image is missing.');
      images.set(path, bytes);
    }
    return images.get(path) ?? null;
  };

  const stampFields = [];
  const firstSignature = new Map<string, Uint8Array>();
  for (const field of fields) {
    const kind = field.kind as FieldKind;
    const isImage = kind === 'signature' || kind === 'initials';
    const image = isImage ? await imageOf(field.value) : null;
    if (kind === 'signature' && image && !firstSignature.has(field.signerId)) {
      firstSignature.set(field.signerId, image);
    }
    stampFields.push({
      kind,
      page: field.page,
      box: { x: field.x, y: field.y, width: field.width, height: field.height },
      value: isImage ? null : field.value,
      image,
    });
  }

  const eventRows = await tx
    .select({
      event: signRequestEvents.event,
      signerName: signRequestSigners.name,
      createdAt: signRequestEvents.createdAt,
    })
    .from(signRequestEvents)
    .leftJoin(
      signRequestSigners,
      and(
        eq(signRequestSigners.tenantId, signRequestEvents.tenantId),
        eq(signRequestSigners.id, signRequestEvents.signerId),
      ),
    )
    .where(
      and(
        eq(signRequestEvents.tenantId, request.tenantId),
        eq(signRequestEvents.requestId, request.id),
      ),
    )
    .orderBy(asc(signRequestEvents.createdAt));
  const events: CertificateEvent[] = eventRows
    .filter((entry) => EVENT_TEXT[entry.event])
    .map((entry) => ({ at: entry.createdAt, text: EVENT_TEXT[entry.event]!(entry.signerName) }));
  events.push({ at: completedAt, text: EVENT_TEXT.completed!(null) });

  const result = await stampSignedPdf({
    original,
    expectedSha256: request.originalSha256,
    fields: stampFields,
    certificate: {
      requestId: request.id,
      title: request.title,
      businessName: row.businessName,
      senderName,
      timezone: row.timezone,
      sentAt: request.sentAt ?? completedAt,
      completedAt,
      signers: signers.map((candidate) => ({
        name: candidate.name,
        email: candidate.email,
        verifiedByCode: request.verifyEmail,
        signedAt: candidate.signedAt ?? completedAt,
        ip: candidate.signedIp,
        userAgent: candidate.signedUserAgent,
        signature: firstSignature.get(candidate.id) ?? null,
      })),
      events,
      verifyUrl: `${serverEnv().APP_URL}/verify`,
    },
  });

  const signedStoragePath = `${request.tenantId}/esign/${request.id}/signed-${randomUUID()}.pdf`;
  await writeObject(signedStoragePath, Buffer.from(result.bytes), 'application/pdf');
  stored.push(signedStoragePath);
  return { signedStoragePath, signedSha256: result.sha256 };
}

/** A signer turns the request down; it closes for everyone and the sender is told why. */
export async function declineSigning(
  input: { token: string; reason: string },
  readCookie: CookieReader,
  meta: RequestMeta,
): Promise<void> {
  const notice = await adminDb().transaction(async (tx) => {
    const row = await findByToken(tx, input.token, true);
    if (!row) throw new AppError('NOT_FOUND', GONE);
    if (!hasAccess(row, readCookie)) {
      throw new AppError('UNAUTHENTICATED', 'Enter the code we emailed you first.');
    }
    if (row.request.status !== 'sent' || isExpired(row.request)) {
      throw new AppError('NOT_FOUND', GONE);
    }
    if (row.signer.status !== 'pending') {
      throw new AppError('CONFLICT', 'You have already answered this request.');
    }
    const now = new Date();
    await tx
      .update(signRequestSigners)
      .set({ status: 'declined', declinedAt: now, declineReason: input.reason })
      .where(eq(signRequestSigners.id, row.signer.id));
    await tx
      .update(signRequests)
      .set({ status: 'declined', declinedAt: now })
      .where(eq(signRequests.id, row.request.id));
    await signerEvent(tx, row, 'declined', meta);
    await auditRow(tx, row, 'decline', meta);
    return { row, sender: await senderOf(tx, row) };
  });

  if (notice.sender.email) {
    await sendEmail({
      to: notice.sender.email,
      ...declinedEmail({
        business: { name: notice.row.businessName, color: notice.row.businessColor },
        signerName: notice.row.signer.name,
        title: notice.row.request.title,
        reason: input.reason,
        link: `${serverEnv().APP_URL}/documents/signatures/${notice.row.request.id}`,
      }),
    });
  }
}

/**
 * The file a signer may see: the original while the request is out, the signed copy once it is
 * complete. Nothing for a declined or voided request, or without a code when one is needed.
 */
export async function readSignerDocument(
  token: string,
  readCookie: CookieReader,
): Promise<{ bytes: Buffer; fileName: string } | null> {
  const row = await findByToken(adminDb(), token);
  if (!row || !hasAccess(row, readCookie)) return null;
  const { request } = row;
  if (request.status === 'completed' && request.signedStoragePath) {
    const bytes = await readObject(request.signedStoragePath);
    return bytes ? { bytes, fileName: `${request.title} (signed).pdf` } : null;
  }
  if (request.status !== 'sent' || isExpired(request)) return null;
  const bytes = await readObject(request.originalStoragePath);
  return bytes ? { bytes, fileName: `${request.title}.pdf` } : null;
}

export type VerifiedDocument = {
  title: string;
  businessName: string;
  completedAt: Date;
  signers: { name: string; signedAt: Date | null }[];
};

/**
 * Looks a finished file up by its fingerprint. Only someone already holding the exact file can
 * produce it, so this shows them nothing the file's own certificate does not.
 */
export async function verifySignedDocument(
  sha256: string,
  meta: RequestMeta,
): Promise<VerifiedDocument | null> {
  await enforceRateLimit(
    { bucket: 'esign-verify-document', subject: meta.ip, limit: 30, windowSeconds: 3600 },
    'Too many checks from this connection. Try again later.',
  );
  const db = adminDb();
  const [found] = await db
    .select({
      id: signRequests.id,
      tenantId: signRequests.tenantId,
      title: signRequests.title,
      completedAt: signRequests.completedAt,
      businessName: tenants.name,
    })
    .from(signRequests)
    .innerJoin(tenants, eq(tenants.id, signRequests.tenantId))
    .where(and(eq(signRequests.signedSha256, sha256), eq(signRequests.status, 'completed')))
    .limit(1);
  if (!found?.completedAt) return null;
  const signers = await db
    .select({ name: signRequestSigners.name, signedAt: signRequestSigners.signedAt })
    .from(signRequestSigners)
    .where(
      and(
        eq(signRequestSigners.tenantId, found.tenantId),
        eq(signRequestSigners.requestId, found.id),
      ),
    )
    .orderBy(asc(signRequestSigners.position));
  return {
    title: found.title,
    businessName: found.businessName,
    completedAt: found.completedAt,
    signers,
  };
}
