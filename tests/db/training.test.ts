import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { AppError } from '@/lib/errors';
import { FEATURE_KEYS } from '@/lib/features';
import { inviteMemberSchema } from '@/modules/access/schemas';
import { inviteMember } from '@/modules/access/service';
import {
  listCoursesToManage,
  getCourseToManage,
  getModuleToEdit,
  getModuleToLearn,
  getTeamProgress,
  getTrainingFor,
} from '@/modules/training/queries';
import { courseSchema, moduleSchema } from '@/modules/training/schemas';
import {
  addAssignment,
  createCourse,
  createModule,
  deleteModule,
  setCourseStatus,
  submitModule,
  updateModule,
} from '@/modules/training/service';
import { hasPermission, type TenantContext } from '@/server/context';
import { adminDb } from '@/server/db/admin';
import { withRls } from '@/server/db/with-rls';

import { contextFor, createWorkspace, destroyWorkspace } from '../support/workspaces';

/*
 * ADR-050: the admin writes training and decides who does it; staff see and complete only what
 * is assigned to them; the right answers never reach anyone taking a quiz.
 */

const stamp = Date.now();
const mail = (name: string) => `${name}-${stamp}@example.com`;

let alphaTenant: string;
let betaTenant: string;
const alphaUsers: string[] = [];
const betaUsers: string[] = [];
let admin: TenantContext;
let manager: TenantContext;
let kim: TenantContext; // kitchen, back of house
let fran: TenantContext; // front of house
let outsider: TenantContext;
let kitchenId: string;
let frontId: string;
let staffRoleId: string;

let welcome: string; // everyone
let cash: string; // front of house only
let draft: string; // never published
let menuModule: string;
let policyModule: string;
let cashModule: string;

async function expectCode(run: () => Promise<unknown>, code: AppError['code']) {
  const error = await run().then(
    () => null,
    (caught: unknown) => caught,
  );
  expect(error).toBeInstanceOf(AppError);
  expect((error as AppError).code).toBe(code);
}

async function rejectionMessage(run: () => Promise<unknown>): Promise<string> {
  try {
    await run();
  } catch (error) {
    const wrapped = error as { message?: string; cause?: { message?: string } };
    return `${wrapped.message ?? ''} ${wrapped.cause?.message ?? ''}`;
  }
  throw new Error('expected the query to be rejected');
}

const lesson = (overrides: Record<string, unknown> = {}) =>
  moduleSchema.parse({
    title: 'Our menu',
    body: '## Burgers\n\nEvery burger comes with chips.\n\n- No substitutions\n- Ask about allergies',
    passMark: 50,
    questions: [
      {
        prompt: 'What comes with every burger?',
        options: ['Salad', 'Chips', 'Nothing'],
        correctOption: 1,
      },
      { prompt: 'Can customers substitute items?', options: ['Yes', 'No'], correctOption: 1 },
    ],
    ...overrides,
  });

const questionIds = async (moduleId: string) => {
  const rows = (await adminDb().execute(
    sql`select id from training_questions where module_id = ${moduleId} order by position`,
  )) as unknown as { id: string }[];
  return rows.map((row) => row.id);
};

