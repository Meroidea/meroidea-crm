import 'server-only';

import { and, asc, eq, inArray, sql } from 'drizzle-orm';

import {
  departments,
  roles,
  tenantMemberships,
  trainingAssignments,
  trainingCompletions,
  trainingCourses,
  trainingModules,
  trainingQuestionKeys,
  trainingQuestions,
  users,
} from '@/db/schema';
import { hasFeature, hasPermission, requirePermission, type TenantContext } from '@/server/context';
import { withRls } from '@/server/db/with-rls';

import type { Audience, CourseStatus } from './schemas';

export type ModuleStatus = 'not_started' | 'not_passed' | 'passed';

export type ModuleProgress = {
  id: string;
  title: string;
  /** Number of quiz questions; 0 means read or watch, then mark as done. */
  questions: number;
  status: ModuleStatus;
  bestScore: number | null;
  attempts: number;
};

export type CourseProgress = {
  id: string;
  title: string;
  description: string | null;
  modules: ModuleProgress[];
  total: number;
  passed: number;
  percent: number;
};

export type TrainingOverview = {
  courses: CourseProgress[];
  total: number;
  passed: number;
  percent: number;
};

/** Whole percent, rounded down so that 100% always means everything is done. */
export const percentOf = (passed: number, total: number) =>
  total === 0 ? 100 : Math.floor((passed * 100) / total);

type ProgressRow = { user_id: string; course_id: string; modules: number; passed: number };

/** Per person and published course they are assigned: modules and modules passed (ADR-050). */
async function progressRows(ctx: TenantContext): Promise<ProgressRow[]> {
  return (await withRls(ctx, (tx) =>
    tx.execute(sql`select * from app.training_progress()`),
  )) as unknown as ProgressRow[];
}

/**
 * The courses assigned to one person, each with its modules and that person's results. Your own,
 * or anyone's for those who follow everyone's progress.
 */
export async function getTrainingFor(
  ctx: TenantContext,
  userId: string,
): Promise<TrainingOverview> {
  requirePermission(ctx, userId === ctx.userId ? 'training.learn' : 'training.view_all');
  const courseIds = (await progressRows(ctx))
    .filter((row) => row.user_id === userId)
    .map((row) => row.course_id);
  if (courseIds.length === 0) return { courses: [], total: 0, passed: 0, percent: 100 };

  return withRls(ctx, async (tx) => {
    const [courseRows, moduleRows, completions] = await Promise.all([
      tx
        .select({
          id: trainingCourses.id,
          title: trainingCourses.title,
          description: trainingCourses.description,
        })
        .from(trainingCourses)
        .where(
          and(eq(trainingCourses.tenantId, ctx.tenantId), inArray(trainingCourses.id, courseIds)),
        )
        .orderBy(asc(trainingCourses.position), asc(trainingCourses.title)),
      tx
        .select({
          id: trainingModules.id,
          courseId: trainingModules.courseId,
          title: trainingModules.title,
          questions: sql<number>`(select count(*)::int from training_questions q
            where q.tenant_id = training_modules.tenant_id and q.module_id = training_modules.id)`,
        })
        .from(trainingModules)
        .where(
          and(
            eq(trainingModules.tenantId, ctx.tenantId),
            inArray(trainingModules.courseId, courseIds),
          ),
        )
        .orderBy(asc(trainingModules.position), asc(trainingModules.createdAt)),
      tx
        .select({
          moduleId: trainingCompletions.moduleId,
          passed: trainingCompletions.passed,
          bestScore: trainingCompletions.bestScore,
          attempts: trainingCompletions.attempts,
        })
        .from(trainingCompletions)
        .where(
          and(
            eq(trainingCompletions.tenantId, ctx.tenantId),
            eq(trainingCompletions.userId, userId),
          ),
        ),
    ]);
    const results = new Map(completions.map((row) => [row.moduleId, row]));
    const courses = courseRows.map((course) => {
      const modules: ModuleProgress[] = moduleRows
        .filter((lesson) => lesson.courseId === course.id)
        .map((lesson) => {
          const result = results.get(lesson.id);
          return {
            id: lesson.id,
            title: lesson.title,
            questions: lesson.questions,
            status: result?.passed ? 'passed' : result ? 'not_passed' : 'not_started',
            bestScore: result?.bestScore ?? null,
            attempts: result?.attempts ?? 0,
          };
        });
      const passed = modules.filter((lesson) => lesson.status === 'passed').length;
      return {
        ...course,
        modules,
        total: modules.length,
        passed,
        percent: percentOf(passed, modules.length),
      };
    });
    const total = courses.reduce((sum, course) => sum + course.total, 0);
    const passed = courses.reduce((sum, course) => sum + course.passed, 0);
    return { courses, total, passed, percent: percentOf(passed, total) };
  });
}

