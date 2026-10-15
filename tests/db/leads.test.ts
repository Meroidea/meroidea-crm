import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { AppError } from '@/lib/errors';
import { logActivity } from '@/modules/activities/service';
import { getContact } from '@/modules/contacts/queries';
import { createContactSchema } from '@/modules/contacts/schemas';
import { createContact } from '@/modules/contacts/service';
import { loadLeadConfig } from '@/modules/leads/config';
import {
  acceptHandoverSchema,
  directConvertSchema,
  handoverSchema,
  rejectHandoverSchema,
} from '@/modules/leads/schemas';
import {
  acceptHandover,
  assignLeads,
  convertLead,
  handoverLead,
  rejectHandover,
  setLeadStatus,
} from '@/modules/leads/service';
import type { TenantContext } from '@/server/context';
import { adminDb } from '@/server/db/admin';
import { withRls } from '@/server/db/with-rls';

import { addMember, contextFor, createWorkspace, destroyWorkspace } from '../support/workspaces';

/*
 * docs/leads.md: a lead is a contact being qualified. B2B leads are worked by an SDR/BDR, handed
 * to a sales rep who accepts (becoming the owner of the opportunity under an organization) or
 * returns them with a reason. B2C leads convert directly unless the business adds a step.
 */

const stamp = Date.now();
const mail = (name: string) => `${name}-${stamp}@example.com`;

let tenantId: string;
let otherTenant: string;
const users: string[] = [];
const otherUsers: string[] = [];
let admin: TenantContext;
let sdr: TenantContext;
let rep: TenantContext;
let bystander: TenantContext;
let outsider: TenantContext;
let marketingId: string;
let metaAdsId: string;
let manualId: string;

async function expectCode(run: () => Promise<unknown>, code: AppError['code']) {
  const error = await run().then(
    () => null,
    (caught: unknown) => caught,
  );
  expect(error).toBeInstanceOf(AppError);
  expect((error as AppError).code).toBe(code);
}

async function setCrm(crm: Record<string, unknown>) {
  await adminDb().execute(sql`
    update tenants set settings = jsonb_set(settings, '{crm}', ${JSON.stringify(crm)}::jsonb)
    where id = ${tenantId}`);
  admin = await contextFor(admin.userId, tenantId);
  sdr = await contextFor(sdr.userId, tenantId);
  rep = await contextFor(rep.userId, tenantId);
  bystander = await contextFor(bystander.userId, tenantId);
}

const lead = (overrides: Record<string, unknown> = {}) =>
  createContactSchema.parse({
    isLead: true,
    firstName: 'Avery',
    lastName: `Lead ${Math.random().toString(36).slice(2, 7)}`,
    email: `avery-${Math.random().toString(36).slice(2, 9)}@example.com`,
    sourceId: marketingId,
    subSourceId: metaAdsId,
    leadType: 'b2b',
    // Each lead its own company: the same name at one company is a duplicate (§3.4).
    companyName: `Example ${Math.random().toString(36).slice(2, 9)} Pty Ltd`,
    companyWebsite: 'https://www.example-company.com',
    jobTitle: 'Operations manager',
    interest: 'Annual service plan',
    ...overrides,
  });

const statusKind = async (ctx: TenantContext, contactId: string) => {
  const config = await withRls(ctx, (tx) => loadLeadConfig(tx, ctx));
  const rows = (await adminDb().execute(
    sql`select lead_status_id from contacts where id = ${contactId}`,
  )) as unknown as { lead_status_id: string }[];
  return config.statuses.find((status) => status.id === rows[0]?.lead_status_id)?.kind;
};

beforeAll(async () => {
  const one = await createWorkspace(`Leads Co ${stamp}`, mail('lead-admin'));
  tenantId = one.tenantId;
  users.push(one.ownerId);
  const two = await createWorkspace(`Other Co ${stamp}`, mail('lead-other'));
  otherTenant = two.tenantId;
  otherUsers.push(two.ownerId);

  const sdrId = await addMember(tenantId, mail('lead-sdr'), 'Sam SDR', 'member');
  const repId = await addMember(tenantId, mail('lead-rep'), 'Riley Rep', 'member');
  const bystanderId = await addMember(tenantId, mail('lead-by'), 'Blair Bystander', 'member');
  users.push(sdrId, repId, bystanderId);

  admin = await contextFor(one.ownerId, tenantId);
  sdr = await contextFor(sdrId, tenantId);
  rep = await contextFor(repId, tenantId);
  bystander = await contextFor(bystanderId, tenantId);
  outsider = await contextFor(two.ownerId, otherTenant);

  const config = await withRls(admin, (tx) => loadLeadConfig(tx, admin));
  const marketing = config.sources.find((source) => source.name === 'Marketing');
  const manual = config.sources.find((source) => source.name === 'Manual entry');
  marketingId = marketing!.id;
  metaAdsId = marketing!.subSources.find((sub) => sub.name.includes('Meta'))!.id;
  manualId = manual!.id;
});

