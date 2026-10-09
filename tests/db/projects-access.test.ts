import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { projectTasks, taskTimeLogs } from '@/db/schema';
import { zonedToday } from '@/lib/dates';
import { AppError } from '@/lib/errors';
import { getProductivity } from '@/modules/productivity/queries';
import {
  getProject,
  getRunningTimer,
  listMyOpenTasks,
  listProjects,
  listProjectTasks,
} from '@/modules/projects/queries';
import { logTimeSchema, saveProjectSchema, saveTaskSchema } from '@/modules/projects/schemas';
import {
  deleteProject,
  logTime,
  saveProject,
  saveTask,
  setTaskStatus,
  startTimer,
  stopTimer,
} from '@/modules/projects/service';
import type { TenantContext } from '@/server/context';
import { adminDb } from '@/server/db/admin';
import { withRls } from '@/server/db/with-rls';

import { addMember, contextFor, createWorkspace, destroyWorkspace } from '../support/workspaces';

const stamp = Date.now();
const mail = (name: string) => `${name}-${stamp}@example.com`;

let alphaTenant: string;
let betaTenant: string;
let alphaUsers: string[];
let betaUsers: string[];
let owner: TenantContext;
let gale: TenantContext;
let harper: TenantContext;
let betaOwner: TenantContext;
let projectId: string;
let galeTask: string;
let harperTask: string;
let today: string;

const code = (promise: Promise<unknown>) =>
  promise.then(
    () => 'OK',
    (error: unknown) => (error instanceof AppError ? error.code : String(error)),
  );

const task = (title: string, assigneeUserId: string, extra = {}) =>
  saveTaskSchema.parse({ projectId, title, assigneeUserId, ...extra });

beforeAll(async () => {
  const alpha = await createWorkspace(`Work Alpha ${stamp}`, mail('pm-alpha-owner'));
  const beta = await createWorkspace(`Work Beta ${stamp}`, mail('pm-beta-owner'));
  alphaTenant = alpha.tenantId;
  betaTenant = beta.tenantId;
  const galeId = await addMember(alphaTenant, mail('pm-gale'), 'Gale Goer', 'member');
  const harperId = await addMember(alphaTenant, mail('pm-harper'), 'Harper Hand', 'member');
  alphaUsers = [alpha.ownerId, galeId, harperId];
  betaUsers = [beta.ownerId];
  owner = await contextFor(alpha.ownerId, alphaTenant);
  gale = await contextFor(galeId, alphaTenant);
  harper = await contextFor(harperId, alphaTenant);
  betaOwner = await contextFor(beta.ownerId, betaTenant);
  today = zonedToday(owner.tenant.timezone);
});

afterAll(async () => {
  await destroyWorkspace(alphaTenant, alphaUsers);
  await destroyWorkspace(betaTenant, betaUsers);
});

describe('projects and tasks', () => {
  it('the forms accept their own output and turn hours into minutes', () => {
    const project = saveProjectSchema.parse({ name: 'Shop refit', leadUserId: '', dueOn: '' });
    expect(saveProjectSchema.parse(project)).toEqual(project);
    expect(
      saveTaskSchema.parse({ projectId: owner.tenantId, title: 'Paint', estimateHours: '1.5' }),
    ).toMatchObject({ estimateHours: 90, assigneeUserId: null });
    expect(
      logTimeSchema.parse({ taskId: owner.tenantId, date: '2031-01-01', hours: '0.25' }).hours,
    ).toBe(15);
    expect(
      logTimeSchema.safeParse({ taskId: owner.tenantId, date: '2031-01-01', hours: '30' }).success,
    ).toBe(false);
    expect(
      saveProjectSchema.safeParse({
        name: 'Backwards',
        startsOn: '2031-02-02',
        dueOn: '2031-02-01',
      }).success,
    ).toBe(false);
  });

  it('a manager creates a project and assigns tasks; staff cannot', async () => {
    const input = saveProjectSchema.parse({ name: 'Shop refit', leadUserId: gale.userId });
    expect(await code(saveProject(gale, input))).toBe('FORBIDDEN');
    projectId = (await saveProject(owner, input)).id;
    galeTask = (
      await saveTask(
        owner,
        task('Paint the walls', gale.userId, { estimateHours: '2', dueOn: today }),
      )
    ).id;
    harperTask = (await saveTask(owner, task('Order shelving', harper.userId))).id;
    expect(await code(saveTask(gale, task('Sneaky task', gale.userId)))).toBe('FORBIDDEN');
    expect(await getProject(gale, projectId)).toMatchObject({
      tasks: 2,
      done: 0,
      leadName: 'Gale Goer',
    });
    expect((await listMyOpenTasks(gale)).map((row) => row.title)).toEqual(['Paint the walls']);
  });

  it('a task cannot be assigned to someone outside the business', async () => {
    expect(await code(saveTask(owner, task('For a stranger', betaOwner.userId)))).toBe(
      'VALIDATION',
    );
  });

  it('another business sees and changes nothing', async () => {
    expect(await listProjects(betaOwner)).toEqual([]);
    expect(await getProject(betaOwner, projectId)).toBeNull();
    expect(await listProjectTasks(betaOwner, projectId)).toEqual([]);
    expect(await code(setTaskStatus(betaOwner, { id: galeTask, status: 'done' }))).toBe(
      'NOT_FOUND',
    );
    expect(await code(startTimer(betaOwner, galeTask))).toBe('NOT_FOUND');
    expect(await code(deleteProject(betaOwner, projectId))).toBe('NOT_FOUND');
  });

  it("people move their own tasks, not a colleague's, even straight at the database", async () => {
    expect(await code(setTaskStatus(gale, { id: harperTask, status: 'done' }))).toBe('FORBIDDEN');
    await withRls(gale, (tx) => tx.update(projectTasks).set({ status: 'done' }));
    const tasks = await listProjectTasks(owner, projectId);
    expect(tasks.find((row) => row.id === harperTask)?.status).toBe('todo');
    // The raw update only reached Gale's own task; put it back.
    await setTaskStatus(gale, { id: galeTask, status: 'todo' });
  });
});

