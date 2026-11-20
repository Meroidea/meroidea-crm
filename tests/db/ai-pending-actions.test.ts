import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { AppError } from '@/lib/errors';
import { FEATURE_KEYS } from '@/lib/features';
import {
  approvePendingAction,
  createPendingAction,
  editPendingAction,
  getPendingAction,
  listPendingActions,
  rejectPendingAction,
} from '@/modules/assistant/pending';
import type { PendingActionView } from '@/modules/assistant/pending-schemas';
import { buildProposeTools } from '@/modules/assistant/propose-tools';
import { createContactSchema } from '@/modules/contacts/schemas';
import { createContact } from '@/modules/contacts/service';
import { getOpportunity } from '@/modules/opportunities/queries';
import { createOpportunitySchema } from '@/modules/opportunities/schemas';
import { createOpportunity } from '@/modules/opportunities/service';
import type { TenantContext } from '@/server/context';
import { adminDb } from '@/server/db/admin';
import { withRls } from '@/server/db/with-rls';

import { addMember, contextFor, createWorkspace, destroyWorkspace } from '../support/workspaces';

const stamp = Date.now();
const mail = (name: string) => `${name}-${stamp}@example.com`;

let tenantId: string;
let userIds: string[];
let owner: TenantContext;
let mia: TenantContext;
let other: { tenantId: string; userIds: string[]; ctx: TenantContext };

type ToolResult = {
  proposal?: PendingActionView;
  unavailable?: string;
  needsClarification?: string;
  invalid?: string[];
};

async function propose(
  ctx: TenantContext,
  name: keyof ReturnType<typeof buildProposeTools>,
  input: Record<string, unknown>,
): Promise<ToolResult> {
  const execute = buildProposeTools(ctx)[name].execute as unknown as (
    input: unknown,
    options: unknown,
  ) => Promise<ToolResult>;
  return execute(input, { toolCallId: 'test', messages: [] });
}

async function expectCode(run: () => Promise<unknown>, code: AppError['code']) {
  const error = await run().then(
    () => null,
    (caught: unknown) => caught,
  );
  expect(error).toBeInstanceOf(AppError);
  expect((error as AppError).code).toBe(code);
}

async function count(table: string): Promise<number> {
  const rows = (await adminDb().execute(
    sql`select count(*)::int as n from ${sql.identifier(table)} where tenant_id = ${tenantId}`,
  )) as unknown as { n: number }[];
  return rows[0]?.n ?? 0;
}

const invoiceInput = (customerName: string) => ({
  customerName,
  issueDate: '2031-03-01',
  dueDate: '2031-03-15',
  taxRatePercent: '10',
  lines: [
    { description: 'Consulting', quantity: '2', unitPrice: '150.00' },
    { description: 'Setup', quantity: '1', unitPrice: '99.95' },
  ],
});

async function proposeInvoice(customerName: string): Promise<PendingActionView> {
  const result = await propose(owner, 'propose_invoice', invoiceInput(customerName));
  if (!result.proposal) throw new Error(`no proposal: ${JSON.stringify(result)}`);
  return result.proposal;
}

beforeAll(async () => {
  const a = await createWorkspace('Pending Alpha', mail('pending-owner'));
  const miaId = await addMember(a.tenantId, mail('pending-mia'), 'Mia Rostered', 'member');
  tenantId = a.tenantId;
  userIds = [a.ownerId, miaId];
  owner = await contextFor(a.ownerId, tenantId);
  mia = await contextFor(miaId, tenantId);

  const b = await createWorkspace('Pending Beta', mail('pending-beta-owner'));
  other = {
    tenantId: b.tenantId,
    userIds: [b.ownerId],
    ctx: await contextFor(b.ownerId, b.tenantId),
  };
}, 120_000);

afterAll(async () => {
  if (tenantId) await destroyWorkspace(tenantId, userIds);
  if (other) await destroyWorkspace(other.tenantId, other.userIds);
}, 60_000);