afterAll(async () => {
  await destroyWorkspace(tenantId, users);
  await destroyWorkspace(otherTenant, otherUsers);
});

describe('capturing a lead', () => {
  it('needs a source, and the sub-source when that source has some', async () => {
    await expectCode(
      () => createContact(sdr, lead({ sourceId: '', subSourceId: '' })),
      'VALIDATION',
    );
    await expectCode(() => createContact(sdr, lead({ subSourceId: '' })), 'VALIDATION');
    const ok = await createContact(sdr, lead({ sourceId: manualId, subSourceId: '' }));
    expect(ok.id).toBeTruthy();
  });

  it('starts as New, owned by the person who added it', async () => {
    const { id } = await createContact(sdr, lead());
    expect(await statusKind(admin, id)).toBe('new');
    const detail = await getContact(sdr, id);
    expect(detail.ownerUserId).toBe(sdr.userId);
  });

  it('is not visible to another business or to a colleague with own scope', async () => {
    const { id } = await createContact(sdr, lead());
    await expectCode(() => getContact(outsider, id), 'NOT_FOUND');
    await expectCode(() => getContact(bystander, id), 'NOT_FOUND');
  });

  it('is shared out in turn by a round-robin routing rule, and the owner is notified', async () => {
    await adminDb().execute(sql`
      insert into routing_rules (tenant_id, name, stage, method, user_ids, conditions)
      values (${tenantId}, 'Meta ads', 'intake', 'round_robin',
        array[${sdr.userId}, ${rep.userId}]::uuid[],
        ${JSON.stringify({ subSourceIds: [metaAdsId] })}::jsonb)`);
    const owners: (string | null)[] = [];
    for (let i = 0; i < 4; i += 1) {
      const { id } = await createContact(admin, { ...lead(), assignment: 'auto' });
      owners.push((await getContact(admin, id)).ownerUserId);
    }
    expect(owners).toEqual([sdr.userId, rep.userId, sdr.userId, rep.userId]);
    const rows = (await adminDb().execute(sql`
      select count(*)::int as total from notifications
      where tenant_id = ${tenantId} and user_id = ${sdr.userId} and type = 'lead_assigned'`)) as unknown as {
      total: number;
    }[];
    expect(rows[0]?.total).toBeGreaterThanOrEqual(2);
    await adminDb().execute(sql`delete from routing_rules where tenant_id = ${tenantId}`);
  });

  it('moves from New to working when the first call is logged', async () => {
    const { id } = await createContact(sdr, lead());
    await logActivity(sdr, { type: 'call', body: 'Introduced ourselves', contactId: id });
    expect(await statusKind(admin, id)).toBe('working');
    const rows = (await adminDb().execute(
      sql`select first_contacted_at from contacts where id = ${id}`,
    )) as unknown as { first_contacted_at: Date | null }[];
    expect(rows[0]?.first_contacted_at).not.toBeNull();
  });

  it('needs a reason to disqualify', async () => {
    const { id } = await createContact(sdr, lead());
    const config = await withRls(admin, (tx) => loadLeadConfig(tx, admin));
    const disqualified = config.statuses.find((status) => status.name === 'Disqualified')!;
    await expectCode(
      () =>
        setLeadStatus(sdr, {
          contactId: id,
          statusId: disqualified.id,
          reasonId: null,
          note: null,
        }),
      'VALIDATION',
    );
    const reason = config.reasons.find((r) => r.kind === 'disqualify')!;
    await setLeadStatus(sdr, {
      contactId: id,
      statusId: disqualified.id,
      reasonId: reason.id,
      note: null,
    });
    expect(await statusKind(admin, id)).toBe('closed');
  });

  it('only lets someone with contacts.assign give leads to others', async () => {
    const { id } = await createContact(sdr, lead());
    await expectCode(
      () => assignLeads(sdr, { mode: 'person', contactIds: [id], ownerUserId: rep.userId }),
      'FORBIDDEN',
    );
    const result = await assignLeads(admin, {
      mode: 'person',
      contactIds: [id],
      ownerUserId: rep.userId,
    });
    expect(result.assigned).toBe(1);
  });
});

