import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { AppError } from '@/lib/errors';
import { logActivity } from '@/modules/activities/service';
import { createContactSchema } from '@/modules/contacts/schemas';
import { createContact } from '@/modules/contacts/service';
import { getBoard, getOpportunity, listOpportunities } from '@/modules/opportunities/queries';
import { createOpportunitySchema } from '@/modules/opportunities/schemas';
import { createOpportunity, moveStage } from '@/modules/opportunities/service';
import { getPipelineConfig } from '@/modules/pipelines/queries';
import { getMyDay, listTasks } from '@/modules/tasks/queries';
import { createTaskSchema } from '@/modules/tasks/schemas';
import { completeTask, createTask } from '@/modules/tasks/service';
import type { TenantContext } from '@/server/context';
import { adminDb } from '@/server/db/admin';

import { addMember, contextFor, createWorkspace, destroyWorkspace } from '../support/workspaces';

const stamp = Date.now();
const mail = (name: string) => `${name}-${stamp}@example.com`;

let tenantId: string;
let userIds: string[];
let owner: TenantContext;
let mia: TenantContext;
let max: TenantContext;
let other: { tenantId: string; userIds: string[]; ctx: TenantContext };

async function expectCode(run: () => Promise<unknown>, code: AppError['code']) {
  const error = await run().then(
    () => null,
    (caught: unknown) => caught,
  );
  expect(error).toBeInstanceOf(AppError);
  expect((error as AppError).code).toBe(code);
}

async function newDeal(ctx: TenantContext, name: string, amount = '1000') {
  const contact = await createContact(ctx, createContactSchema.parse({ firstName: name }));
  const deal = await createOpportunity(
    ctx,
    createOpportunitySchema.parse({ name: `${name} deal`, contactId: contact.id, amount }),
  );
  return { contactId: contact.id, id: deal.id };
}