export type TeamMemberProgress = {
  userId: string;
  fullName: string;
  roleName: string;
  total: number;
  passed: number;
  percent: number;
};

export type CourseAverage = { id: string; title: string; people: number; percent: number };

/** Everyone's progress, and each course's average across the people assigned to it. */
export async function getTeamProgress(
  ctx: TenantContext,
): Promise<{ people: TeamMemberProgress[]; courses: CourseAverage[] }> {
  requirePermission(ctx, 'training.view_all');
  const rows = await progressRows(ctx);
  return withRls(ctx, async (tx) => {
    const [members, courseRows] = await Promise.all([
      tx
        .select({
          userId: tenantMemberships.userId,
          fullName: users.fullName,
          roleName: roles.name,
        })
        .from(tenantMemberships)
        .innerJoin(users, eq(users.id, tenantMemberships.userId))
        .innerJoin(
          roles,
          and(
            eq(roles.tenantId, tenantMemberships.tenantId),
            eq(roles.id, tenantMemberships.roleId),
          ),
        )
        .where(
          and(
            eq(tenantMemberships.tenantId, ctx.tenantId),
            eq(tenantMemberships.status, 'active'),
            eq(tenantMemberships.isSupport, false),
          ),
        )
        .orderBy(asc(users.fullName)),
      tx
        .select({ id: trainingCourses.id, title: trainingCourses.title })
        .from(trainingCourses)
        .where(
          and(eq(trainingCourses.tenantId, ctx.tenantId), eq(trainingCourses.status, 'published')),
        )
        .orderBy(asc(trainingCourses.position), asc(trainingCourses.title)),
    ]);
    const people = members.map((member) => {
      const mine = rows.filter((row) => row.user_id === member.userId);
      const total = mine.reduce((sum, row) => sum + row.modules, 0);
      const passed = mine.reduce((sum, row) => sum + row.passed, 0);
      return { ...member, total, passed, percent: percentOf(passed, total) };
    });
    const courses = courseRows.map((course) => {
      const assigned = rows.filter((row) => row.course_id === course.id);
      const average =
        assigned.length === 0
          ? 0
          : Math.floor(
              assigned.reduce((sum, row) => sum + percentOf(row.passed, row.modules), 0) /
                assigned.length,
            );
      return { ...course, people: assigned.length, percent: average };
    });
    return { people, courses };
  });
}

/** One active member's name and role, for heading their progress page. */
export async function getMember(ctx: TenantContext, userId: string) {
  requirePermission(ctx, 'training.view_all');
  const [member] = await withRls(ctx, (tx) =>
    tx
      .select({ userId: tenantMemberships.userId, fullName: users.fullName, roleName: roles.name })
      .from(tenantMemberships)
      .innerJoin(users, eq(users.id, tenantMemberships.userId))
      .innerJoin(
        roles,
        and(eq(roles.tenantId, tenantMemberships.tenantId), eq(roles.id, tenantMemberships.roleId)),
      )
      .where(
        and(
          eq(tenantMemberships.tenantId, ctx.tenantId),
          eq(tenantMemberships.userId, userId),
          eq(tenantMemberships.isSupport, false),
        ),
      )
      .limit(1),
  );
  return member ?? null;
}