beforeAll(async () => {
  const alpha = await createWorkspace('Training Cafe', mail('training-alpha'));
  const beta = await createWorkspace('Training Bistro', mail('training-beta'));
  alphaTenant = alpha.tenantId;
  betaTenant = beta.tenantId;
  alphaUsers.push(alpha.ownerId);
  betaUsers.push(beta.ownerId);
  admin = await contextFor(alpha.ownerId, alphaTenant);
  outsider = await contextFor(beta.ownerId, betaTenant);

  const roleRows = (await adminDb().execute(
    sql`select key, id from roles where tenant_id = ${alphaTenant}`,
  )) as unknown as { key: string; id: string }[];
  const roleId = (key: string) => roleRows.find((role) => role.key === key)?.id ?? '';
  staffRoleId = roleId('member');
  const add = async (fullName: string, key: string) => {
    const { userId } = await inviteMember(
      admin,
      inviteMemberSchema.parse({
        fullName,
        email: mail(fullName.split(' ')[0]!.toLowerCase()),
        roleId: roleId(key),
      }),
    );
    alphaUsers.push(userId);
    return userId;
  };
  const managerId = await add('Morgan Manager', 'manager');
  const kimId = await add('Kim Kitchen', 'member');
  const franId = await add('Fran Front', 'member');

  // Departments live on staff records (the hiring lesson); written directly as test fixtures.
  const [kitchen] = (await adminDb().execute(sql`
    insert into departments (tenant_id, name) values (${alphaTenant}, 'Kitchen') returning id`)) as unknown as {
    id: string;
  }[];
  const [front] = (await adminDb().execute(sql`
    insert into departments (tenant_id, name) values (${alphaTenant}, 'Front of house') returning id`)) as unknown as {
    id: string;
  }[];
  kitchenId = kitchen!.id;
  frontId = front!.id;
  for (const [userId, departmentId, name] of [
    [kimId, kitchenId, 'Kim'],
    [franId, frontId, 'Fran'],
  ] as const) {
    await adminDb().execute(sql`
      insert into employees (tenant_id, user_id, first_name, last_name, email, status, department_id)
      values (${alphaTenant}, ${userId}, ${name}, 'Crew', ${mail(`emp-${name}`)}, 'active', ${departmentId})`);
  }

  manager = await contextFor(managerId, alphaTenant);
  kim = await contextFor(kimId, alphaTenant);
  fran = await contextFor(franId, alphaTenant);

  welcome = (
    await createCourse(admin, courseSchema.parse({ title: 'Welcome to the cafe', position: 1 }))
  ).id;
  menuModule = (await createModule(admin, { ...lesson(), courseId: welcome })).id;
  policyModule = (
    await createModule(admin, {
      ...lesson({ title: 'Restaurant policies', questions: [], position: 2 }),
      courseId: welcome,
    })
  ).id;
  cash = (await createCourse(admin, courseSchema.parse({ title: 'Cash handling', position: 2 })))
    .id;
  cashModule = (
    await createModule(admin, {
      ...lesson({
        title: 'Counting the till',
        passMark: 100,
        questions: [
          {
            prompt: 'When is the till counted?',
            options: ['Open', 'Close', 'Both'],
            correctOption: 2,
          },
        ],
      }),
      courseId: cash,
    })
  ).id;
  draft = (await createCourse(admin, courseSchema.parse({ title: 'Not ready yet' }))).id;
  await createModule(admin, { ...lesson({ title: 'Draft module' }), courseId: draft });

  await addAssignment(admin, { courseId: welcome, audience: 'everyone', targetId: null });
  await addAssignment(admin, { courseId: cash, audience: 'department', targetId: frontId });
  await addAssignment(admin, { courseId: draft, audience: 'everyone', targetId: null });
  await setCourseStatus(admin, { id: welcome, status: 'published' });
  await setCourseStatus(admin, { id: cash, status: 'published' });
}, 120_000);

afterAll(async () => {
  for (const tenantId of [alphaTenant, betaTenant]) {
    if (!tenantId) continue;
    for (const table of [
      'training_completions',
      'training_assignments',
      'training_question_keys',
      'training_questions',
      'training_modules',
      'training_courses',
    ]) {
      await adminDb().execute(
        sql`delete from ${sql.identifier(table)} where tenant_id = ${tenantId}`,
      );
    }
    await adminDb().execute(sql`delete from employees where tenant_id = ${tenantId}`);
    await adminDb().execute(sql`delete from departments where tenant_id = ${tenantId}`);
  }
  if (alphaTenant) await destroyWorkspace(alphaTenant, alphaUsers);
  if (betaTenant) await destroyWorkspace(betaTenant, betaUsers);
}, 60_000);

