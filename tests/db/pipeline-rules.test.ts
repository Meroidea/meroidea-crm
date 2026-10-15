import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { AppError } from '@/lib/errors';
import { saveStageRules, savePipeline } from '@/modules/crm-config/service';
import { createContactSchema } from '@/modules/contacts/schemas';
import { createContact } from '@/modules/contacts/service';
import { createOpportunitySchema } from '@/modules/opportunities/schemas';
import {
  createOpportunity,
  decideApproval,
  moveStage,
  setChecklistItem,
} from '@/modules/opportunities/service';
import { loadPipelineConfig } from '@/modules/pipelines/queries';
import type { TenantContext } from '@/server/context';
import { adminDb } from '@/server/db/admin';
import { withRls } from '@/server/db/with-rls';

import {
  addMember,
  contextFor,
  createTeam,
  createWorkspace,
  destroyWorkspace,
} from '../support/workspaces';

/*
 * docs/leads.md §4.8: stages can require fields, a checklist and a manager's approval before an
 * opportunity moves on, and can hand the opportunity to a stage owner.
 */

const stamp = Date.now();
const mail = (name: string) => `${name}-${stamp}@example.com`;

let tenantId: string;
const users: string[] = [];
let admin: TenantContext;
let manager: TenantContext;
let rep: TenantContext;
let delivery: TenantContext;
let contactId: string;
let stages: { id: string; name: string; category: string }[];

async function expectCode(run: () => Promise<unknown>, code: AppError['code']) {
  const error = await run().then(
    () => null,
    (caught: unknown) => caught,
  );
  expect(error).toBeInstanceOf(AppError);
  expect((error as AppError).code).toBe(code);
}

const stage = (name: string) => stages.find((candidate) => candidate.name === name)!;

const newOpportunity = (overrides: Record<string, unknown> = {}) =>
  createOpportunity(
    rep,
    createOpportunitySchema.parse({ name: `Deal ${Math.random()}`, contactId, ...overrides }),
  );

const row = async (id: string) =>
  (
    (await adminDb().execute(
      sql`select stage_id, owner_user_id from opportunities where id = ${id}`,
    )) as unknown as { stage_id: string; owner_user_id: string }[]
  )[0]!;

beforeAll(async () => {
  const workspace = await createWorkspace(`Pipeline Co ${stamp}`, mail('pipe-admin'));
  tenantId = workspace.tenantId;
  users.push(workspace.ownerId);
  const managerId = await addMember(tenantId, mail('pipe-manager'), 'Morgan Manager', 'manager');
  const teamId = await createTeam(tenantId, `Sales ${stamp}`, managerId);
  await adminDb().execute(
    sql`update tenant_memberships set team_id = ${teamId} where user_id = ${managerId}`,
  );
  const repId = await addMember(tenantId, mail('pipe-rep'), 'Reese Rep', 'member', teamId);
  const deliveryId = await addMember(tenantId, mail('pipe-delivery'), 'Dana Delivery', 'member');
  users.push(managerId, repId, deliveryId);
  admin = await contextFor(workspace.ownerId, tenantId);
  manager = await contextFor(managerId, tenantId);
  rep = await contextFor(repId, tenantId);
  delivery = await contextFor(deliveryId, tenantId);

  contactId = (await createContact(rep, createContactSchema.parse({ firstName: 'Pat' }))).id;
  const config = await withRls(admin, (tx) => loadPipelineConfig(tx, admin));
  stages = config.stages;

  // Qualified needs a value and an expected close; Contacted has a checklist; Negotiation needs
  // approval; Won hands the opportunity to delivery as a task.
  await saveStageRules(admin, {
    id: stage('Qualified').id,
    ownerUserId: null,
    ownerTeamId: null,
    onEnter: 'notify',
    requiredFields: ['amount', 'expectedCloseDate'],
    checklist: [],
    requiresApproval: false,
  });
  await saveStageRules(admin, {
    id: stage('Contacted').id,
    ownerUserId: null,
    ownerTeamId: null,
    onEnter: 'notify',
    requiredFields: [],
    checklist: [{ id: 'needs', label: 'Needs confirmed' }],
    requiresApproval: false,
  });
  await saveStageRules(admin, {
    id: stage('Negotiation').id,
    ownerUserId: null,
    ownerTeamId: null,
    onEnter: 'notify',
    requiredFields: [],
    checklist: [],
    requiresApproval: true,
  });
  await saveStageRules(admin, {
    id: stage('Won').id,
    ownerUserId: delivery.userId,
    ownerTeamId: null,
    onEnter: 'task',
    requiredFields: [],
    checklist: [],
    requiresApproval: false,
  });
});