describe('proposing changes nothing', () => {
  it('an invoice proposal saves a pending card and no invoice', async () => {
    const before = await count('invoices');
    const proposal = await proposeInvoice('Example Pty Ltd');
    expect(proposal.status).toBe('pending');
    expect(proposal.summary).toContain('439.95');
    expect(await count('invoices')).toBe(before);
  });

  it('a role that cannot create invoices is not offered one', async () => {
    const result = await propose(mia, 'propose_invoice', invoiceInput('Nope Ltd'));
    expect(result.unavailable).toMatch(/invoices/);
  });
});

describe('approval', () => {
  it('approving runs the invoice service once and records who approved it', async () => {
    const proposal = await proposeInvoice('Approve Me Ltd');
    const before = await count('invoices');

    const approved = await approvePendingAction(owner, proposal.id);
    expect(approved.status).toBe('approved');
    expect(approved.result?.entityType).toBe('invoice');
    expect(await count('invoices')).toBe(before + 1);

    const [invoice] = (await adminDb().execute(
      sql`select status, total::text as total from invoices where id = ${approved.result?.entityId}`,
    )) as unknown as { status: string; total: string }[];
    expect(invoice).toEqual({ status: 'draft', total: '439.95' });

    const audits = (await adminDb().execute(sql`
      select actor_user_id, context from audit_logs
      where tenant_id = ${tenantId} and entity_type = 'ai_pending_action' and entity_id = ${proposal.id}`)) as unknown as {
      actor_user_id: string;
      context: Record<string, unknown>;
    }[];
    expect(audits).toHaveLength(1);
    expect(audits[0]?.actor_user_id).toBe(owner.userId);
    expect(audits[0]?.context).toMatchObject({
      aiProposed: true,
      decision: 'approved',
      approvedBy: owner.userId,
      resultEntityType: 'invoice',
    });

    await expectCode(() => approvePendingAction(owner, proposal.id), 'CONFLICT');
    expect(await count('invoices')).toBe(before + 1);
  });

  it('two approvals racing each other create one invoice', async () => {
    const proposal = await proposeInvoice('Race Ltd');
    const before = await count('invoices');
    const outcomes = await Promise.allSettled([
      approvePendingAction(owner, proposal.id),
      approvePendingAction(owner, proposal.id),
    ]);
    expect(outcomes.filter((o) => o.status === 'fulfilled')).toHaveLength(1);
    expect(await count('invoices')).toBe(before + 1);
  });

  it('a colleague in the same business cannot see or approve someone else’s proposal', async () => {
    const proposal = await proposeInvoice('Private Ltd');
    await expectCode(() => approvePendingAction(mia, proposal.id), 'NOT_FOUND');
    await expectCode(() => rejectPendingAction(mia, proposal.id), 'NOT_FOUND');
    expect(await listPendingActions(mia, [proposal.id])).toEqual([]);
    const rows = await withRls(mia, (tx) =>
      tx.execute(sql`select id from ai_pending_actions where id = ${proposal.id}`),
    );
    expect(rows).toHaveLength(0);
    expect((await getPendingAction(owner, proposal.id)).status).toBe('pending');
  });

  it('another business cannot approve this business’s proposal', async () => {
    const proposal = await proposeInvoice('Cross Tenant Ltd');
    await expectCode(() => approvePendingAction(other.ctx, proposal.id), 'NOT_FOUND');
    expect(await listPendingActions(other.ctx, [proposal.id])).toEqual([]);
  });

  it('a cancelled proposal can never be approved', async () => {
    const proposal = await proposeInvoice('Cancel Ltd');
    expect((await rejectPendingAction(owner, proposal.id)).status).toBe('rejected');
    await expectCode(() => approvePendingAction(owner, proposal.id), 'CONFLICT');
  });

  it('an expired proposal cannot be approved', async () => {
    const proposal = await proposeInvoice('Late Ltd');
    await adminDb().execute(
      sql`update ai_pending_actions set expires_at = now() - interval '1 minute' where id = ${proposal.id}`,
    );
    await expectCode(() => approvePendingAction(owner, proposal.id), 'CONFLICT');
    expect((await getPendingAction(owner, proposal.id)).status).toBe('expired');
  });

  it('approval checks the role again: losing the permission blocks it and keeps the card', async () => {
    const proposal = await proposeInvoice('Role Change Ltd');
    const grants = new Map(owner.grants);
    grants.delete('invoices.manage');
    const narrowed = { ...owner, grants };
    const before = await count('invoices');
    await expectCode(() => approvePendingAction(narrowed, proposal.id), 'FORBIDDEN');
    expect(await count('invoices')).toBe(before);
    const after = await getPendingAction(owner, proposal.id);
    expect(after.status).toBe('pending');
    expect(after.error).toMatch(/access/);
  });

  it('the database refuses to reopen a decided proposal, whatever the code does', async () => {
    const proposal = await proposeInvoice('Trigger Ltd');
    await rejectPendingAction(owner, proposal.id);
    await expect(
      withRls(owner, (tx) =>
        tx.execute(sql`update ai_pending_actions set status = 'pending' where id = ${proposal.id}`),
      ),
    ).rejects.toThrow();
  });
});