describe('who may do what', () => {
  it('lets everyone learn; managers follow progress; only the admin writes and assigns', async () => {
    expect(hasPermission(kim, 'training.learn')).toBe(true);
    expect(hasPermission(kim, 'training.view_all')).toBe(false);
    expect(hasPermission(manager, 'training.view_all')).toBe(true);
    expect(hasPermission(manager, 'training.manage')).toBe(false);
    expect(hasPermission(admin, 'training.manage')).toBe(true);
    await expectCode(
      () => createCourse(manager, courseSchema.parse({ title: 'Sneaky' })),
      'FORBIDDEN',
    );
    await expectCode(() => createModule(kim, { ...lesson(), courseId: welcome }), 'FORBIDDEN');
  });

  it('refuses writes past the service too', async () => {
    const message = await rejectionMessage(() =>
      withRls(manager, (tx) =>
        tx.execute(
          sql`insert into training_courses (tenant_id, title) values (${alphaTenant}, 'Sneaky')`,
        ),
      ),
    );
    expect(message).toMatch(/row-level security/i);
  });

  it('keeps a published course from losing its last module, and refuses a role from elsewhere', async () => {
    const solo = (await createCourse(admin, courseSchema.parse({ title: 'Solo course' }))).id;
    const only = (await createModule(admin, { ...lesson({ questions: [] }), courseId: solo })).id;
    await setCourseStatus(admin, { id: solo, status: 'published' });
    await expectCode(() => deleteModule(admin, only), 'CONFLICT');
    await setCourseStatus(admin, { id: solo, status: 'draft' });
    await deleteModule(admin, only);

    const otherRole = (await adminDb().execute(
      sql`select id from roles where tenant_id = ${betaTenant} and key = 'member'`,
    )) as unknown as { id: string }[];
    await expectCode(
      () => addAssignment(admin, { courseId: solo, audience: 'role', targetId: otherRole[0]!.id }),
      'VALIDATION',
    );
  });

  it('will not publish an empty course', async () => {
    const empty = (await createCourse(admin, courseSchema.parse({ title: 'Empty course' }))).id;
    await expectCode(() => setCourseStatus(admin, { id: empty, status: 'published' }), 'CONFLICT');
  });
});

describe('what the admin sees of each course', () => {
  it('counts modules, quiz questions, assignments and completions per course', async () => {
    const courses = await listCoursesToManage(admin);
    expect(courses.find((course) => course.id === welcome)).toMatchObject({
      modules: 2,
      assignments: 1,
      status: 'published',
    });
    const detail = await getCourseToManage(admin, welcome);
    expect(detail?.modules.map((row) => row.questions)).toEqual([2, 0]);
    expect(
      (await getTrainingFor(kim, kim.userId)).courses[0]?.modules.map((row) => row.questions),
    ).toEqual([2, 0]);
  });
});