afterAll(async () => {
  await destroyWorkspace(tenantId, users);
});

describe('stage gates', () => {
  it('blocks moving into a stage until its required fields are filled', async () => {
    const { id } = await newOpportunity();
    await expectCode(
      () =>
        moveStage(rep, {
          id,
          stageId: stage('Qualified').id,
          lostReasonId: null,
          lostReasonNote: null,
        }),
      'VALIDATION',
    );
    const ok = await newOpportunity({ amount: '1200', expectedCloseDate: '2027-01-31' });
    await moveStage(rep, {
      id: ok.id,
      stageId: stage('Qualified').id,
      lostReasonId: null,
      lostReasonNote: null,
    });
    expect((await row(ok.id)).stage_id).toBe(stage('Qualified').id);
  });

  it('blocks leaving a stage until its checklist is done, but not moving back', async () => {
    const { id } = await newOpportunity({
      stageId: stage('Contacted').id,
      amount: '500',
      expectedCloseDate: '2027-02-01',
    });
    await expectCode(
      () =>
        moveStage(rep, {
          id,
          stageId: stage('Qualified').id,
          lostReasonId: null,
          lostReasonNote: null,
        }),
      'VALIDATION',
    );
    await moveStage(rep, {
      id,
      stageId: stage('New').id,
      lostReasonId: null,
      lostReasonNote: null,
    });
    await moveStage(rep, {
      id,
      stageId: stage('Contacted').id,
      lostReasonId: null,
      lostReasonNote: null,
    });
    await setChecklistItem(rep, {
      id,
      stageId: stage('Contacted').id,
      itemId: 'needs',
      done: true,
    });
    await moveStage(rep, {
      id,
      stageId: stage('Qualified').id,
      lostReasonId: null,
      lostReasonNote: null,
    });
    expect((await row(id)).stage_id).toBe(stage('Qualified').id);
  });

  it('turns a move into an approval request, which a manager approves', async () => {
    const { id } = await newOpportunity({ stageId: stage('Proposal').id });
    const result = await moveStage(rep, {
      id,
      stageId: stage('Negotiation').id,
      lostReasonId: null,
      lostReasonNote: null,
    });
    expect(result.pendingApproval).toBe(true);
    expect((await row(id)).stage_id).toBe(stage('Proposal').id);

    const [request] = (await adminDb().execute(
      sql`select id from stage_approvals where opportunity_id = ${id} and status = 'pending'`,
    )) as unknown as { id: string }[];
    await expectCode(
      () => decideApproval(rep, { approvalId: request!.id, approve: true, note: null }),
      'FORBIDDEN',
    );
    await decideApproval(manager, { approvalId: request!.id, approve: true, note: 'Discount ok' });
    expect((await row(id)).stage_id).toBe(stage('Negotiation').id);
  });

  it('applies the same rules to a new opportunity as to a move: no starting past an approval or closed', async () => {
    await expectCode(() => newOpportunity({ stageId: stage('Negotiation').id }), 'VALIDATION');
    const won = stages.find((candidate) => candidate.category === 'won')!;
    await expectCode(() => newOpportunity({ stageId: won.id }), 'VALIDATION');
  });

  it('gives the stage owner a task when an opportunity is won', async () => {
    const { id } = await newOpportunity({ stageId: stage('Proposal').id });
    await moveStage(admin, {
      id,
      stageId: stage('Won').id,
      lostReasonId: null,
      lostReasonNote: null,
    });
    const tasks = (await adminDb().execute(
      sql`select assigned_to from tasks where opportunity_id = ${id}`,
    )) as unknown as { assigned_to: string }[];
    expect(tasks.map((task) => task.assigned_to)).toContain(delivery.userId);
  });
});

describe('several pipelines', () => {
  it('starts a new pipeline with working stages and keeps opportunities in their own pipeline', async () => {
    const { id: pipelineId } = await savePipeline(admin, {
      name: 'Rentals',
      leadType: 'b2c',
      description: null,
    });
    const config = await withRls(admin, (tx) => loadPipelineConfig(tx, admin, pipelineId));
    expect(config.stages.length).toBeGreaterThan(3);
    const { id } = await newOpportunity({ pipelineId });
    // A stage of another pipeline is refused.
    await expectCode(
      () =>
        moveStage(rep, {
          id,
          stageId: stage('Contacted').id,
          lostReasonId: null,
          lostReasonNote: null,
        }),
      'VALIDATION',
    );
  });
});