export type ModuleToLearn = {
  id: string;
  title: string;
  body: string;
  videoUrl: string | null;
  passMark: number;
  course: { id: string; title: string; status: CourseStatus };
  questions: { id: string; prompt: string; options: string[] }[];
  result: {
    passed: boolean;
    bestScore: number | null;
    lastScore: number | null;
    attempts: number;
  } | null;
  /** The next module in the course, to carry on with. */
  nextId: string | null;
  /** Assigned to the reader and published, so they can complete it (others may only look). */
  canComplete: boolean;
};

/** A module to read and complete. Never includes which answers are right (ADR-050). */
export async function getModuleToLearn(
  ctx: TenantContext,
  id: string,
): Promise<ModuleToLearn | null> {
  requirePermission(ctx, 'training.learn');
  return withRls(ctx, async (tx) => {
    const [lesson] = await tx
      .select({
        id: trainingModules.id,
        title: trainingModules.title,
        body: trainingModules.body,
        videoUrl: trainingModules.videoUrl,
        passMark: trainingModules.passMark,
        courseId: trainingCourses.id,
        courseTitle: trainingCourses.title,
        courseStatus: trainingCourses.status,
        assigned: sql<boolean>`app.training_assigned_to_me(training_courses.id)`,
      })
      .from(trainingModules)
      .innerJoin(
        trainingCourses,
        and(
          eq(trainingCourses.tenantId, trainingModules.tenantId),
          eq(trainingCourses.id, trainingModules.courseId),
        ),
      )
      .where(and(eq(trainingModules.tenantId, ctx.tenantId), eq(trainingModules.id, id)))
      .limit(1);
    if (!lesson) return null;
    const [questions, siblings, results] = await Promise.all([
      tx
        .select({
          id: trainingQuestions.id,
          prompt: trainingQuestions.prompt,
          options: trainingQuestions.options,
        })
        .from(trainingQuestions)
        .where(
          and(eq(trainingQuestions.tenantId, ctx.tenantId), eq(trainingQuestions.moduleId, id)),
        )
        .orderBy(asc(trainingQuestions.position), asc(trainingQuestions.createdAt)),
      tx
        .select({ id: trainingModules.id })
        .from(trainingModules)
        .where(
          and(
            eq(trainingModules.tenantId, ctx.tenantId),
            eq(trainingModules.courseId, lesson.courseId),
          ),
        )
        .orderBy(asc(trainingModules.position), asc(trainingModules.createdAt)),
      tx
        .select({
          passed: trainingCompletions.passed,
          bestScore: trainingCompletions.bestScore,
          lastScore: trainingCompletions.lastScore,
          attempts: trainingCompletions.attempts,
        })
        .from(trainingCompletions)
        .where(
          and(
            eq(trainingCompletions.tenantId, ctx.tenantId),
            eq(trainingCompletions.moduleId, id),
            eq(trainingCompletions.userId, ctx.userId),
          ),
        )
        .limit(1),
    ]);
    const index = siblings.findIndex((sibling) => sibling.id === id);
    return {
      id: lesson.id,
      title: lesson.title,
      body: lesson.body,
      videoUrl: lesson.videoUrl,
      passMark: lesson.passMark,
      course: {
        id: lesson.courseId,
        title: lesson.courseTitle,
        status: lesson.courseStatus as CourseStatus,
      },
      questions,
      result: results[0] ?? null,
      nextId: siblings[index + 1]?.id ?? null,
      canComplete: lesson.courseStatus === 'published' && lesson.assigned,
    };
  });
}

export type CourseSummary = {
  id: string;
  title: string;
  status: CourseStatus;
  position: number;
  modules: number;
  assignments: number;
};