describe('editing before approval', () => {
  it('the person can reword a staff email and drop recipients, but not add them', async () => {
    const proposal = await propose(owner, 'propose_staff_email', {
      audience: 'all_staff',
      subject: 'Team meeting',
      body: 'We meet on Friday at 9.',
    });
    const view = proposal.proposal;
    if (view?.kind !== 'staff_email') throw new Error('expected a staff email proposal');
    expect(view.payload.recipients.map((r) => r.userId).sort()).toEqual(userIds.slice().sort());

    const edited = await editPendingAction(owner, view.id, {
      kind: 'staff_email',
      subject: 'Team meeting moved',
      body: 'We now meet on Friday at 10.',
      userIds: [mia.userId],
    });
    expect(edited.summary).toBe('Email to 1 staff member: “Team meeting moved”');

    await expectCode(
      () =>
        editPendingAction(owner, view.id, {
          kind: 'staff_email',
          subject: 'x',
          body: 'y',
          userIds: [mia.userId, other.userIds[0] ?? ''],
        }),
      'VALIDATION',
    );
  });

  it('a staff email that cannot be sent goes back to pending with the reason, nothing sent', async () => {
    const proposal = await propose(owner, 'propose_staff_email', {
      audience: 'named_people',
      names: ['Mia'],
      subject: 'Hello',
      body: 'A note.',
    });
    const id = proposal.proposal?.id ?? '';
    // Email is never configured in tests, so the service refuses before sending anything.
    await expectCode(() => approvePendingAction(owner, id), 'CONFLICT');
    const after = await getPendingAction(owner, id);
    expect(after.status).toBe('pending');
    expect(after.error).toMatch(/not set up/);
  });

  it('a staff member cannot be offered a staff email', async () => {
    const result = await propose(mia, 'propose_staff_email', {
      audience: 'all_staff',
      subject: 'x',
      body: 'y',
    });
    expect(result.unavailable).toMatch(/emailing staff/);
  });
});

