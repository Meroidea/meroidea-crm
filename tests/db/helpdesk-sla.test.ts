import { createHmac } from 'node:crypto';

import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { POST as metaWebhook } from '@/app/api/webhooks/meta/route';
import { AppError } from '@/lib/errors';
import { getSlaSettings, getTicketCustomer } from '@/modules/helpdesk/queries';
import {
  createTicket,
  createTicketFromConversation,
  replyToTicket,
  saveSlaSettings,
  setTicketOpportunity,
  updateTicket,
} from '@/modules/helpdesk/service';
import type { SlaSettingsInput } from '@/modules/helpdesk/schemas';
import { setAccountSettings } from '@/modules/social/team-service';
import type { TenantContext } from '@/server/context';
import { adminDb } from '@/server/db/admin';
import { withRls } from '@/server/db/with-rls';

import { addMember, contextFor, createWorkspace, destroyWorkspace } from '../support/workspaces';

// Tickets with response targets (ADR-069): business-time arithmetic, the SLA trigger, the
// sweep, settings, links to the CRM and the inbox. Real database, RLS, routes and services.

vi.hoisted(() => {
  process.env.META_APP_ID = 'meta-app-1';
  process.env.META_APP_SECRET = 'meta-secret-0123456789abcdef';
  process.env.META_WEBHOOK_VERIFY_TOKEN = 'verify-token-0123456789';
});

const stamp = Date.now();
const tail = String(stamp).slice(-6);
const mail = (name: string) => `${name}-${stamp}@example.com`;
const NUMBER = `5${stamp}`;
const CUSTOMER = `61410${tail}`;

let tenantId: string;
let otherTenant: string;
let accountId: string;
const users: string[] = [];
const otherUsers: string[] = [];
let owner: TenantContext;
let manager: TenantContext;
let staff: TenantContext;
let outsider: TenantContext;

const MINUTE = 60_000;

const rows = async <T>(query: ReturnType<typeof sql>) =>
  (await adminDb().execute(query)) as unknown as T[];

async function expectCode(run: () => Promise<unknown>, code: AppError['code']) {
  const error = await run().then(
    () => null,
    (caught: unknown) => caught,
  );
  expect(error).toBeInstanceOf(AppError);
  expect((error as AppError).code).toBe(code);
}

async function sqlState(run: () => Promise<unknown>): Promise<string> {
  try {
    await run();
  } catch (error) {
    const wrapped = error as { code?: string; cause?: { code?: string } };
    return wrapped.cause?.code ?? wrapped.code ?? 'unknown';
  }
  return 'OK';
}

type TicketSla = {
  created_at: Date;
  status: string;
  sla_policy_id: string | null;
  response_due_at: Date;
  first_response_at: Date | null;
  first_response_at_risk_at: Date | null;
  resolution_due_at: Date | null;
  resolution_at_risk_at: Date | null;
  sla_paused_at: Date | null;
  sla_paused_minutes: number;
  first_response_breached_at: Date | null;
  resolution_breached_at: Date | null;
};

async function sla(id: string): Promise<TicketSla> {
  const [row] = await rows<TicketSla>(sql`
    select created_at, status, sla_policy_id, response_due_at, first_response_at,
      first_response_at_risk_at, resolution_due_at, resolution_at_risk_at, sla_paused_at,
      sla_paused_minutes, first_response_breached_at, resolution_breached_at
    from tickets where id = ${id}`);
  return row!;
}

const minutesAfter = (later: Date | null, earlier: Date) =>
  later ? Math.round((new Date(later).getTime() - new Date(earlier).getTime()) / MINUTE) : null;

async function newTicket(ctx: TenantContext, priority: 'low' | 'normal' | 'high' | 'urgent') {
  return createTicket(ctx, {
    subject: `Printer on fire ${priority}`,
    description: 'Please help',
    requesterName: 'Casey Customer',
    requesterEmail: null,
    priority,
    category: null,
    assigneeUserId: null,
  });
}

function signed(body: unknown) {
  const raw = JSON.stringify(body);
  const signature = createHmac('sha256', process.env.META_APP_SECRET!).update(raw).digest('hex');
  return new Request('http://localhost:3000/api/webhooks/meta', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-hub-signature-256': `sha256=${signature}` },
    body: raw,
  });
}

