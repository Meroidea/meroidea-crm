import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { AppError } from '@/lib/errors';
import { FEATURE_KEYS } from '@/lib/features';
import { assistantChatSchema } from '@/modules/assistant/schemas';
import { streamAssistantReply } from '@/modules/assistant/service';
import { buildAssistantTools, type AssistantTools } from '@/modules/assistant/tools';
import { createContactSchema } from '@/modules/contacts/schemas';
import { createContact } from '@/modules/contacts/service';
import { createOpportunitySchema } from '@/modules/opportunities/schemas';
import { createOpportunity } from '@/modules/opportunities/service';
import { createTaskSchema } from '@/modules/tasks/schemas';
import { createTask } from '@/modules/tasks/service';
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

type Result = Record<string, unknown> & {
  overdueTasks?: { title: string }[];
  quietOpportunities?: { opportunity: string }[];
  kpis?: { openCount: number; openValue: string };
  unavailable?: string;
  notes?: string[];
};

/** Runs one tool as the model would, with the person's own context captured inside it. */
async function run<K extends keyof AssistantTools>(
  ctx: TenantContext,
  name: K,
  input: Record<string, unknown>,
): Promise<Result> {
  const tool = buildAssistantTools(ctx)[name];
  const execute = tool.execute as unknown as (input: unknown, options: unknown) => Promise<Result>;
  return execute(input, { toolCallId: 'test', messages: [] });
}

/** The same person with one grant taken away, as an admin editing their role would. */
function without(ctx: TenantContext, ...keys: string[]): TenantContext {
  const grants = new Map(ctx.grants);
  for (const key of keys) grants.delete(key as never);
  return { ...ctx, grants };
}

const pastDay = (daysAgo: number) =>
  new Date(Date.now() - daysAgo * 86_400_000).toISOString().slice(0, 10);

async function overdueTask(ctx: TenantContext, title: string) {
  return createTask(ctx, createTaskSchema.parse({ title, dueDate: pastDay(3) }));
}

async function openDeal(ctx: TenantContext, name: string, amount = '1000') {
  const contact = await createContact(ctx, createContactSchema.parse({ firstName: name }));
  return createOpportunity(
    ctx,
    createOpportunitySchema.parse({ name: `${name} deal`, contactId: contact.id, amount }),
  );
}

async function setFeatures(id: string, features: readonly string[]) {
  const list = sql`array[${sql.join(
    features.map((feature) => sql`${feature}`),
    sql`, `,
  )}]::text[]`;
  await adminDb().execute(sql`update tenants set features = ${list} where id = ${id}`);
}

beforeAll(async () => {
  const a = await createWorkspace('Assist Alpha', mail('assist-owner'));
  const miaId = await addMember(a.tenantId, mail('assist-mia'), 'Mia Member', 'member');
  const maxId = await addMember(a.tenantId, mail('assist-max'), 'Max Member', 'member');
  tenantId = a.tenantId;
  userIds = [a.ownerId, miaId, maxId];
  owner = await contextFor(a.ownerId, tenantId);
  mia = await contextFor(miaId, tenantId);
  max = await contextFor(maxId, tenantId);

  const b = await createWorkspace('Assist Beta', mail('assist-beta-owner'));
  other = {
    tenantId: b.tenantId,
    userIds: [b.ownerId],
    ctx: await contextFor(b.ownerId, b.tenantId),
  };

  await overdueTask(mia, 'Mia private overdue');
  await openDeal(mia, 'MiaSecret', '5000');
  await overdueTask(max, 'Max own overdue');
}, 120_000);

afterAll(async () => {
  if (tenantId) await destroyWorkspace(tenantId, userIds);
  if (other) await destroyWorkspace(other.tenantId, other.userIds);
}, 60_000);

describe('assistant tools follow the person’s scope', () => {
  it('a staff member cannot see another staff member’s overdue follow-ups', async () => {
    const result = await run(max, 'get_overdue_follow_ups', {
      assignee: 'everyone_visible',
      limit: 50,
    });
    const titles = (result.overdueTasks ?? []).map((task) => task.title);
    expect(titles).toContain('Max own overdue');
    expect(titles).not.toContain('Mia private overdue');
  });

  it('a staff member’s pipeline stats leave out another staff member’s opportunities', async () => {
    const maxStats = await run(max, 'get_pipeline_stats', {});
    expect(maxStats.kpis?.openCount).toBe(0);
    const miaStats = await run(mia, 'get_pipeline_stats', {});
    expect(miaStats.kpis?.openCount).toBe(1);
    expect(miaStats.kpis?.openValue).toBe('5000.00');
  });

  it('the admin sees everyone’s overdue follow-ups in their own business', async () => {
    const result = await run(owner, 'get_overdue_follow_ups', {
      assignee: 'everyone_visible',
      limit: 50,
    });
    const titles = (result.overdueTasks ?? []).map((task) => task.title);
    expect(titles).toEqual(expect.arrayContaining(['Mia private overdue', 'Max own overdue']));
  });

  it('another business’s admin sees none of this business’s records', async () => {
    const tasks = await run(other.ctx, 'get_overdue_follow_ups', {
      assignee: 'everyone_visible',
      limit: 50,
    });
    expect(tasks.overdueTasks).toEqual([]);
    expect(tasks.overdueTaskTotal).toBe(0);
    const stats = await run(other.ctx, 'get_pipeline_stats', {});
    expect(stats.kpis?.openCount).toBe(0);
    const report = await run(other.ctx, 'get_sales_report', { rangeDays: 365 });
    expect(JSON.stringify(report)).not.toContain('Mia');
  });

  it('a role without reports gets “unavailable”, not figures', async () => {
    const result = await run(without(mia, 'reports.view'), 'get_pipeline_stats', {});
    expect(result.unavailable).toMatch(/reports/);
    expect(result.kpis).toBeUndefined();
  });

  it('amounts read “hidden” when revenue access is narrower than report access', async () => {
    const result = await run(without(mia, 'revenue.view'), 'get_pipeline_stats', {});
    expect(result.amountsVisible).toBe(false);
    expect(result.kpis?.openValue).toBe('hidden');
  });

  it('a role without tasks still gets quiet opportunities, with a note about tasks', async () => {
    const result = await run(without(mia, 'tasks.view'), 'get_overdue_follow_ups', {
      assignee: 'me',
      limit: 20,
    });
    expect(result.overdueTasks).toBeUndefined();
    expect(result.quietOpportunities).toBeDefined();
    expect(result.notes?.join(' ')).toMatch(/tasks/);
  });
});

describe('assistant access', () => {
  const question = assistantChatSchema.parse({
    messages: [{ role: 'user', parts: [{ type: 'text', text: 'How is my pipeline?' }] }],
  });

  it('is off until the platform owner switches the feature on', async () => {
    await setFeatures(
      tenantId,
      FEATURE_KEYS.filter((feature) => feature !== 'assistant'),
    );
    const ctx = await contextFor(owner.userId, tenantId);
    expect(ctx.grants.has('assistant.use')).toBe(false);
    const error = await streamAssistantReply(ctx, question, new AbortController().signal).then(
      () => null,
      (caught: unknown) => caught,
    );
    expect(error).toBeInstanceOf(AppError);
    expect((error as AppError).code).toBe('FORBIDDEN');
    await setFeatures(tenantId, [...FEATURE_KEYS]);
  });

  it('new businesses give Admin, Manager and Staff the permission by default', async () => {
    expect(owner.grants.get('assistant.use')).toBe(true);
    expect(mia.grants.get('assistant.use')).toBe(true);
  });
});
