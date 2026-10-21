import { randomBytes } from 'node:crypto';

import { eq, sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { websiteEnquiries } from '@/db/schema';
import { listEnquiries, setEnquiryStatus } from '@/modules/enquiries/service';
import type { TenantContext } from '@/server/context';
import { adminDb } from '@/server/db/admin';
import { withRls } from '@/server/db/with-rls';

import { contextFor, createWorkspace, destroyWorkspace } from '../support/workspaces';

/*
 * The website's "Let's talk" form: public, so it keeps a honeypot and a per-sender limit, and what
 * it collects belongs to the platform. No business user and no public key can read it.
 */

const request = vi.hoisted(() => ({ address: '198.51.100.40' }));
vi.mock('next/headers', () => ({
  headers: async () => new Headers({ 'x-real-ip': request.address }),
}));

const { submitEnquiryAction } = await import('@/modules/enquiries/actions');

const stamp = `${Date.now()}-${randomBytes(3).toString('hex')}`;
const owner = { userId: '00000000-0000-4000-8000-000000000001', email: 'owner@example.com' };
let tenantId: string;
const userIds: string[] = [];
let businessAdmin: TenantContext;

const enquiry = (overrides: Record<string, unknown> = {}) => ({
  name: 'Alex Morgan',
  email: `alex-${stamp}@example.com`,
  phone: '+61 400 555 010',
  company: `Harbour Cafe ${stamp}`,
  businessType: 'A cafe with two sites',
  teamSize: '11–50',
  message: 'We run rosters on paper and want one place for staff and suppliers.',
  website: '',
  ...overrides,
});

const byCompany = (company: string) =>
  adminDb().select().from(websiteEnquiries).where(eq(websiteEnquiries.company, company));

beforeAll(async () => {
  const workspace = await createWorkspace('Enquiry Bistro', `enquiry-${stamp}@example.com`);
  tenantId = workspace.tenantId;
  userIds.push(workspace.ownerId);
  businessAdmin = await contextFor(workspace.ownerId, tenantId);
});

afterAll(async () => {
  await adminDb().execute(sql`delete from website_enquiries where company like ${`%${stamp}%`}`);
  await destroyWorkspace(tenantId, userIds);
});

describe('website enquiries', () => {
  it('saves a message from the contact form, cleaned up and marked new', async () => {
    request.address = '198.51.100.41';
    const result = await submitEnquiryAction(
      enquiry({ email: `  ALEX-${stamp}@Example.com `, phone: '' }),
    );
    expect(result.ok).toBe(true);
    const [saved] = await byCompany(`Harbour Cafe ${stamp}`);
    expect(saved?.email).toBe(`alex-${stamp}@example.com`);
    expect(saved?.phone).toBeNull();
    expect(saved?.status).toBe('new');
  });

  it('quietly drops a submission that filled the hidden honeypot', async () => {
    request.address = '198.51.100.42';
    const company = `Bot Corp ${stamp}`;
    const result = await submitEnquiryAction(enquiry({ company, website: 'http://spam.example' }));
    // Answered like any other, so the bot learns nothing, but never stored.
    expect(result.ok).toBe(true);
    expect(await byCompany(company)).toHaveLength(0);
  });

  it('rejects a message with a missing email or a too-short message', async () => {
    const result = await submitEnquiryAction(enquiry({ email: 'not-an-email', message: 'hi' }));
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(Object.keys(result.error.fieldErrors ?? {}).sort()).toEqual(['email', 'message']);
    }
  });

  it('limits how many messages one sender can send in an hour', async () => {
    request.address = `203.0.113.${Math.floor(Math.random() * 200) + 1}`;
    const codes: string[] = [];
    for (let attempt = 0; attempt < 4; attempt += 1) {
      const result = await submitEnquiryAction(enquiry({ company: `Flood ${attempt} ${stamp}` }));
      codes.push(result.ok ? 'OK' : result.error.code);
    }
    expect(codes).toEqual(['OK', 'OK', 'OK', 'RATE_LIMITED']);
  });

  it('a business user cannot read enquiries, even writing SQL directly', async () => {
    const error = await withRls(businessAdmin, (tx) =>
      tx.execute(sql`select id from website_enquiries limit 1`),
    ).then(
      () => null,
      (caught: unknown) => caught,
    );
    expect(error).not.toBeNull();
  });

  it('the public API role has no access to the table', async () => {
    const [grants] = (await adminDb().execute(sql`
      select has_table_privilege('anon', 'website_enquiries', 'select') as anon_select,
             has_table_privilege('authenticated', 'website_enquiries', 'select') as user_select,
             has_table_privilege('anon', 'website_enquiries', 'insert') as anon_insert`)) as unknown as {
      anon_select: boolean;
      user_select: boolean;
      anon_insert: boolean;
    }[];
    expect(grants).toEqual({ anon_select: false, user_select: false, anon_insert: false });
  });

  it('a platform owner lists enquiries and marks one contacted', async () => {
    const [saved] = await byCompany(`Harbour Cafe ${stamp}`);
    expect(saved).toBeDefined();
    const listed = await listEnquiries(owner);
    expect(listed.some((row) => row.id === saved!.id)).toBe(true);

    await setEnquiryStatus(owner, saved!.id, 'contacted');
    const [after] = await byCompany(`Harbour Cafe ${stamp}`);
    expect(after?.status).toBe('contacted');
    expect(after?.handledBy).toBe(owner.userId);
    expect(after?.handledAt).not.toBeNull();
  });
});