let sequence = 0;
async function customerWrites(text = 'Hello') {
  sequence += 1;
  const body = {
    object: 'whatsapp_business_account',
    entry: [
      {
        id: `waba-${stamp}`,
        changes: [
          {
            field: 'messages',
            value: {
              messaging_product: 'whatsapp',
              metadata: { display_phone_number: '61400000000', phone_number_id: NUMBER },
              contacts: [{ profile: { name: 'Robin Rivers' }, wa_id: CUSTOMER }],
              messages: [
                {
                  from: CUSTOMER,
                  id: `wamid.S${stamp}.${sequence}`,
                  timestamp: String(Math.floor(Date.now() / 1000)),
                  type: 'text',
                  text: { body: text },
                },
              ],
            },
          },
        ],
      },
    ],
  };
  expect((await metaWebhook(signed(body))).status).toBe(200);
}

const sydneyWeekdays = [1, 2, 3, 4, 5].map((day) => ({ day, opens: '09:00', closes: '17:00' }));

function settings(overrides: Partial<SlaSettingsInput> = {}): SlaSettingsInput {
  return {
    atRiskPercent: 75,
    escalateToUserId: null,
    useBusinessHours: false,
    timezone: 'Australia/Sydney',
    skipPublicHolidays: true,
    weekly: sydneyWeekdays,
    targets: {
      urgent: { firstResponseHours: 1, resolutionHours: 4 },
      high: { firstResponseHours: 4, resolutionHours: 24 },
      normal: { firstResponseHours: 24, resolutionHours: 72 },
      low: { firstResponseHours: 72, resolutionHours: 168 },
    },
    ...overrides,
  };
}

let hoursId: string;

beforeAll(async () => {
  const one = await createWorkspace(`SLA Co ${stamp}`, mail('sla-owner'));
  tenantId = one.tenantId;
  users.push(one.ownerId);
  const two = await createWorkspace(`SLA Other ${stamp}`, mail('sla-other'));
  otherTenant = two.tenantId;
  otherUsers.push(two.ownerId);
  const managerId = await addMember(tenantId, mail('sla-manager'), 'Morgan Manager', 'manager');
  const staffId = await addMember(tenantId, mail('sla-staff'), 'Sky Staff', 'member');
  users.push(managerId, staffId);
  owner = await contextFor(one.ownerId, tenantId);
  manager = await contextFor(managerId, tenantId);
  staff = await contextFor(staffId, tenantId);
  outsider = await contextFor(two.ownerId, otherTenant);

  const [hours] = await rows<{ id: string }>(sql`
    insert into business_hours (tenant_id, name, timezone, weekly)
    values (${tenantId}, 'Test hours', 'Australia/Sydney', ${JSON.stringify([
      { day: 1, opens: '09:00', closes: '12:00' },
      { day: 1, opens: '13:00', closes: '17:00' },
      ...sydneyWeekdays.slice(1),
    ])}::jsonb) returning id`);
  hoursId = hours!.id;

  const [account] = await rows<{ id: string }>(sql`
    insert into social_accounts (tenant_id, platform, external_id, name, provider_business_id)
    values (${tenantId}, 'whatsapp', ${NUMBER}, 'Harbour Cafe', ${`waba-${stamp}`})
    returning id`);
  accountId = account!.id;
});

afterAll(async () => {
  vi.restoreAllMocks();
  for (const name of ['META_APP_ID', 'META_APP_SECRET', 'META_WEBHOOK_VERIFY_TOKEN']) {
    delete process.env[name];
  }
  await destroyWorkspace(tenantId, users);
  await destroyWorkspace(otherTenant, otherUsers);
});