describe('B2B handover', () => {
  const handover = (contactId: string, toUserId: string) =>
    handoverSchema.parse({
      contactId,
      toUserId,
      summary: 'Wants a demo next week; budget approved for this quarter.',
    });

  it('requires the handover fields to be filled', async () => {
    const { id } = await createContact(sdr, lead({ jobTitle: '' }));
    await expectCode(() => handoverLead(sdr, handover(id, rep.userId)), 'VALIDATION');
  });

  it('shows the lead to the rep while pending, and the rep can return it with a reason', async () => {
    const { id } = await createContact(sdr, lead());
    await expectCode(() => getContact(rep, id), 'NOT_FOUND');
    await handoverLead(sdr, handover(id, rep.userId));
    expect(await statusKind(admin, id)).toBe('pending_acceptance');
    expect((await getContact(rep, id)).id).toBe(id);

    // Someone it was not handed to cannot answer it.
    const config = await withRls(admin, (tx) => loadLeadConfig(tx, admin));
    const reason = config.reasons.find((r) => r.kind === 'reject')!;
    await expectCode(
      () =>
        rejectHandover(
          bystander,
          rejectHandoverSchema.parse({ contactId: id, reasonId: reason.id }),
        ),
      'NOT_FOUND',
    );

    await rejectHandover(
      rep,
      rejectHandoverSchema.parse({ contactId: id, reasonId: reason.id, note: 'Not the buyer' }),
    );
    expect(await statusKind(admin, id)).toBe('returned');
    await expectCode(() => getContact(rep, id), 'NOT_FOUND');
    expect((await getContact(sdr, id)).id).toBe(id);
  });

  it('on acceptance creates the organization and an opportunity owned by the rep, crediting the SDR', async () => {
    const { id } = await createContact(
      sdr,
      lead({ companyName: `Acme ${stamp}`, companyWebsite: `https://acme-${stamp}.example.com` }),
    );
    await handoverLead(sdr, handover(id, rep.userId));
    const result = await acceptHandover(
      rep,
      acceptHandoverSchema.parse({
        contactId: id,
        opportunityName: 'Acme annual plan',
        organization: { mode: 'new', name: `Acme ${stamp}` },
        contactRole: 'Decision maker',
      }),
    );
    expect(await statusKind(admin, id)).toBe('converted');
    const rows = (await adminDb().execute(sql`
      select o.owner_user_id, o.originator_user_id, o.organization_id, o.source_id, o.sub_source_id,
             c.owner_user_id as contact_owner,
             (select count(*)::int from contact_organizations co where co.contact_id = c.id) as links
      from opportunities o join contacts c on c.id = o.contact_id
      where o.id = ${result.opportunityId}`)) as unknown as Record<string, unknown>[];
    expect(rows[0]).toMatchObject({
      owner_user_id: rep.userId,
      originator_user_id: sdr.userId,
      source_id: marketingId,
      sub_source_id: metaAdsId,
      contact_owner: rep.userId,
      links: 1,
    });
    expect(rows[0]?.organization_id).toBeTruthy();
  });

  it('offers the existing organization instead of creating a duplicate', async () => {
    const { id } = await createContact(
      sdr,
      lead({
        companyName: `Acme ${stamp}`,
        companyWebsite: `https://www.acme-${stamp}.example.com/about`,
      }),
    );
    await handoverLead(sdr, handover(id, rep.userId));
    await expectCode(
      () =>
        acceptHandover(
          rep,
          acceptHandoverSchema.parse({
            contactId: id,
            opportunityName: 'Acme expansion',
            organization: { mode: 'new', name: `Acme ${stamp}` },
          }),
        ),
      'DUPLICATE',
    );
  });
});

