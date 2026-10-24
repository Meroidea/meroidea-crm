import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { AppError } from '@/lib/errors';
import { createContactSchema } from '@/modules/contacts/schemas';
import { createContact } from '@/modules/contacts/service';
import { saveItemStageAdvance, savePipeline, saveStageRules } from '@/modules/crm-config/service';
import {
  listItemsForOpportunity,
  listItemsForOrganization,
} from '@/modules/opportunities/item-queries';
import {
  createItem,
  deleteItem,
  moveItemStage,
  updateItem,
} from '@/modules/opportunities/item-service';
import { getOpportunity } from '@/modules/opportunities/queries';
import {
  createItemSchema,
  createOpportunitySchema,
  updateItemSchema,
} from '@/modules/opportunities/schemas';
import { createOpportunity, moveStage } from '@/modules/opportunities/service';
import { createOrganizationSchema } from '@/modules/organizations/schemas';
import { createOrganization } from '@/modules/organizations/service';
import { getPipelineConfig, type PipelineConfig } from '@/modules/pipelines/queries';
import { toggleStage } from '@/modules/settings/service';
import type { TenantContext } from '@/server/context';
import { adminDb } from '@/server/db/admin';
import { withRls } from '@/server/db/with-rls';

import { addMember, contextFor, createWorkspace, destroyWorkspace } from '../support/workspaces';

// Milestone 8 (ADR-018): one opportunity holds several items, each with its own stage track and
// value. Done when one opportunity with three items tracks three outcomes independently.

const stamp = Date.now();
const mail = (name: string) => `${name}-${stamp}@example.com`;

let tenantId: string;
let userIds: string[];
let owner: TenantContext;
let mia: TenantContext;
let max: TenantContext;
/** Sees and edits every opportunity but no revenue: an operations role. */
let ops: TenantContext;
let other: { tenantId: string; userIds: string[]; ctx: TenantContext };
let sales: PipelineConfig;
let items: PipelineConfig;
let orgs: string[];

async function expectCode(run: () => Promise<unknown>, code: AppError['code']) {
  const error = await run().then(
    () => null,
    (caught: unknown) => caught,
  );
  expect(error).toBeInstanceOf(AppError);
  expect((error as AppError).code).toBe(code);
}

const stage = (pipeline: PipelineConfig, name: string) => {
  const found = pipeline.stages.find((candidate) => candidate.name === name);
  if (!found) throw new Error(`no stage ${name}`);
  return found.id;
};

async function newDeal(ctx: TenantContext, name: string) {
  const contact = await createContact(ctx, createContactSchema.parse({ firstName: name }));
  return createOpportunity(
    ctx,
    createOpportunitySchema.parse({ name: `${name} case`, contactId: contact.id }),
  );
}

function addItem(
  ctx: TenantContext,
  opportunityId: string,
  organizationId: string,
  title: string,
  extra: Record<string, unknown> = {},
) {
  return createItem(
    ctx,
    createItemSchema.parse({ opportunityId, organizationId, title, ...extra }),
  );
}

function move(ctx: TenantContext, id: string, stageId: string, lostReasonId: string | null = null) {
  return moveItemStage(ctx, { id, stageId, lostReasonId, lostReasonNote: null });
}

async function visits(itemId: string) {
  return (await adminDb().execute(sql`
    select stage_id, exited_at from stage_history
    where opportunity_item_id = ${itemId} order by entered_at`)) as unknown as {
    stage_id: string;
    exited_at: Date | null;
  }[];
}