describe('counting business time', () => {
  const add = async (from: string, minutes: number) => {
    const [row] = await rows<{ at: string }>(sql`
      select to_char(app.business_add(${hoursId}::uuid, ${from}::timestamptz, ${minutes})
        at time zone 'Australia/Sydney', 'YYYY-MM-DD HH24:MI') as at`);
    return row!.at;
  };

  it('skips nights and weekends in the business’s own timezone', async () => {
    // Friday 20 November 2026, 16:00 in Sydney, plus two hours: Monday 23rd, 09:00 + 1 h.
    expect(await add('2026-11-20 16:00 Australia/Sydney', 120)).toBe('2026-11-23 10:00');
    expect(await add('2026-11-21 22:00 Australia/Sydney', 30)).toBe('2026-11-23 09:30');
  });

  it('skips a lunch break between two spans of one day', async () => {
    expect(await add('2026-11-23 11:00 Australia/Sydney', 120)).toBe('2026-11-23 14:00');
  });

  it('skips the business’s public holidays, and only when asked to', async () => {
    await adminDb().execute(sql`
      insert into public_holidays (tenant_id, day, name) values (${tenantId}, '2026-11-23', 'Test')`);
    expect(await add('2026-11-20 16:00 Australia/Sydney', 120)).toBe('2026-11-24 10:00');
    await adminDb().execute(
      sql`update business_hours set skip_public_holidays = false where id = ${hoursId}`,
    );
    expect(await add('2026-11-20 16:00 Australia/Sydney', 120)).toBe('2026-11-23 10:00');
    await adminDb().execute(
      sql`update business_hours set skip_public_holidays = true where id = ${hoursId}`,
    );
    await adminDb().execute(sql`delete from public_holidays where tenant_id = ${tenantId}`);
  });

  it('counts real minutes across a daylight saving change', async () => {
    const [around] = await rows<{ id: string }>(sql`
      insert into business_hours (tenant_id, name, timezone, weekly)
      values (${tenantId}, 'Always', 'Australia/Sydney', ${JSON.stringify(
        [0, 1, 2, 3, 4, 5, 6].map((day) => ({ day, opens: '00:00', closes: '24:00' })),
      )}::jsonb) returning id`);
    // Sydney's clocks went from 02:00 to 03:00 on Sunday 4 October 2026.
    const [row] = await rows<{ minutes: number }>(sql`
      select extract(epoch from app.business_add(${around!.id}::uuid,
        '2026-10-03 23:00 Australia/Sydney'::timestamptz, 180)
        - '2026-10-03 23:00 Australia/Sydney'::timestamptz) / 60 as minutes`);
    expect(Number(row!.minutes)).toBe(180);
    await adminDb().execute(sql`delete from business_hours where id = ${around!.id}`);
  });

  it('measures back what it added', async () => {
    const [row] = await rows<{ minutes: number }>(sql`
      select app.business_minutes_between(${hoursId}::uuid,
        '2026-11-20 16:00 Australia/Sydney'::timestamptz,
        app.business_add(${hoursId}::uuid, '2026-11-20 16:00 Australia/Sydney'::timestamptz, 600))
        as minutes`);
    expect(row!.minutes).toBe(600);
  });

  it('refuses another business’s hours to a signed-in person', async () => {
    expect(
      await sqlState(() =>
        withRls(outsider, (tx) =>
          tx.execute(sql`select app.business_add(${hoursId}::uuid, now(), 60)`),
        ),
      ),
    ).toBe('42501');
  });

  it('refuses hours that close before they open, and unknown timezones', async () => {
    expect(
      await sqlState(() =>
        adminDb().execute(sql`
          insert into business_hours (tenant_id, name, timezone, weekly)
          values (${tenantId}, 'Bad', 'Australia/Sydney', '[{"day":1,"opens":"17:00","closes":"09:00"}]')`),
      ),
    ).toBe('23514');
    expect(
      await sqlState(() =>
        adminDb().execute(sql`
          insert into business_hours (tenant_id, name, timezone, weekly)
          values (${tenantId}, 'Bad', 'Mars/Base', '[{"day":1,"opens":"09:00","closes":"17:00"}]')`),
      ),
    ).toBe('23514');
  });
});