/** Every course in the business, drafts and archived ones included, for whoever writes them. */
export async function listCoursesToManage(ctx: TenantContext): Promise<CourseSummary[]> {
  requirePermission(ctx, 'training.manage');
  const rows = await withRls(ctx, (tx) =>
    tx
      .select({
        id: trainingCourses.id,
        title: trainingCourses.title,
        status: trainingCourses.status,
        position: trainingCourses.position,
        modules: sql<number>`(select count(*)::int from training_modules m
          where m.tenant_id = training_courses.tenant_id and m.course_id = training_courses.id)`,
        assignments: sql<number>`(select count(*)::int from training_assignments a
          where a.tenant_id = training_courses.tenant_id and a.course_id = training_courses.id)`,
      })
      .from(trainingCourses)
      .where(eq(trainingCourses.tenantId, ctx.tenantId))
      .orderBy(
        sql`${trainingCourses.status} = 'archived'`,
        asc(trainingCourses.position),
        asc(trainingCourses.title),
      ),
  );
  return rows as CourseSummary[];
}

export type AssignmentRow = { id: string; audience: Audience; label: string };

export type CourseToManage = {
  id: string;
  title: string;
  description: string | null;
  position: number;
  status: CourseStatus;
  modules: { id: string; title: string; position: number; questions: number; completed: number }[];
  assignments: AssignmentRow[];
};

export async function getCourseToManage(
  ctx: TenantContext,
  id: string,
): Promise<CourseToManage | null> {
  requirePermission(ctx, 'training.manage');
  return withRls(ctx, async (tx) => {
    const [course] = await tx
      .select({
        id: trainingCourses.id,
        title: trainingCourses.title,
        description: trainingCourses.description,
        position: trainingCourses.position,
        status: trainingCourses.status,
      })
      .from(trainingCourses)
      .where(and(eq(trainingCourses.tenantId, ctx.tenantId), eq(trainingCourses.id, id)))
      .limit(1);
    if (!course) return null;
    const [modules, assignments] = await Promise.all([
      tx
        .select({
          id: trainingModules.id,
          title: trainingModules.title,
          position: trainingModules.position,
          questions: sql<number>`(select count(*)::int from training_questions q
            where q.tenant_id = training_modules.tenant_id and q.module_id = training_modules.id)`,
          completed: sql<number>`(select count(*)::int from training_completions c
            where c.tenant_id = training_modules.tenant_id and c.module_id = training_modules.id
              and c.passed)`,
        })
        .from(trainingModules)
        .where(and(eq(trainingModules.tenantId, ctx.tenantId), eq(trainingModules.courseId, id)))
        .orderBy(asc(trainingModules.position), asc(trainingModules.createdAt)),
      tx
        .select({
          id: trainingAssignments.id,
          audience: trainingAssignments.audience,
          roleName: roles.name,
          departmentName: departments.name,
          personName: users.fullName,
        })
        .from(trainingAssignments)
        .leftJoin(
          roles,
          and(
            eq(roles.tenantId, trainingAssignments.tenantId),
            eq(roles.id, trainingAssignments.roleId),
          ),
        )
        // Departments are readable only with employees.manage; without it the name is not shown.
        .leftJoin(
          departments,
          and(
            eq(departments.tenantId, trainingAssignments.tenantId),
            eq(departments.id, trainingAssignments.departmentId),
          ),
        )
        .leftJoin(users, eq(users.id, trainingAssignments.userId))
        .where(
          and(eq(trainingAssignments.tenantId, ctx.tenantId), eq(trainingAssignments.courseId, id)),
        )
        .orderBy(asc(trainingAssignments.createdAt)),
    ]);
    return {
      ...course,
      status: course.status as CourseStatus,
      modules,
      assignments: assignments.map((row) => ({
        id: row.id,
        audience: row.audience as Audience,
        label:
          row.audience === 'everyone'
            ? 'Everyone'
            : row.audience === 'role'
              ? `Role: ${row.roleName ?? 'removed role'}`
              : row.audience === 'department'
                ? `Department: ${row.departmentName ?? 'a department'}`
                : `Person: ${row.personName ?? 'a former member'}`,
      })),
    };
  });
}