beforeAll(async () => {
  const a = await createWorkspace(`Items Co ${stamp}`, mail('items-owner'));
  tenantId = a.tenantId;
  const miaId = await addMember(tenantId, mail('items-mia'), 'Mia Member', 'member');
  const maxId = await addMember(tenantId, mail('items-max'), 'Max Member', 'member');
  const opsId = await addMember(tenantId, mail('items-ops'), 'Olu Ops', 'member');
  userIds = [a.ownerId, miaId, maxId, opsId];
  await adminDb().execute(sql`
    with role as (
      insert into roles (tenant_id, key, name) values (${tenantId}, 'ops', 'Operations')
      returning id
    )
    insert into role_permissions (tenant_id, role_id, permission, scope)
    select ${tenantId}, role.id, p.permission, p.scope::permission_scope
    from role, (values ('opportunities.view', 'all'), ('opportunities.edit', 'all'))
      as p(permission, scope)`);
  await adminDb().execute(sql`
    update tenant_memberships set role_id = (
      select id from roles where tenant_id = ${tenantId} and key = 'ops')
    where tenant_id = ${tenantId} and user_id = ${opsId}`);

  owner = await contextFor(a.ownerId, tenantId);
  mia = await contextFor(miaId, tenantId);
  max = await contextFor(maxId, tenantId);
  ops = await contextFor(opsId, tenantId);

  await savePipeline(owner, {
    name: 'Applications',
    objectType: 'opportunity_item',
    leadType: null,
    description: null,
  });
  sales = await getPipelineConfig(owner);
  const summaries = await withRls(owner, (tx) =>
    tx.execute(sql`select id from pipelines where object_type = 'opportunity_item'`),
  );
  const itemPipelineId = (summaries as unknown as { id: string }[])[0]!.id;
  items = await getPipelineConfig(owner, itemPipelineId, 'opportunity_item');

  orgs = [];
  for (const name of ['Harbour University', 'Ridge College', 'Lakeside Institute']) {
    orgs.push((await createOrganization(owner, createOrganizationSchema.parse({ name }))).id);
  }

  const b = await createWorkspace(`Items Other ${stamp}`, mail('items-other'));
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

describe('three items, three outcomes', () => {
  it('tracks each item on its own stage while the opportunity stays where it is', async () => {
    const deal = await newDeal(owner, 'Avery');
    const [a, b, c] = [
      await addItem(owner, deal.id, orgs[0]!, 'Master of Data Science', {
        baseAmount: '30000',
        revenueRate: '15',
      }),
      await addItem(owner, deal.id, orgs[1]!, 'Graduate Diploma'),
      await addItem(owner, deal.id, orgs[2]!, 'Master of IT'),
    ];

    await move(owner, a.id, stage(items, 'Accepted'));
    await move(owner, b.id, stage(items, 'Declined'), sales.lostReasons[0]!.id);
    await move(owner, c.id, stage(items, 'Submitted'));

    const listed = await listItemsForOpportunity(owner, deal.id);
    expect(listed.map((item) => [item.title, item.stageName, item.status])).toEqual([
      ['Master of Data Science', 'Accepted', 'won'],
      ['Graduate Diploma', 'Declined', 'lost'],
      ['Master of IT', 'Submitted', 'open'],
    ]);
    expect(listed[0]?.closedAt).not.toBeNull();
    expect(listed[1]?.lostReasonName).toBe(sales.lostReasons[0]!.name);
    expect(listed[2]?.closedAt).toBeNull();
    // 15% of 30,000.00, worked out in cents.
    expect(listed[0]?.expectedRevenue).toBe('4500.00');
    expect(listed[0]?.currency).toBe(owner.tenant.currency);

    const detail = await getOpportunity(owner, deal.id);
    expect(detail.status).toBe('open');
    expect(detail.stageName).toBe('New');
    // The opportunity's own history holds only its own visits.
    expect(detail.history.map((visit) => visit.stageName)).toEqual(['New']);

    const history = await visits(a.id);
    expect(history.map((visit) => visit.stage_id)).toEqual([
      stage(items, 'Preparing'),
      stage(items, 'Accepted'),
    ]);
    expect(history[0]?.exited_at).not.toBeNull();
    expect(history[1]?.exited_at).toBeNull();

    const audits = (await adminDb().execute(sql`
      select action from audit_logs where entity_type = 'opportunity_item' and entity_id = ${a.id}
      order by created_at`)) as unknown as { action: string }[];
    expect(audits.map((row) => row.action)).toEqual(['create', 'stage_change']);
  });

  it('keeps an item’s visit open when its opportunity moves', async () => {
    const deal = await newDeal(owner, 'Blake');
    const item = await addItem(owner, deal.id, orgs[0]!, 'Bachelor of Arts');
    await moveStage(owner, {
      id: deal.id,
      stageId: stage(sales, 'Contacted'),
      lostReasonId: null,
      lostReasonNote: null,
    });
    const history = await visits(item.id);
    expect(history).toHaveLength(1);
    expect(history[0]?.exited_at).toBeNull();
    expect((await getOpportunity(owner, deal.id)).history.map((visit) => visit.stageName)).toEqual([
      'New',
      'Contacted',
    ]);
  });

  it('needs a reason to lose an item, and a stage of the item’s own pipeline', async () => {
    const deal = await newDeal(owner, 'Casey');
    const item = await addItem(owner, deal.id, orgs[1]!, 'Certificate IV');
    await expectCode(() => move(owner, item.id, stage(items, 'Declined')), 'VALIDATION');
    await expectCode(() => move(owner, item.id, stage(sales, 'Proposal')), 'VALIDATION');
    await expectCode(
      () => addItem(owner, deal.id, orgs[1]!, 'Late start', { stageId: stage(items, 'Accepted') }),
      'VALIDATION',
    );
  });
});

describe('winning an opportunity that has items', () => {
  it('waits until one of its items is won; one without items is unaffected', async () => {
    const won = stage(sales, 'Won');
    const withItems = await newDeal(owner, 'Kai');
    const item = await addItem(owner, withItems.id, orgs[0]!, 'Diploma of Nursing');
    const win = (id: string) =>
      moveStage(owner, { id, stageId: won, lostReasonId: null, lostReasonNote: null });

    await expectCode(() => win(withItems.id), 'VALIDATION');
    await move(owner, item.id, stage(items, 'Accepted'));
    await win(withItems.id);
    expect((await getOpportunity(owner, withItems.id)).status).toBe('won');

    const without = await newDeal(owner, 'Lee');
    await win(without.id);
    expect((await getOpportunity(owner, without.id)).status).toBe('won');
  });
});

describe('an item moving its opportunity', () => {
  beforeAll(async () => {
    await saveItemStageAdvance(owner, {
      id: stage(items, 'Submitted'),
      advancesParentToStageId: stage(sales, 'Proposal'),
    });
    items = await getPipelineConfig(owner, items.id, 'opportunity_item');
  });

  it('moves the opportunity forward, and never back', async () => {
    const deal = await newDeal(owner, 'Dana');
    const first = await addItem(owner, deal.id, orgs[0]!, 'Master of Laws');
    const moved = await move(owner, first.id, stage(items, 'Submitted'));
    expect(moved.parentAdvance).toEqual({ outcome: 'moved', stageName: 'Proposal', message: null });
    expect((await getOpportunity(owner, deal.id)).stageName).toBe('Proposal');

    await moveStage(owner, {
      id: deal.id,
      stageId: stage(sales, 'Negotiation'),
      lostReasonId: null,
      lostReasonNote: null,
    });
    const second = await addItem(owner, deal.id, orgs[1]!, 'Master of Business');
    expect((await move(owner, second.id, stage(items, 'Submitted'))).parentAdvance).toBeNull();
    expect((await getOpportunity(owner, deal.id)).stageName).toBe('Negotiation');
  });

  it('leaves the opportunity where it is when a stage gate is not met, and says why', async () => {
    const proposal = sales.stages.find((candidate) => candidate.id === stage(sales, 'Proposal'))!;
    await saveStageRules(owner, {
      id: proposal.id,
      ownerUserId: null,
      ownerTeamId: null,
      onEnter: 'notify',
      requiredFields: ['expectedCloseDate'],
      checklist: [],
      requiresApproval: false,
    });
    try {
      const deal = await newDeal(owner, 'Ellis');
      const item = await addItem(owner, deal.id, orgs[2]!, 'Bachelor of Nursing');
      const moved = await move(owner, item.id, stage(items, 'Submitted'));
      expect(moved.parentAdvance?.outcome).toBe('blocked');
      expect(moved.parentAdvance?.message).toMatch(/Expected close/i);
      expect((await listItemsForOpportunity(owner, deal.id))[0]?.stageName).toBe('Submitted');
      expect((await getOpportunity(owner, deal.id)).stageName).toBe('New');
    } finally {
      await saveStageRules(owner, {
        id: proposal.id,
        ownerUserId: null,
        ownerTeamId: null,
        onEnter: 'notify',
        requiredFields: [],
        checklist: [],
        requiresApproval: false,
      });
    }
  });

  it('refuses a lost stage, or a stage that is not an opportunity stage, as the target', async () => {
    await expectCode(
      () =>
        saveItemStageAdvance(owner, {
          id: stage(items, 'Offered'),
          advancesParentToStageId: stage(sales, 'Lost'),
        }),
      'VALIDATION',
    );
    await expectCode(
      () =>
        saveItemStageAdvance(owner, {
          id: stage(items, 'Offered'),
          advancesParentToStageId: stage(items, 'Accepted'),
        }),
      'VALIDATION',
    );
    await expectCode(
      () =>
        saveItemStageAdvance(owner, {
          id: stage(sales, 'Proposal'),
          advancesParentToStageId: stage(sales, 'Negotiation'),
        }),
      'NOT_FOUND',
    );
  });
});

describe('access follows the opportunity', () => {
  it("consultant cannot view, add to or move another consultant's items", async () => {
    const deal = await newDeal(max, 'Finley');
    const item = await addItem(max, deal.id, orgs[0]!, 'Hidden application');

    await expectCode(() => listItemsForOpportunity(mia, deal.id), 'NOT_FOUND');
    await expectCode(() => addItem(mia, deal.id, orgs[0]!, 'Smuggled'), 'NOT_FOUND');
    await expectCode(() => move(mia, item.id, stage(items, 'Submitted')), 'NOT_FOUND');
    await expectCode(
      () =>
        updateItem(
          mia,
          updateItemSchema.parse({ id: item.id, organizationId: orgs[0]!, title: 'Renamed' }),
        ),
      'NOT_FOUND',
    );
    const atOrganization = await listItemsForOrganization(mia, orgs[0]!);
    expect(atOrganization.map((row) => row.id)).not.toContain(item.id);
    expect((await listItemsForOrganization(max, orgs[0]!)).map((row) => row.id)).toContain(item.id);
  });

  it('another business cannot read or move an item, even by id', async () => {
    const deal = await newDeal(owner, 'Gray');
    const item = await addItem(owner, deal.id, orgs[1]!, 'Private application');
    await expectCode(() => listItemsForOpportunity(other.ctx, deal.id), 'NOT_FOUND');
    await expectCode(() => move(other.ctx, item.id, stage(items, 'Submitted')), 'NOT_FOUND');
    const seen = (await withRls(other.ctx, (tx) =>
      tx.execute(sql`select id from opportunity_items where id = ${item.id}`),
    )) as unknown as unknown[];
    expect(seen).toHaveLength(0);
  });

  it('hides revenue from someone who may not see it, and does not let their edit erase it', async () => {
    const deal = await newDeal(owner, 'Harper');
    const item = await addItem(owner, deal.id, orgs[2]!, 'Master of Design', {
      baseAmount: '20000',
      revenueRate: '10',
    });
    const seen = (await listItemsForOpportunity(ops, deal.id))[0];
    expect(seen).toMatchObject({ baseAmount: null, revenueRate: null, expectedRevenue: null });

    await updateItem(
      ops,
      updateItemSchema.parse({
        id: item.id,
        organizationId: orgs[2]!,
        title: 'Master of Design (Feb)',
        baseAmount: '',
        revenueRate: '',
      }),
    );
    const kept = (await listItemsForOpportunity(owner, deal.id))[0];
    expect(kept).toMatchObject({
      title: 'Master of Design (Feb)',
      baseAmount: '20000.00',
      revenueRate: '10.0000',
      expectedRevenue: '2000.00',
    });
  });

  it('removing an item needs the delete permission on its opportunity', async () => {
    const deal = await newDeal(mia, 'Indy');
    const item = await addItem(mia, deal.id, orgs[0]!, 'Withdrawn idea');
    await expectCode(() => deleteItem(mia, item.id), 'FORBIDDEN');
    await deleteItem(owner, item.id);
    expect(await listItemsForOpportunity(mia, deal.id)).toHaveLength(0);
  });
});

describe('item pipelines in Settings', () => {
  it('will not switch off a stage or a pipeline that still holds open items', async () => {
    const deal = await newDeal(owner, 'Jules');
    await addItem(owner, deal.id, orgs[0]!, 'Holding the first stage');
    await expectCode(
      () => toggleStage(owner, { id: stage(items, 'Preparing'), isActive: false }),
      'CONFLICT',
    );
  });

  it('cannot point an opportunity pipeline at another business’s item pipeline', async () => {
    await expectCode(
      () =>
        savePipeline(other.ctx, {
          id: undefined,
          name: 'Borrowed',
          objectType: 'opportunity',
          leadType: null,
          itemPipelineId: items.id,
          description: null,
        }),
      'VALIDATION',
    );
  });
});
