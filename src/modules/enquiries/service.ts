import 'server-only';

import { desc, eq } from 'drizzle-orm';

import { websiteEnquiries } from '@/db/schema';
import { AppError } from '@/lib/errors';
import { adminDb } from '@/server/db/admin';
import type { PlatformAdmin } from '@/server/platform';

import type { EnquiryStatus } from './schemas';

/*
 * Website enquiries belong to the platform, not to any business, so platform owners read them on
 * the privileged connection. Every function takes the verified PlatformAdmin, which only
 * `requirePlatformAdmin()` / `assertPlatformAdmin()` produce (ADR-029).
 */

export type EnquiryRow = typeof websiteEnquiries.$inferSelect;

/** Newest first; capped, since the console is a working inbox rather than an archive. */
export async function listEnquiries(_admin: PlatformAdmin, limit = 200): Promise<EnquiryRow[]> {
  return adminDb()
    .select()
    .from(websiteEnquiries)
    .orderBy(desc(websiteEnquiries.createdAt))
    .limit(limit);
}

export async function setEnquiryStatus(
  admin: PlatformAdmin,
  id: string,
  status: EnquiryStatus,
): Promise<void> {
  const [updated] = await adminDb()
    .update(websiteEnquiries)
    .set({
      status,
      handledBy: status === 'new' ? null : admin.userId,
      handledAt: status === 'new' ? null : new Date(),
    })
    .where(eq(websiteEnquiries.id, id))
    .returning({ id: websiteEnquiries.id });
  if (!updated) throw new AppError('NOT_FOUND', 'That enquiry was not found.');
}