describe('a ticket’s response targets', () => {
  it('come from the business’s default policy when the ticket is made', async () => {
    const { id } = await newTicket(staff, 'urgent');
    const row = await sla(id);
    expect(row.sla_policy_id).not.toBeNull();
    expect(minutesAfter(row.response_due_at, row.created_at)).toBe(60);
    expect(minutesAfter(row.first_response_at_risk_at, row.created_at)).toBe(45);
    expect(minutesAfter(row.resolution_due_at, row.created_at)).toBe(240);
    expect(minutesAfter(row.resolution_at_risk_at, row.created_at)).toBe(180);
  });

  it('pause the resolution clock while pending the customer, but not the first reply', async () => {
    const { id } = await newTicket(staff, 'urgent');
    await updateTicket(staff, { id, status: 'pending' });
    expect((await sla(id)).sla_paused_at).not.toBeNull();
    // As if it had been waiting on the customer for two hours.
    await adminDb().execute(
      sql`update tickets set sla_paused_at = now() - interval '2 hours' where id = ${id}`,
    );
    await updateTicket(staff, { id, status: 'open' });
    const row = await sla(id);
    expect(row.sla_paused_at).toBeNull();
    expect(row.sla_paused_minutes).toBe(120);
    expect(minutesAfter(row.resolution_due_at, row.created_at)).toBe(240 + 120);
    expect(minutesAfter(row.response_due_at, row.created_at)).toBe(60);
  });

  it('do not pause while on hold', async () => {
    const { id } = await newTicket(staff, 'high');
    await updateTicket(staff, { id, status: 'on_hold' });
    expect((await sla(id)).sla_paused_at).toBeNull();
  });

  it('are worked out again when the priority changes', async () => {
    const { id } = await newTicket(staff, 'urgent');
    await updateTicket(staff, { id, priority: 'low' });
    const row = await sla(id);
    expect(minutesAfter(row.response_due_at, row.created_at)).toBe(72 * 60);
    expect(minutesAfter(row.resolution_due_at, row.created_at)).toBe(168 * 60);
  });

  it('record the first reply once, at the moment it is sent', async () => {
    const { id } = await newTicket(staff, 'normal');
    await replyToTicket(staff, { ticketId: id, body: 'On it', isInternal: false });
    const first = (await sla(id)).first_response_at;
    expect(first).not.toBeNull();
    await replyToTicket(staff, { ticketId: id, body: 'Again', isInternal: false, status: 'open' });
    expect((await sla(id)).first_response_at).toEqual(first);
  });

  it('cannot be written by a person, only worked out by the database', async () => {
    const { id } = await newTicket(staff, 'normal');
    expect(
      await sqlState(() =>
        withRls(manager, (tx) =>
          tx.execute(
            sql`update tickets set resolution_due_at = now() + interval '1 year' where id = ${id}`,
          ),
        ),
      ),
    ).toBe('42501');
    expect(
      await sqlState(() =>
        withRls(manager, (tx) =>
          tx.execute(sql`update tickets set sla_policy_id = null where id = ${id}`),
        ),
      ),
    ).toBe('42501');
    // A first response cannot be back-dated to look on time.
    await withRls(manager, (tx) =>
      tx.execute(
        sql`update tickets set first_response_at = now() - interval '1 day' where id = ${id}`,
      ),
    );
    const row = await sla(id);
    expect(Date.now() - new Date(row.first_response_at!).getTime()).toBeLessThan(MINUTE);
  });
});

describe('the SLA sweep', () => {
  const notices = (ticketId: string) =>
    rows<{ user_id: string; type: string; title: string }>(sql`
      select user_id, type, title from notifications
      where tenant_id = ${tenantId} and url = ${`/helpdesk/${ticketId}`} order by type`);

  it('marks a missed target and tells the assignee once', async () => {
    const { id } = await newTicket(staff, 'urgent');
    await updateTicket(manager, { id, assigneeUserId: staff.userId });
    await adminDb().execute(sql`
      update tickets set response_due_at = now() - interval '1 minute',
        first_response_at_risk_at = now() - interval '20 minutes' where id = ${id}`);
    await adminDb().execute(sql`select app.sla_sweep()`);
    expect((await sla(id)).first_response_breached_at).not.toBeNull();
    await adminDb().execute(sql`select app.sla_sweep()`);
    const sent = await notices(id);
    expect(sent.filter((notice) => notice.type === 'sla_breached')).toEqual([
      expect.objectContaining({ user_id: staff.userId }),
    ]);
    // Which ticket and which target, never what the customer wrote.
    expect(sent[0]?.title).not.toContain('Printer');
  });

  it('warns about a ticket at risk; with nobody assigned, those who manage tickets hear', async () => {
    const { id } = await newTicket(staff, 'urgent');
    await adminDb().execute(
      sql`update tickets set first_response_at_risk_at = now() - interval '1 minute' where id = ${id}`,
    );
    await adminDb().execute(sql`select app.sla_sweep()`);
    const told = (await notices(id)).filter((notice) => notice.type === 'sla_at_risk');
    expect(told.map((notice) => notice.user_id).sort()).toEqual(
      [owner.userId, manager.userId].sort(),
    );
    expect((await sla(id)).first_response_breached_at).toBeNull();
  });

  it('leaves a paused resolution clock alone', async () => {
    const { id } = await newTicket(staff, 'urgent');
    await updateTicket(staff, { id, status: 'pending' });
    await adminDb().execute(sql`
      update tickets set resolution_due_at = now() - interval '1 minute',
        resolution_at_risk_at = now() - interval '1 hour' where id = ${id}`);
    await adminDb().execute(sql`select app.sla_sweep()`);
    expect((await sla(id)).resolution_breached_at).toBeNull();
  });
});