export type ModuleToEdit = {
  id: string;
  courseId: string;
  courseTitle: string;
  title: string;
  body: string;
  videoUrl: string | null;
  passMark: number;
  position: number;
  questions: { prompt: string; options: string[]; correctOption: number }[];
};

/** A module with its quiz and its answers, for whoever writes training only. */
export async function getModuleToEdit(
  ctx: TenantContext,
  id: string,
): Promise<ModuleToEdit | null> {
  requirePermission(ctx, 'training.manage');
  return withRls(ctx, async (tx) => {
    const [lesson] = await tx
      .select({
        id: trainingModules.id,
        courseId: trainingModules.courseId,
        courseTitle: trainingCourses.title,
        title: trainingModules.title,
        body: trainingModules.body,
        videoUrl: trainingModules.videoUrl,
        passMark: trainingModules.passMark,
        position: trainingModules.position,
      })
      .from(trainingModules)
      .innerJoin(
        trainingCourses,
        and(
          eq(trainingCourses.tenantId, trainingModules.tenantId),
          eq(trainingCourses.id, trainingModules.courseId),
        ),
      )
      .where(and(eq(trainingModules.tenantId, ctx.tenantId), eq(trainingModules.id, id)))
      .limit(1);
    if (!lesson) return null;
    const questions = await tx
      .select({
        prompt: trainingQuestions.prompt,
        options: trainingQuestions.options,
        correctOption: trainingQuestionKeys.correctOption,
      })
      .from(trainingQuestions)
      .innerJoin(
        trainingQuestionKeys,
        and(
          eq(trainingQuestionKeys.tenantId, trainingQuestions.tenantId),
          eq(trainingQuestionKeys.questionId, trainingQuestions.id),
        ),
      )
      .where(and(eq(trainingQuestions.tenantId, ctx.tenantId), eq(trainingQuestions.moduleId, id)))
      .orderBy(asc(trainingQuestions.position), asc(trainingQuestions.createdAt));
    return { ...lesson, questions };
  });
}

export type AssignmentOptions = {
  roles: { id: string; name: string }[];
  departments: { id: string; name: string }[];
  people: { id: string; name: string }[];
};

/** Whom a course can be assigned to. Departments appear only where staff records are in use. */
export async function getAssignmentOptions(ctx: TenantContext): Promise<AssignmentOptions> {
  requirePermission(ctx, 'training.manage');
  const withDepartments = hasFeature(ctx, 'staff') && hasPermission(ctx, 'employees.manage');
  return withRls(ctx, async (tx) => {
    const [roleRows, departmentRows, people] = await Promise.all([
      tx
        .select({ id: roles.id, name: roles.name })
        .from(roles)
        .where(eq(roles.tenantId, ctx.tenantId))
        .orderBy(asc(roles.name)),
      withDepartments
        ? tx
            .select({ id: departments.id, name: departments.name })
            .from(departments)
            .where(
              and(eq(departments.tenantId, ctx.tenantId), sql`${departments.deletedAt} is null`),
            )
            .orderBy(asc(departments.position), asc(departments.name))
        : Promise.resolve([]),
      tx
        .select({ id: tenantMemberships.userId, name: users.fullName })
        .from(tenantMemberships)
        .innerJoin(users, eq(users.id, tenantMemberships.userId))
        .where(
          and(
            eq(tenantMemberships.tenantId, ctx.tenantId),
            eq(tenantMemberships.status, 'active'),
            eq(tenantMemberships.isSupport, false),
          ),
        )
        .orderBy(asc(users.fullName)),
    ]);
    return { roles: roleRows, departments: departmentRows, people };
  });
}