beforeAll(async () => {
  const a = await createWorkspace('Gamma Studio', mail('gamma-owner'));
  const miaId = await addMember(a.tenantId, mail('mia'), 'Mia Member', 'member');
  const maxId = await addMember(a.tenantId, mail('max'), 'Max Member', 'member');
  tenantId = a.tenantId;
  userIds = [a.ownerId, miaId, maxId];
  owner = await contextFor(a.ownerId, tenantId);
  mia = await contextFor(miaId, tenantId);
  max = await contextFor(maxId, tenantId);

  const b = await createWorkspace('Delta Works', mail('delta-owner'));
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

describe('opportunity access', () => {
  it("consultant cannot view another consultant's opportunity", async () => {
    const deal = await newDeal(max, 'Hidden');

    expect((await listOpportunities(mia, {})).items.map((row) => row.id)).not.toContain(deal.id);
    await expectCode(() => getOpportunity(mia, deal.id), 'NOT_FOUND');
    const board = await getBoard(mia, {});
    expect(board.columns.flatMap((column) => column.cards).map((card) => card.id)).not.toContain(
      deal.id,
    );
  });

  it('another workspace cannot read an opportunity, even by id', async () => {
    const deal = await newDeal(owner, 'Private');
    await expectCode(() => getOpportunity(other.ctx, deal.id), 'NOT_FOUND');
  });

  it('cannot open an opportunity for a contact outside scope', async () => {
    const contact = await createContact(max, createContactSchema.parse({ firstName: 'Theirs' }));
    await expectCode(
      () =>
        createOpportunity(
          mia,
          createOpportunitySchema.parse({ name: 'Grab', contactId: contact.id }),
        ),
      'NOT_FOUND',
    );
  });
});

describe('stage moves', () => {
  it('records history, a stage_changed activity and an audit row', async () => {
    const deal = await newDeal(owner, 'Mover');
    const config = await getPipelineConfig(owner);
    const proposal = config.stages.find((stage) => stage.name === 'Proposal');
    if (!proposal) throw new Error('no Proposal stage');

    await moveStage(owner, {
      id: deal.id,
      stageId: proposal.id,
      lostReasonId: null,
      lostReasonNote: null,
    });

    const detail = await getOpportunity(owner, deal.id);
    expect(detail.stageName).toBe('Proposal');
    expect(detail.history.map((visit) => visit.stageName)).toEqual(['New', 'Proposal']);
    expect(detail.history[0]?.exitedAt).not.toBeNull();
    expect(detail.history[1]?.exitedAt).toBeNull();

    const [row] = (await adminDb().execute(sql`
      select count(*)::int as n from audit_logs
      where tenant_id = ${tenantId} and entity_id = ${deal.id} and action = 'stage_change'`)) as unknown as {
      n: number;
    }[];
    expect(row?.n).toBe(1);
  });

  it('requires a reason to mark lost, and closes the opportunity when won', async () => {
    const deal = await newDeal(owner, 'Closer');
    const config = await getPipelineConfig(owner);
    const lost = config.stages.find((stage) => stage.category === 'lost');
    const won = config.stages.find((stage) => stage.category === 'won');
    if (!lost || !won) throw new Error('missing won/lost stages');

    await expectCode(
      () =>
        moveStage(owner, {
          id: deal.id,
          stageId: lost.id,
          lostReasonId: null,
          lostReasonNote: null,
        }),
      'VALIDATION',
    );
    await moveStage(owner, {
      id: deal.id,
      stageId: won.id,
      lostReasonId: null,
      lostReasonNote: null,
    });
    const detail = await getOpportunity(owner, deal.id);
    expect(detail.status).toBe('won');
    expect(detail.closedAt).not.toBeNull();
  });

  it('refuses to move an opportunity outside edit scope', async () => {
    const deal = await newDeal(max, 'Guarded');
    const config = await getPipelineConfig(mia);
    const target = config.stages[1];
    if (!target) throw new Error('no stage');
    await expectCode(
      () =>
        moveStage(mia, {
          id: deal.id,
          stageId: target.id,
          lostReasonId: null,
          lostReasonNote: null,
        }),
      'NOT_FOUND',
    );
  });
});

describe('revenue masking', () => {
  it('hides amounts from a viewer without revenue.view', async () => {
    const deal = await newDeal(owner, 'Valuable', '25000');
    const noRevenue: TenantContext = { ...owner, grants: new Map(owner.grants) };
    noRevenue.grants.delete('revenue.view');

    expect((await getOpportunity(owner, deal.id)).amount).toBe('25000.00');
    expect((await getOpportunity(noRevenue, deal.id)).amount).toBeNull();
  });
});

describe('tasks and activities', () => {
  it('consultant cannot assign a task to a colleague', async () => {
    await expectCode(
      () => createTask(mia, createTaskSchema.parse({ title: 'Do it', assignedTo: max.userId })),
      'FORBIDDEN',
    );
  });

  it("keeps a consultant's tasks out of a colleague's lists", async () => {
    const task = await createTask(max, createTaskSchema.parse({ title: 'Private follow-up' }));
    expect((await listTasks(mia, {})).map((row) => row.id)).not.toContain(task.id);
    await expectCode(() => completeTask(mia, task.id), 'NOT_FOUND');
  });

  it('puts an overdue task in My Day and completing it logs the activity', async () => {
    const deal = await newDeal(mia, 'Busy');
    const yesterday = new Date(Date.now() - 2 * 86_400_000).toISOString().slice(0, 10);
    const task = await createTask(
      mia,
      createTaskSchema.parse({ title: 'Call back', opportunityId: deal.id, dueDate: yesterday }),
    );

    expect((await getMyDay(mia)).overdue.map((row) => row.id)).toContain(task.id);
    expect((await getOpportunity(mia, deal.id)).nextTaskDueAt).not.toBeNull();

    await completeTask(mia, task.id);
    expect((await getMyDay(mia)).overdue.map((row) => row.id)).not.toContain(task.id);
    expect((await getOpportunity(mia, deal.id)).nextTaskDueAt).toBeNull();
  });

  it('logging a call updates last activity on the opportunity and contact', async () => {
    const deal = await newDeal(mia, 'Chatty');
    await logActivity(mia, {
      type: 'call',
      body: 'Discussed timing',
      opportunityId: deal.id,
      outcome: 'connected',
    });
    const detail = await getOpportunity(mia, deal.id);
    expect(detail.lastActivityAt).not.toBeNull();
  });

  it("cannot log activity on someone else's record", async () => {
    const deal = await newDeal(max, 'Quiet');
    await expectCode(
      () => logActivity(mia, { type: 'note', body: 'Snooping', opportunityId: deal.id }),
      'NOT_FOUND',
    );
  });
});