describe('what each person must do', () => {
  it('gives everyone the course assigned to everyone', async () => {
    expect((await getTrainingFor(kim, kim.userId)).courses.map((c) => c.title)).toEqual([
      'Welcome to the cafe',
    ]);
  });

  it('gives a department’s course only to that department', async () => {
    expect((await getTrainingFor(fran, fran.userId)).courses.map((c) => c.title)).toEqual([
      'Welcome to the cafe',
      'Cash handling',
    ]);
    // The kitchen cannot open front of house training, in the service or at the database.
    expect(await getModuleToLearn(kim, cashModule)).toBeNull();
    const rows = (await withRls(kim, (tx) =>
      tx.execute(sql`select count(*)::int as n from training_courses where id = ${cash}`),
    )) as unknown as { n: number }[];
    expect(rows[0]?.n).toBe(0);
  });

  it('assigns by role and by person too', async () => {
    const roleCourse = (await createCourse(admin, courseSchema.parse({ title: 'For staff' }))).id;
    await createModule(admin, { ...lesson({ questions: [] }), courseId: roleCourse });
    await addAssignment(admin, { courseId: roleCourse, audience: 'role', targetId: staffRoleId });
    const personCourse = (await createCourse(admin, courseSchema.parse({ title: 'For Morgan' })))
      .id;
    await createModule(admin, { ...lesson({ questions: [] }), courseId: personCourse });
    await addAssignment(admin, {
      courseId: personCourse,
      audience: 'person',
      targetId: manager.userId,
    });
    await setCourseStatus(admin, { id: roleCourse, status: 'published' });
    await setCourseStatus(admin, { id: personCourse, status: 'published' });

    const titles = async (ctx: TenantContext) =>
      (await getTrainingFor(ctx, ctx.userId)).courses.map((course) => course.title);
    expect(await titles(kim)).toContain('For staff');
    expect(await titles(manager)).not.toContain('For staff');
    expect(await titles(manager)).toContain('For Morgan');
    expect(await titles(kim)).not.toContain('For Morgan');

    // Tidied away so the remaining tests see only the cafe's two courses.
    await setCourseStatus(admin, { id: roleCourse, status: 'archived' });
    await setCourseStatus(admin, { id: personCourse, status: 'archived' });
    expect(await titles(kim)).not.toContain('For staff');
  });

  it('keeps an unpublished course from everyone it is assigned to', async () => {
    expect((await getTrainingFor(kim, kim.userId)).courses.map((c) => c.title)).not.toContain(
      'Not ready yet',
    );
  });
});

describe('taking a module', () => {
  it('never shows the person taking the quiz which answers are right', async () => {
    const learning = await getModuleToLearn(kim, menuModule);
    expect(learning?.questions).toHaveLength(2);
    expect(JSON.stringify(learning)).not.toMatch(/correct/i);
    const rows = (await withRls(kim, (tx) =>
      tx.execute(sql`select count(*)::int as n from training_question_keys`),
    )) as unknown as { n: number }[];
    expect(rows[0]?.n).toBe(0);
    await expectCode(() => getModuleToEdit(kim, menuModule), 'FORBIDDEN');
  });

  it('marks the answers against the pass mark and keeps the best score', async () => {
    const [chips, substitutions] = await questionIds(menuModule);
    await expectCode(
      () => submitModule(kim, { id: menuModule, answers: { [chips!]: 1 } }),
      'VALIDATION',
    );
    expect(
      await submitModule(kim, { id: menuModule, answers: { [chips!]: 0, [substitutions!]: 0 } }),
    ).toEqual({ passed: false, score: 0 });
    expect(
      await submitModule(kim, { id: menuModule, answers: { [chips!]: 1, [substitutions!]: 1 } }),
    ).toEqual({ passed: true, score: 100 });
    // A later worse attempt does not undo the pass or lower the best score.
    await submitModule(kim, { id: menuModule, answers: { [chips!]: 1, [substitutions!]: 0 } });
    const menu = (await getTrainingFor(kim, kim.userId)).courses[0]?.modules[0];
    expect(menu).toMatchObject({ status: 'passed', bestScore: 100, attempts: 3 });
  });

  it('records a module without a quiz as done', async () => {
    expect(await submitModule(kim, { id: policyModule, answers: {} })).toEqual({
      passed: true,
      score: null,
    });
    const overview = await getTrainingFor(kim, kim.userId);
    expect(overview).toMatchObject({ total: 2, passed: 2, percent: 100 });
  });

  it('will not let someone complete a module that is not assigned to them', async () => {
    const [till] = await questionIds(cashModule);
    await expectCode(
      () => submitModule(kim, { id: cashModule, answers: { [till!]: 2 } }),
      'NOT_FOUND',
    );
    // Past the service too: the marking function refuses.
    const message = await rejectionMessage(() =>
      withRls(kim, (tx) =>
        tx.execute(sql`select * from app.submit_training_module(${cashModule}, '{}'::jsonb)`),
      ),
    );
    expect(message).toMatch(/not available/i);
  });

  it('lets nobody write a result directly', async () => {
    const message = await rejectionMessage(() =>
      withRls(kim, (tx) =>
        tx.execute(sql`insert into training_completions (tenant_id, module_id, user_id, passed, completed_at)
                       values (${alphaTenant}, ${cashModule}, ${kim.userId}, true, now())`),
      ),
    );
    expect(message).toMatch(/permission denied/i);
  });

  it('keeps the results when the module is edited, and keeps a done module from being deleted', async () => {
    await updateModule(admin, { ...lesson({ title: 'Our menu (spring)' }), id: menuModule });
    expect((await getTrainingFor(kim, kim.userId)).courses[0]?.modules[0]).toMatchObject({
      title: 'Our menu (spring)',
      status: 'passed',
    });
    await expectCode(() => deleteModule(admin, menuModule), 'CONFLICT');
  });
});