describe('timing work', () => {
  it('starting a timer moves the task along, and only one runs at a time', async () => {
    await startTimer(gale, galeTask);
    expect((await getRunningTimer(gale))?.taskId).toBe(galeTask);
    expect(
      (await listProjectTasks(gale, projectId)).find((row) => row.id === galeTask)?.status,
    ).toBe('in_progress');
    await expect(
      withRls(gale, (tx) =>
        tx.insert(taskTimeLogs).values({
          tenantId: alphaTenant,
          projectTaskId: galeTask,
          userId: gale.userId,
          startedAt: new Date(),
        }),
      ),
    ).rejects.toThrow();
    await stopTimer(gale);
    expect(await getRunningTimer(gale)).toBeNull();
    expect(await code(stopTimer(gale))).toBe('CONFLICT');
  });

  it("nobody times a colleague's task or logs time for someone else", async () => {
    expect(await code(startTimer(gale, harperTask))).toBe('FORBIDDEN');
    expect(
      await code(
        logTime(gale, logTimeSchema.parse({ taskId: harperTask, date: today, hours: '1' })),
      ),
    ).toBe('FORBIDDEN');
    await expect(
      withRls(gale, (tx) =>
        tx.insert(taskTimeLogs).values({
          tenantId: alphaTenant,
          projectTaskId: harperTask,
          userId: harper.userId,
          startedAt: new Date(),
          endedAt: new Date(),
          minutes: 60,
        }),
      ),
    ).rejects.toThrow();
  });

  it('time typed in afterwards adds to the task, and the future is refused', async () => {
    await logTime(gale, logTimeSchema.parse({ taskId: galeTask, date: today, hours: '1.5' }));
    await logTime(harper, logTimeSchema.parse({ taskId: harperTask, date: today, hours: '2' }));
    expect(
      await code(
        logTime(gale, logTimeSchema.parse({ taskId: galeTask, date: '2099-01-01', hours: '1' })),
      ),
    ).toBe('VALIDATION');
    const seenByOwner = await listProjectTasks(owner, projectId);
    // 90 typed in plus the one-minute timer run.
    expect(seenByOwner.find((row) => row.id === galeTask)?.loggedMinutes).toBe(91);
    // A colleague's logged time stays private to them and to managers.
    const seenByGale = await listProjectTasks(gale, projectId);
    expect(seenByGale.find((row) => row.id === harperTask)?.loggedMinutes).toBe(0);
  });
});

describe('the productivity report', () => {
  it('adds up each person and is closed to general staff and other businesses', async () => {
    await setTaskStatus(gale, { id: galeTask, status: 'done' });
    const range = { from: today, to: today };
    expect(await code(getProductivity(gale, range))).toBe('FORBIDDEN');

    const rows = await getProductivity(owner, range);
    expect(rows.map((row) => row.fullName)).toContain('Gale Goer');
    expect(rows.find((row) => row.userId === gale.userId)).toMatchObject({
      projectMinutes: 91,
      tasksCompleted: 1,
      tasksWithDueDate: 1,
      tasksOnTime: 1,
      tasksOverdue: 0,
      clockedMinutes: 0,
      rosteredMinutes: 0,
    });
    expect(rows.find((row) => row.userId === harper.userId)).toMatchObject({
      projectMinutes: 120,
      tasksCompleted: 0,
    });

    const elsewhere = await getProductivity(betaOwner, range);
    expect(elsewhere.every((row) => row.projectMinutes === 0)).toBe(true);
    expect(elsewhere.map((row) => row.userId)).toEqual([betaOwner.userId]);
  });

  it('counts a task past its due date as overdue until it is done', async () => {
    const { id } = await saveTask(owner, task('Late one', harper.userId, { dueOn: '2020-01-01' }));
    const range = { from: today, to: today };
    const before = await getProductivity(owner, range);
    expect(before.find((row) => row.userId === harper.userId)?.tasksOverdue).toBe(1);
    await setTaskStatus(harper, { id, status: 'done' });
    const after = await getProductivity(owner, range);
    expect(after.find((row) => row.userId === harper.userId)).toMatchObject({
      tasksOverdue: 0,
      tasksCompleted: 1,
      tasksWithDueDate: 1,
      tasksOnTime: 0,
    });
  });

  it('shows a dash rather than a partial number when a kind of time is switched off', async () => {
    await adminDb().execute(
      sql`update tenants set features = array_remove(features, 'timesheets') where id = ${alphaTenant}`,
    );
    const ctx = await contextFor(owner.userId, alphaTenant);
    const rows = await getProductivity(ctx, { from: today, to: today });
    expect(rows.every((row) => row.clockedMinutes === null)).toBe(true);
    expect(rows.find((row) => row.userId === gale.userId)?.projectMinutes).toBe(91);
  });
});

describe('removing a project', () => {
  it('takes its tasks with it', async () => {
    await deleteProject(owner, projectId);
    expect(await getProject(owner, projectId)).toBeNull();
    expect(await listMyOpenTasks(harper)).toEqual([]);
  });
});