describe('rosters', () => {
  it('approving saves every shift unpublished, with names matched to staff', async () => {
    const result = await propose(owner, 'propose_roster', {
      periodStartsOn: '2031-03-03',
      span: 'week',
      shifts: [
        { person: 'Mia', date: '2031-03-03', startTime: '09:00', endTime: '17:00' },
        { person: 'Mia', date: '2031-03-04', startTime: '09:00', endTime: '13:00' },
      ],
    });
    expect(result.proposal?.summary).toContain('2 shifts for 1 person');
    const before = await count('roster_shifts');
    const approved = await approvePendingAction(owner, result.proposal?.id ?? '');
    expect(approved.status).toBe('approved');
    const rows = (await adminDb().execute(sql`
      select published_at, break_minutes from roster_shifts
      where tenant_id = ${tenantId} and user_id = ${mia.userId} and deleted_at is null`)) as unknown as {
      published_at: Date | null;
    }[];
    expect(await count('roster_shifts')).toBe(before + 2);
    expect(rows.every((row) => row.published_at === null)).toBe(true);
  });

  it('one refused shift saves none of them', async () => {
    const result = await propose(owner, 'propose_roster', {
      periodStartsOn: '2031-03-03',
      shifts: [
        { person: 'Mia', date: '2031-03-05', startTime: '09:00', endTime: '17:00' },
        // Overlaps the shift approved in the test above.
        { person: 'Mia', date: '2031-03-03', startTime: '12:00', endTime: '18:00' },
      ],
    });
    const before = await count('roster_shifts');
    const error = await approvePendingAction(owner, result.proposal?.id ?? '').catch((e) => e);
    expect(error).toBeInstanceOf(AppError);
    expect(await count('roster_shifts')).toBe(before);
    expect((await getPendingAction(owner, result.proposal?.id ?? '')).status).toBe('pending');
  });

  it('an unknown person is a question back to the person, not a guess', async () => {
    const result = await propose(owner, 'propose_roster', {
      periodStartsOn: '2031-03-03',
      shifts: [{ person: 'Nobody Here', date: '2031-03-06', startTime: '09:00', endTime: '17:00' }],
    });
    expect(result.proposal).toBeUndefined();
    expect(result.needsClarification).toMatch(/No active staff member/);
  });
});

describe('record updates', () => {
  it('moves an opportunity to the named stage only once approved', async () => {
    const contact = await createContact(owner, createContactSchema.parse({ firstName: 'Stagey' }));
    const deal = await createOpportunity(
      owner,
      createOpportunitySchema.parse({
        name: 'Stagey renewal',
        contactId: contact.id,
        amount: '500',
      }),
    );
    const result = await propose(owner, 'propose_record_update', {
      change: 'move_stage',
      opportunity: 'Stagey renewal',
      stage: 'contacted',
    });
    expect((await getOpportunity(owner, deal.id)).stageName).toBe('New');
    await approvePendingAction(owner, result.proposal?.id ?? '');
    expect((await getOpportunity(owner, deal.id)).stageName).toBe('Contacted');
  });

  it('creates a task once approved', async () => {
    const before = await count('tasks');
    const result = await propose(owner, 'propose_record_update', {
      change: 'create_task',
      title: 'Call back about renewal',
      taskType: 'call',
      priority: 'high',
      dueDate: '2031-03-10',
    });
    expect(await count('tasks')).toBe(before);
    const approved = await approvePendingAction(owner, result.proposal?.id ?? '');
    expect(approved.result?.entityType).toBe('task');
    expect(await count('tasks')).toBe(before + 1);
  });
});

describe('feature switch', () => {
  it('with Meroidea AI switched off, nothing can be proposed and proposals are hidden', async () => {
    const proposal = await proposeInvoice('Switch Ltd');
    const features = FEATURE_KEYS.filter((feature) => feature !== 'assistant');
    const list = sql`array[${sql.join(
      features.map((feature) => sql`${feature}`),
      sql`, `,
    )}]::text[]`;
    await adminDb().execute(sql`update tenants set features = ${list} where id = ${tenantId}`);
    try {
      const off = await contextFor(owner.userId, tenantId);
      await expectCode(
        () =>
          createPendingAction(off, {
            kind: 'record_update',
            payload: {
              change: 'create_task',
              title: 'x',
              taskType: 'other',
              priority: 'normal',
              dueDate: null,
              assignedTo: null,
              assigneeName: null,
              contactId: null,
              contactName: null,
              opportunityId: null,
              opportunityName: null,
            },
          }),
        'FORBIDDEN',
      );
      const rows = await withRls(off, (tx) =>
        tx.execute(sql`select id from ai_pending_actions where id = ${proposal.id}`),
      );
      expect(rows).toHaveLength(0);
    } finally {
      const all = sql`array[${sql.join(
        FEATURE_KEYS.map((feature) => sql`${feature}`),
        sql`, `,
      )}]::text[]`;
      await adminDb().execute(sql`update tenants set features = ${all} where id = ${tenantId}`);
    }
  });
});