describe('following progress', () => {
  it('shows a manager everyone’s progress and each course’s average', async () => {
    const team = await getTeamProgress(manager);
    const kimRow = team.people.find((person) => person.userId === kim.userId);
    const franRow = team.people.find((person) => person.userId === fran.userId);
    expect(kimRow).toMatchObject({ total: 2, passed: 2, percent: 100 });
    expect(franRow).toMatchObject({ total: 3, passed: 0, percent: 0 });
    expect(team.courses.find((course) => course.id === cash)).toMatchObject({
      people: 1,
      percent: 0,
    });
    expect((await getTrainingFor(manager, fran.userId)).courses).toHaveLength(2);
  });

  it('shows staff only their own results', async () => {
    await expectCode(() => getTeamProgress(kim), 'FORBIDDEN');
    await expectCode(() => getTrainingFor(kim, fran.userId), 'FORBIDDEN');
    const rows = (await withRls(fran, (tx) =>
      tx.execute(
        sql`select count(*)::int as n from training_completions where user_id = ${kim.userId}`,
      ),
    )) as unknown as { n: number }[];
    expect(rows[0]?.n).toBe(0);
    const progress = (await withRls(fran, (tx) =>
      tx.execute(sql`select distinct user_id from app.training_progress()`),
    )) as unknown as { user_id: string }[];
    expect(progress.map((row) => row.user_id)).toEqual([fran.userId]);
  });

  it('lets a manager follow progress but not change training', async () => {
    expect(await getCourseToManage(manager, welcome).catch(() => 'refused')).toBe('refused');
  });
});

describe('between businesses', () => {
  it('shows another business nothing', async () => {
    expect(await getModuleToLearn(outsider, menuModule)).toBeNull();
    expect((await getTrainingFor(outsider, outsider.userId)).courses).toEqual([]);
    const rows = (await withRls(outsider, (tx) =>
      tx.execute(sql`select
        (select count(*)::int from training_courses) as courses,
        (select count(*)::int from training_completions) as results`),
    )) as unknown as { courses: number; results: number }[];
    expect(rows[0]).toEqual({ courses: 0, results: 0 });
  });
});

describe('the feature switch', () => {
  it('hides training entirely while the feature is off, and brings it back', async () => {
    const without = FEATURE_KEYS.filter((key) => key !== 'training');
    await adminDb().execute(
      sql`update tenants set features = ${sql.raw(`array[${without.map((key) => `'${key}'`).join(',')}]::text[]`)} where id = ${alphaTenant}`,
    );
    const off = await contextFor(admin.userId, alphaTenant);
    expect(hasPermission(off, 'training.manage')).toBe(false);
    const rows = (await withRls(off, (tx) =>
      tx.execute(sql`select count(*)::int as n from training_courses`),
    )) as unknown as { n: number }[];
    expect(rows[0]?.n).toBe(0);

    await adminDb().execute(
      sql`update tenants set features = array_append(features, 'training') where id = ${alphaTenant}`,
    );
    const on = await contextFor(admin.userId, alphaTenant);
    expect((await getCourseToManage(on, welcome))?.modules).toHaveLength(2);
  });
});
