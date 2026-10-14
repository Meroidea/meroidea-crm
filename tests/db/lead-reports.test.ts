import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { GET as cronLeadAlerts } from '@/app/api/cron/lead-alerts/route';
import { AppError } from '@/lib/errors';
import { logActivity } from '@/modules/activities/service';
import { logActivitySchema } from '@/modules/activities/schemas';
import { createContactSchema } from '@/modules/contacts/schemas';
import { createContact } from '@/modules/contacts/service';
import { loadLeadConfig } from '@/modules/leads/config';
import { exportLeads } from '@/modules/leads/export';
import {
  acceptHandoverSchema,
  handoverSchema,
  leadQueueFiltersSchema,
  rejectHandoverSchema,
} from '@/modules/leads/schemas';
import { acceptHandover, handoverLead, rejectHandover } from '@/modules/leads/service';
import { sendPendingAlertEmails, sweepTenant } from '@/modules/notifications/alerts';
import { getLeadReports } from '@/modules/reports/lead-queries';
import type { TenantContext } from '@/server/context';
import { adminDb } from '@/server/db/admin';
import { withRls } from '@/server/db/with-rls';

import { addMember, contextFor, createWorkspace, destroyWorkspace } from '../support/workspaces';

/*
 * docs/leads.md §5 and §7: lead reports by source, person and reason; SLA alerts that land once;
 * and the leads export, all within the viewer's scope and business.
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
let outsider: TenantContext;
let sourceId: string;
let subSourceId: string;
let rejectReasonId: string;

async function expectCode(run: () => Promise<unknown>, code: AppError['code']) {
  const error = await run().then(
    () => null,
    (caught: unknown) => caught,
  );
  expect(error).toBeInstanceOf(AppError);
  expect((error as AppError).code).toBe(code);
}

const lead = (ctx: TenantContext, overrides: Record<string, unknown> = {}) =>
  createContact(
    ctx,
    createContactSchema.parse({
      isLead: true,
      firstName: 'Lee',
      lastName: `Report ${Math.random().toString(36).slice(2, 7)}`,
      email: `lee-${Math.random().toString(36).slice(2, 9)}@example.com`,
      sourceId,
      subSourceId,
      leadType: 'b2b',
      companyName: 'Example Pty Ltd',
      jobTitle: 'Manager',
      interest: 'Annual plan',
      ...overrides,
    }),
  );

const handover = (contactId: string) =>
  handoverLead(
    sdr,
    handoverSchema.parse({ contactId, toUserId: rep.userId, summary: 'Ready for a proposal now.' }),
  );

const notices = async (userId: string, type: string) =>
  (await adminDb().execute(
    sql`select dedupe_key, emailed_at from notifications
        where tenant_id = ${tenantId} and user_id = ${userId} and type = ${type}`,
  )) as unknown as { dedupe_key: string; emailed_at: Date | null }[];

beforeAll(async () => {
  const one = await createWorkspace(`Report Co ${stamp}`, mail('rep-admin'));
  tenantId = one.tenantId;
  users.push(one.ownerId);
  const two = await createWorkspace(`Report Other ${stamp}`, mail('rep-other'));
  otherTenant = two.tenantId;
  otherUsers.push(two.ownerId);
  const sdrId = await addMember(tenantId, mail('rep-sdr'), 'Sasha SDR', 'member');
  const repId = await addMember(tenantId, mail('rep-rep'), 'Robin Rep', 'member');
  users.push(sdrId, repId);
  admin = await contextFor(one.ownerId, tenantId);
  sdr = await contextFor(sdrId, tenantId);
  rep = await contextFor(repId, tenantId);
  outsider = await contextFor(two.ownerId, otherTenant);

  const config = await withRls(admin, (tx) => loadLeadConfig(tx, admin));
  const source = config.sources.find((candidate) => candidate.subSources.length > 0)!;
  sourceId = source.id;
  subSourceId = source.subSources[0]!.id;
  rejectReasonId = config.reasons.find((reason) => reason.kind === 'reject')!.id;

  // Three leads by the SDR: one only captured, one contacted then returned, one accepted.
  await lead(sdr);
  const returned = await lead(sdr);
  await logActivity(
    sdr,
    logActivitySchema.parse({
      type: 'call',
      direction: 'outbound',
      contactId: returned.id,
      body: 'Intro call',
    }),
  );
  await handover(returned.id);
  await rejectHandover(
    rep,
    rejectHandoverSchema.parse({ contactId: returned.id, reasonId: rejectReasonId }),
  );
  const accepted = await lead(sdr);
  await handover(accepted.id);
  await acceptHandover(
    rep,
    acceptHandoverSchema.parse({
      contactId: accepted.id,
      opportunityName: 'Report deal',
      organization: { mode: 'new', name: `Report Org ${stamp}` },
    }),
  );
});

afterAll(async () => {
  await destroyWorkspace(tenantId, users);
  await destroyWorkspace(otherTenant, otherUsers);
});

describe('lead reports', () => {
  it('counts leads by source, the SDR’s work and the rep’s decisions', async () => {
    const report = await getLeadReports(admin, 30);
    const row = report.bySource.find((item) => item.subSource !== null)!;
    expect(row).toMatchObject({ created: 3, contacted: 1, qualified: 2, converted: 1 });
    expect(report.funnel.map((step) => step.count)).toEqual([3, 1, 2, 1, 0]);

    const sasha = report.sdr.find((item) => item.name === 'Sasha SDR')!;
    expect(sasha).toMatchObject({ leads: 3, handedOver: 2, accepted: 1, rejected: 1 });
    const robin = report.reps.find((item) => item.name === 'Robin Rep')!;
    expect(robin).toMatchObject({ received: 2, accepted: 1, rejected: 1, waiting: 0 });
    expect(report.rejectReasons.reduce((sum, item) => sum + item.count, 0)).toBe(1);
  });

  it('keeps to the viewer’s scope and business', async () => {
    const mine = await getLeadReports(rep, 30);
    // The rep owns the accepted lead now; the returned one went back to the SDR.
    expect(mine.bySource.reduce((sum, item) => sum + item.created, 0)).toBe(1);
    const theirs = await getLeadReports(outsider, 30);
    expect(theirs.bySource).toEqual([]);
    expect(theirs.owners).toEqual([]);
  });
});

describe('SLA alerts', () => {
  it('flags unassigned and uncontacted leads once, however often the sweep runs', async () => {
    const queued = await lead(admin, { assignment: 'queue' });
    const waiting = await lead(sdr);
    await adminDb().execute(sql`
      update contacts set created_at = now() - interval '3 days', assigned_at = now() - interval '3 days'
      where id in (${queued.id}, ${waiting.id})`);

    await sweepTenant(tenantId);
    await sweepTenant(tenantId);

    expect(await notices(admin.userId, 'lead_unassigned')).toHaveLength(1);
    const overdue = (await notices(sdr.userId, 'first_contact_overdue')).filter((row) =>
      row.dedupe_key.endsWith(waiting.id),
    );
    expect(overdue).toHaveLength(1);
    // Nobody in another business hears about it.
    const elsewhere = (await adminDb().execute(
      sql`select count(*)::int as total from notifications where tenant_id = ${otherTenant}`,
    )) as unknown as { total: number }[];
    expect(elsewhere[0]!.total).toBe(0);
  });

  it('escalates a handover past its deadline to the rep, the SDR and the managers', async () => {
    const { id } = await lead(sdr);
    await handover(id);
    await adminDb().execute(
      sql`update contacts set handover_due_at = now() - interval '1 hour' where id = ${id}`,
    );
    await sweepTenant(tenantId);
    for (const person of [rep, sdr, admin]) {
      const rows = (await notices(person.userId, 'acceptance_overdue')).filter((row) =>
        row.dedupe_key.includes(id),
      );
      expect(rows).toHaveLength(1);
    }
  });

  it('marks alert emails as sent, so a second run sends nothing', async () => {
    await sendPendingAlertEmails(tenantId);
    expect(await sendPendingAlertEmails(tenantId)).toBe(0);
    const unsent = (await adminDb().execute(sql`
      select count(*)::int as total from notifications
      where tenant_id = ${tenantId} and email_wanted and emailed_at is null`)) as unknown as {
      total: number;
    }[];
    expect(unsent[0]!.total).toBe(0);
  });

  it('refuses the scheduled run without the scheduler’s secret', async () => {
    const response = await cronLeadAlerts(
      new Request('http://localhost/api/cron/lead-alerts', {
        headers: { authorization: 'Bearer not-the-secret-not-the-secret-not-it' },
      }),
    );
    expect(response.status).toBe(401);
  });
});

describe('exporting leads', () => {
  it('exports the leads in view, is audited, and needs the export permission', async () => {
    const result = await exportLeads(admin, leadQueueFiltersSchema.parse({ view: 'all' }));
    expect(result.rows).toBeGreaterThanOrEqual(3);
    expect(result.csv.split('\n')[0]).toContain('Sub-source');
    expect(result.csv).not.toContain('Date of birth');
    const audits = (await adminDb().execute(sql`
      select count(*)::int as total from audit_logs
      where tenant_id = ${tenantId} and action = 'export' and context ->> 'what' = 'leads'`)) as unknown as {
      total: number;
    }[];
    expect(audits[0]!.total).toBe(1);

    await expectCode(
      () => exportLeads(sdr, leadQueueFiltersSchema.parse({ view: 'all' })),
      'FORBIDDEN',
    );
    const elsewhere = await exportLeads(outsider, leadQueueFiltersSchema.parse({ view: 'all' }));
    expect(elsewhere.rows).toBe(0);
  });
});
