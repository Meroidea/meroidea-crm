import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { AppError } from '@/lib/errors';
import { getRecentActivity } from '@/modules/activities/queries';
import { importContactsChunk } from '@/modules/imports/service';
import { getWorkspaceCounts } from '@/modules/members/queries';
import { createContactSchema } from '@/modules/contacts/schemas';
import { createContact } from '@/modules/contacts/service';
import { createOpportunitySchema } from '@/modules/opportunities/schemas';
import { createOpportunity, moveStage } from '@/modules/opportunities/service';
import { listPartners } from '@/modules/partners/queries';
import { partnerFieldsSchema } from '@/modules/partners/schemas';
import { createPartner } from '@/modules/partners/service';
import { getPipelineConfig } from '@/modules/pipelines/queries';
import { getDashboard, getReports } from '@/modules/reports/queries';
import { getSettingsLists } from '@/modules/settings/queries';
import { changeMemberRole, toggleStage } from '@/modules/settings/service';
import { countTasks, getMyDay } from '@/modules/tasks/queries';
import type { TenantContext } from '@/server/context';

import { addMember, contextFor, createWorkspace, destroyWorkspace } from '../support/workspaces';

const stamp = Date.now();
const mail = (name: string) => `${name}-${stamp}@example.com`;

let tenantId: string;
let userIds: string[];
let owner: TenantContext;
let member: TenantContext;

async function expectCode(run: () => Promise<unknown>, code: AppError['code']) {
  const error = await run().then(
    () => null,
    (caught: unknown) => caught,
  );
  expect(error).toBeInstanceOf(AppError);
  expect((error as AppError).code).toBe(code);
}

beforeAll(async () => {
  const workspace = await createWorkspace('Epsilon Labs', mail('eps-owner'));
  const memberId = await addMember(workspace.tenantId, mail('eps-member'), 'Eli Member', 'member');
  tenantId = workspace.tenantId;
  userIds = [workspace.ownerId, memberId];
  owner = await contextFor(workspace.ownerId, tenantId);
  member = await contextFor(memberId, tenantId);

  const contact = await createContact(owner, createContactSchema.parse({ firstName: 'Won' }));
  const deal = await createOpportunity(
    owner,
    createOpportunitySchema.parse({ name: 'Big win', contactId: contact.id, amount: '5000' }),
  );
  const won = (await getPipelineConfig(owner)).stages.find((stage) => stage.category === 'won');
  if (!won) throw new Error('no won stage');
  await moveStage(owner, {
    id: deal.id,
    stageId: won.id,
    lostReasonId: null,
    lostReasonNote: null,
  });
}, 120_000);

afterAll(async () => {
  if (tenantId) await destroyWorkspace(tenantId, userIds);
}, 60_000);

describe('dashboard and reports', () => {
  it('builds the dashboard with this month’s win and a 100% win rate', async () => {
    const dashboard = await getDashboard(owner);
    expect(dashboard?.kpis.wonThisMonthCount).toBe(1);
    expect(dashboard?.kpis.wonThisMonthValue).toBe('5000.00');
    expect(dashboard?.kpis.winRate).toBe(100);
    expect(dashboard?.trend).toHaveLength(6);
  });

  it("keeps a consultant's dashboard to their own records", async () => {
    const dashboard = await getDashboard(member);
    expect(dashboard?.kpis.wonThisMonthCount).toBe(0);
  });

  it('runs every report for each range', async () => {
    for (const range of [30, 90, 365] as const) {
      const report = await getReports(owner, range);
      expect(report.funnel[0]?.reached).toBe(1);
      expect(report.bySource.length).toBeGreaterThan(0);
    }
  });

  it('counts tasks and builds My Day and the activity feed', async () => {
    expect((await countTasks(owner, {})).open).toBe(0);
    expect((await getMyDay(owner)).overdue).toEqual([]);
    expect((await getRecentActivity(owner)).length).toBeGreaterThan(0);
    expect((await getRecentActivity(member)).length).toBe(0);
    expect((await getWorkspaceCounts(owner)).opportunities).toBe(1);
  });
});

describe('partners, settings and import', () => {
  it('creates a partner with a new organization, and a consultant cannot', async () => {
    await createPartner(
      owner,
      partnerFieldsSchema.parse({
        organizationName: 'Referral Co',
        commissionType: 'percentage',
        commissionValue: '12',
      }),
    );
    expect((await listPartners(owner)).map((row) => row.name)).toContain('Referral Co');
    await expectCode(
      () => createPartner(member, partnerFieldsSchema.parse({ organizationName: 'Nope' })),
      'FORBIDDEN',
    );
  });

  it('keeps at least one active won stage and one owner', async () => {
    const won = (await getPipelineConfig(owner)).stages.find((stage) => stage.category === 'won');
    if (!won) throw new Error('no won stage');
    await expectCode(() => toggleStage(owner, { id: won.id, isActive: false }), 'CONFLICT');

    const lists = await getSettingsLists(owner);
    const memberRole = lists.roles.find((role) => role.key === 'member');
    if (!memberRole) throw new Error('no member role');
    await expectCode(
      () => changeMemberRole(owner, { userId: owner.userId, roleId: memberRole.id }),
      'CONFLICT',
    );
    await expectCode(() => getSettingsLists(member), 'FORBIDDEN');
  });

  it('imports valid rows, skips duplicates and reports bad ones', async () => {
    const result = await importContactsChunk(owner, {
      rows: [
        { fullName: 'Ana Lima', email: `ana-${stamp}@example.com` },
        { fullName: 'Ana Again', email: `ANA-${stamp}@example.com` },
        { email: 'no-name@example.com' },
      ],
      firstRowNumber: 2,
      sourceId: null,
      duplicates: 'skip',
    });
    expect(result).toMatchObject({ created: 1, skippedDuplicates: 1 });
    expect(result.invalid.map((row) => row.row)).toEqual([4]);
    await expectCode(
      () =>
        importContactsChunk(member, {
          rows: [{ fullName: 'X' }],
          firstRowNumber: 2,
          sourceId: null,
          duplicates: 'skip',
        }),
      'FORBIDDEN',
    );
  });
});