describe('response target settings', () => {
  it('need tickets.manage', async () => {
    await expectCode(() => saveSlaSettings(staff, settings()), 'FORBIDDEN');
    expect(
      await sqlState(() =>
        withRls(staff, (tx) =>
          tx.execute(
            sql`update sla_targets set first_response_minutes = 1 where tenant_id = ${tenantId}`,
          ),
        ),
      ),
    ).toBe('OK');
    // RLS let the statement run but change nothing: staff cannot write targets.
    const [target] = await rows<{ minutes: number }>(sql`
      select min(first_response_minutes) as minutes from sla_targets where tenant_id = ${tenantId}`);
    expect(target!.minutes).toBeGreaterThan(1);
  });

  it('move the tickets still being worked onto business hours', async () => {
    const { id } = await newTicket(staff, 'normal');
    const before = await sla(id);
    const result = await saveSlaSettings(manager, settings({ useBusinessHours: true }));
    expect(result.reapplied).toBeGreaterThan(0);
    const after = await sla(id);
    // 24 counted hours on 09:00-17:00 weekdays is three working days, well past 24 clock hours.
    expect(minutesAfter(after.response_due_at, before.created_at)!).toBeGreaterThan(24 * 60);
    const saved = await getSlaSettings(manager);
    expect(saved.useBusinessHours).toBe(true);
    expect(saved.weekly).toEqual(sydneyWeekdays);
    await saveSlaSettings(manager, settings({ useBusinessHours: false }));
  });

  it('refuse an unknown timezone', async () => {
    await expectCode(
      () => saveSlaSettings(manager, settings({ useBusinessHours: true, timezone: 'Mars/Base' })),
      'VALIDATION',
    );
  });

  it('are invisible to another business', async () => {
    const seen = await withRls(outsider, (tx) =>
      tx.execute(sql`select id from sla_policies where tenant_id = ${tenantId}`),
    );
    expect(seen).toHaveLength(0);
    const ownPolicy = await withRls(outsider, (tx) =>
      tx.execute(sql`select id from sla_policies where tenant_id = ${otherTenant}`),
    );
    expect(ownPolicy).toHaveLength(1);
  });
});