describe('B2C conversion', () => {
  it('converts directly to an opportunity with no organization', async () => {
    const { id } = await createContact(sdr, lead({ leadType: 'b2c', companyName: '' }));
    const result = await convertLead(
      sdr,
      directConvertSchema.parse({ contactId: id, opportunityName: 'Study abroad – 2027 intake' }),
    );
    expect(await statusKind(admin, id)).toBe('converted');
    const rows = (await adminDb().execute(sql`
      select organization_id, owner_user_id from opportunities where id = ${result.opportunityId}`)) as unknown as Record<
      string,
      unknown
    >[];
    expect(rows[0]).toMatchObject({ organization_id: null, owner_user_id: sdr.userId });
  });

  it('when the business asks for approval, converting is refused and the approver accepts instead', async () => {
    await setCrm({ b2cApproval: true });
    const { id } = await createContact(sdr, lead({ leadType: 'b2c' }));
    await expectCode(
      () =>
        convertLead(
          sdr,
          directConvertSchema.parse({ contactId: id, opportunityName: 'Rental application' }),
        ),
      'CONFLICT',
    );
    await handoverLead(
      sdr,
      handoverSchema.parse({
        contactId: id,
        toUserId: admin.userId,
        summary: 'Ready to apply; please approve.',
      }),
    );
    await acceptHandover(
      admin,
      acceptHandoverSchema.parse({ contactId: id, opportunityName: 'Rental application' }),
    );
    expect(await statusKind(admin, id)).toBe('converted');
    await setCrm({});
  });

  it('needs a second person who can approve: not yourself, and not someone without approval', async () => {
    await setCrm({ b2cApproval: true });
    const { id } = await createContact(sdr, lead({ leadType: 'b2c' }));
    const submit = (ctx: TenantContext, toUserId: string) =>
      handoverLead(
        ctx,
        handoverSchema.parse({ contactId: id, toUserId, summary: 'Please approve.' }),
      );
    // Naming yourself, then approving, would make the approval meaningless.
    await expectCode(() => submit(sdr, sdr.userId), 'VALIDATION');
    // A colleague who cannot approve opportunities cannot be the approver.
    await expectCode(() => submit(sdr, rep.userId), 'VALIDATION');
    await setCrm({});
  });
});

describe('outreach', () => {
  it('fills merge fields and leaves unknown ones empty', async () => {
    const { renderMergeFields } = await import('@/modules/outreach/service');
    expect(
      renderMergeFields(
        'Hi {{contact.first_name}} at {{ contact.company }} — {{user.name}}{{nope}}',
        {
          firstName: 'Avery',
          lastName: null,
          company: 'Example Pty Ltd',
          userName: 'Sam',
          businessName: 'Leads Co',
        },
      ),
    ).toBe('Hi Avery at Example Pty Ltd — Sam');
  });

  it('refuses to email someone who asked not to be emailed', async () => {
    const { sendContactEmail } = await import('@/modules/outreach/service');
    const { id } = await createContact(sdr, lead({ doNotEmail: true }));
    await expectCode(
      () =>
        sendContactEmail(sdr, { contactId: id, subject: 'Hello', body: 'Hi', templateId: null }),
      'CONFLICT',
    );
  });

  it('turns a sequence into dated tasks, and stopping it cancels the open ones', async () => {
    const { enrollInSequence, stopEnrollment } = await import('@/modules/outreach/service');
    const { saveSequence } = await import('@/modules/crm-config/service');
    const { id: sequenceId } = await saveSequence(admin, {
      name: `Welcome ${Math.random()}`,
      description: null,
      steps: [
        { id: 'a', day: 1, type: 'email', title: 'Intro', templateId: null },
        { id: 'b', day: 3, type: 'call', title: 'Call', templateId: null },
      ],
    });
    const { id } = await createContact(sdr, lead());
    const enrollment = await enrollInSequence(sdr, { contactId: id, sequenceId, assignedTo: null });
    const open = (await adminDb().execute(
      sql`select count(*)::int as total from tasks where sequence_enrollment_id = ${enrollment.id} and status = 'open'`,
    )) as unknown as { total: number }[];
    expect(open[0]?.total).toBe(2);
    await expectCode(
      () => enrollInSequence(sdr, { contactId: id, sequenceId, assignedTo: null }),
      'CONFLICT',
    );
    await stopEnrollment(sdr, enrollment.id);
    const cancelled = (await adminDb().execute(
      sql`select count(*)::int as total from tasks where sequence_enrollment_id = ${enrollment.id} and status = 'cancelled'`,
    )) as unknown as { total: number }[];
    expect(cancelled[0]?.total).toBe(2);
  });

  it('accepts only the business’s own call outcomes, and a call needs nothing more', async () => {
    const { id } = await createContact(sdr, lead());
    await expectCode(
      () => logActivity(sdr, { type: 'call', body: '', outcome: 'Made up', contactId: id }),
      'VALIDATION',
    );
    await logActivity(sdr, { type: 'call', body: '', outcome: 'Left voicemail', contactId: id });
  });
});