describe('tickets and the CRM', () => {
  let contactId: string;
  let organizationId: string;
  let opportunityId: string;
  let conversationId: string;

  beforeAll(async () => {
    const [contact] = await rows<{ id: string }>(sql`
      insert into contacts (tenant_id, first_name, last_name, phone, phone_e164, owner_user_id)
      values (${tenantId}, 'Robin', 'Rivers', ${`+${CUSTOMER}`}, ${`+${CUSTOMER}`}, ${manager.userId})
      returning id`);
    contactId = contact!.id;
    const [organization] = await rows<{ id: string }>(sql`
      insert into organizations (tenant_id, name) values (${tenantId}, 'Rivers Pty Ltd') returning id`);
    organizationId = organization!.id;
    await adminDb().execute(sql`
      insert into contact_organizations (tenant_id, contact_id, organization_id, relationship, is_primary)
      values (${tenantId}, ${contactId}, ${organizationId}, 'employee', true)`);
    const [opportunity] = await rows<{ id: string }>(sql`
      insert into opportunities (tenant_id, contact_id, name, pipeline_id, stage_id, owner_user_id)
      select ${tenantId}, ${contactId}, 'Fit-out', p.id, s.id, ${manager.userId}
      from pipelines p join pipeline_stages s on s.pipeline_id = p.id
      where p.tenant_id = ${tenantId} order by s.position limit 1
      returning id`);
    opportunityId = opportunity!.id;
  });

  it('a customer’s new WhatsApp conversation opens a ticket when the account is set to', async () => {
    await setAccountSettings(owner, {
      accountId,
      createLeadForUnknown: false,
      leadSourceId: null,
      autoTicket: true,
      autoTicketPriority: 'high',
    });
    await customerWrites('My order is wrong');
    const [ticket] = await rows<{
      id: string;
      priority: string;
      contact_id: string | null;
      organization_id: string | null;
      conversation_id: string;
      subject: string;
      source: string;
    }>(sql`select id, priority, contact_id, organization_id, conversation_id, subject, source
           from tickets where tenant_id = ${tenantId} and source = 'conversation'`);
    expect(ticket).toMatchObject({
      priority: 'high',
      contact_id: contactId,
      organization_id: organizationId,
    });
    expect(ticket?.subject).not.toContain('order is wrong');
    conversationId = ticket!.conversation_id;
    const linked = await rows<{ opportunity_id: string }>(
      sql`select opportunity_id from ticket_opportunities where ticket_id = ${ticket!.id}`,
    );
    expect(linked.map((row) => row.opportunity_id)).toEqual([opportunityId]);

    // Waiting on the customer, they write again: it is open, and its clock runs again.
    await updateTicket(manager, { id: ticket!.id, status: 'pending' });
    await customerWrites('Any news?');
    const row = await sla(ticket!.id);
    expect(row.status).toBe('open');
    expect(row.sla_paused_at).toBeNull();
    // Still one ticket for the conversation.
    const count = await rows<{ n: number }>(
      sql`select count(*)::int as n from tickets where conversation_id = ${conversationId}`,
    );
    expect(count[0]!.n).toBe(1);
    await setAccountSettings(owner, {
      accountId,
      createLeadForUnknown: false,
      leadSourceId: null,
      autoTicket: false,
    });
  });

  it('asking again for a conversation with a ticket being worked returns that ticket', async () => {
    const again = await createTicketFromConversation(manager, {
      conversationId,
      subject: 'Second try',
      priority: 'normal',
      assigneeUserId: null,
    });
    expect(again.existing).toBe(true);
  });

  it('needs the inbox to make a ticket from a conversation, and the business’s own one', async () => {
    await expectCode(
      () =>
        createTicketFromConversation(staff, {
          conversationId,
          subject: 'Mine',
          priority: 'normal',
          assigneeUserId: null,
        }),
      'FORBIDDEN',
    );
    await expectCode(
      () =>
        createTicketFromConversation(outsider, {
          conversationId,
          subject: 'Theirs',
          priority: 'normal',
          assigneeUserId: null,
        }),
      'NOT_FOUND',
    );
  });

  it('replying on the channel needs permission to reply in the inbox', async () => {
    const [ticket] = await rows<{ id: string }>(
      sql`select id from tickets where conversation_id = ${conversationId} limit 1`,
    );
    await expectCode(
      () => replyToTicket(staff, { ticketId: ticket!.id, body: 'Hi', isInternal: false }),
      'FORBIDDEN',
    );
  });

  it('links only the customer’s own opportunities, within the person’s scope', async () => {
    const { id } = await createTicket(manager, {
      subject: 'Billing question',
      description: 'About my invoice',
      requesterName: 'Robin Rivers',
      requesterEmail: null,
      priority: 'normal',
      category: null,
      assigneeUserId: null,
    });
    // A ticket without the contact cannot point at their deal.
    await expectCode(
      () => setTicketOpportunity(manager, { ticketId: id, opportunityId, linked: true }),
      'VALIDATION',
    );
    const [ticket] = await rows<{ id: string }>(
      sql`select id from tickets where conversation_id = ${conversationId} limit 1`,
    );
    // Staff see only their own opportunities: the manager's is not found for them.
    await expectCode(
      () => setTicketOpportunity(staff, { ticketId: ticket!.id, opportunityId, linked: false }),
      'NOT_FOUND',
    );
    const forStaff = await getTicketCustomer(staff, {
      id: ticket!.id,
      contactId,
      organizationId,
    });
    expect(forStaff.linked).toEqual([]);
    const forManager = await getTicketCustomer(manager, {
      id: ticket!.id,
      contactId,
      organizationId,
    });
    expect(forManager.linked.map((item) => item.id)).toEqual([opportunityId]);
    expect(forManager.organization?.name).toBe('Rivers Pty Ltd');
  });

  it('keeps ticket links invisible to another business', async () => {
    const seen = await withRls(outsider, (tx) =>
      tx.execute(sql`select ticket_id from ticket_opportunities where tenant_id = ${tenantId}`),
    );
    expect(seen).toHaveLength(0);
  });
});
