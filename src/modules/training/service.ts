import 'server-only';

import { and, eq, sql } from 'drizzle-orm';

import {
  tenantMemberships,
  trainingAssignments,
  trainingCompletions,
  trainingCourses,
  trainingModules,
  trainingQuestionKeys,
  trainingQuestions,
} from '@/db/schema';
import { AppError } from '@/lib/errors';
import { audit } from '@/server/audit';
import { requirePermission, type TenantContext } from '@/server/context';
import { withRls, type Tx } from '@/server/db/with-rls';

import type {
  AssignmentInput,
  CourseInput,
  CourseStatus,
  ModuleInput,
  SubmitModuleInput,
} from './schemas';

/*
 * Staff training (ADR-050). Writing courses, modules and quizzes, and deciding who must complete
 * them, is training.manage's alone; RLS enforces the same. Completing a module goes through the
 * database's marking function, which is the only thing that can write a result.
 */

const COURSE_GONE = 'That course was not found.';
const MODULE_GONE = 'That module was not found.';

async function findCourse(tx: Tx, ctx: TenantContext, id: string) {
  const [course] = await tx
    .select({ id: trainingCourses.id, status: trainingCourses.status })
    .from(trainingCourses)
    .where(and(eq(trainingCourses.tenantId, ctx.tenantId), eq(trainingCourses.id, id)))
    .limit(1);
  if (!course) throw new AppError('NOT_FOUND', COURSE_GONE);
  return course;
}

async function findModule(tx: Tx, ctx: TenantContext, id: string) {
  const [lesson] = await tx
    .select({ id: trainingModules.id, courseId: trainingModules.courseId })
    .from(trainingModules)
    .where(and(eq(trainingModules.tenantId, ctx.tenantId), eq(trainingModules.id, id)))
    .limit(1);
  if (!lesson) throw new AppError('NOT_FOUND', MODULE_GONE);
  return lesson;
}

export async function createCourse(
  ctx: TenantContext,
  input: CourseInput,
): Promise<{ id: string }> {
  requirePermission(ctx, 'training.manage');
  return withRls(ctx, async (tx) => {
    const [course] = await tx
      .insert(trainingCourses)
      .values({
        tenantId: ctx.tenantId,
        title: input.title,
        description: input.description,
        position: input.position,
        status: 'draft',
        createdBy: ctx.userId,
        updatedBy: ctx.userId,
      })
      .returning({ id: trainingCourses.id });
    if (!course) throw new AppError('INTERNAL', 'The course could not be saved.');
    await audit(tx, ctx, { action: 'create', entityType: 'training_course', entityId: course.id });
    return course;
  });
}

export async function updateCourse(
  ctx: TenantContext,
  input: CourseInput & { id: string },
): Promise<{ id: string }> {
  requirePermission(ctx, 'training.manage');
  return withRls(ctx, async (tx) => {
    await findCourse(tx, ctx, input.id);
    await tx
      .update(trainingCourses)
      .set({
        title: input.title,
        description: input.description,
        position: input.position,
        updatedBy: ctx.userId,
      })
      .where(and(eq(trainingCourses.tenantId, ctx.tenantId), eq(trainingCourses.id, input.id)));
    await audit(tx, ctx, { action: 'update', entityType: 'training_course', entityId: input.id });
    return { id: input.id };
  });
}

/**
 * Publishing puts a course in front of the people it is assigned to; it needs at least one module.
 * Archiving takes it out of everyone's training and keeps every result.
 */
export async function setCourseStatus(
  ctx: TenantContext,
  input: { id: string; status: CourseStatus },
): Promise<{ id: string }> {
  requirePermission(ctx, 'training.manage');
  return withRls(ctx, async (tx) => {
    const course = await findCourse(tx, ctx, input.id);
    if (course.status === input.status) return { id: course.id };
    if (input.status === 'published') {
      const [row] = await tx
        .select({ modules: sql<number>`count(*)::int` })
        .from(trainingModules)
        .where(
          and(eq(trainingModules.tenantId, ctx.tenantId), eq(trainingModules.courseId, course.id)),
        );
      if (!row || row.modules === 0) {
        throw new AppError('CONFLICT', 'Add at least one module before publishing the course.');
      }
    }
    await tx
      .update(trainingCourses)
      .set({ status: input.status, updatedBy: ctx.userId })
      .where(and(eq(trainingCourses.tenantId, ctx.tenantId), eq(trainingCourses.id, course.id)));
    await audit(tx, ctx, {
      action: 'update',
      entityType: 'training_course',
      entityId: course.id,
      changes: { status: [course.status, input.status] },
    });
    return { id: course.id };
  });
}

/** Only a course without modules can be deleted; otherwise archive it, which keeps results. */
export async function deleteCourse(ctx: TenantContext, id: string): Promise<{ id: string }> {
  requirePermission(ctx, 'training.manage');
  return withRls(ctx, async (tx) => {
    const course = await findCourse(tx, ctx, id);
    const [row] = await tx
      .select({ modules: sql<number>`count(*)::int` })
      .from(trainingModules)
      .where(and(eq(trainingModules.tenantId, ctx.tenantId), eq(trainingModules.courseId, id)));
    if (row && row.modules > 0) {
      throw new AppError('CONFLICT', 'Remove its modules first, or archive the course instead.');
    }
    await tx
      .delete(trainingCourses)
      .where(and(eq(trainingCourses.tenantId, ctx.tenantId), eq(trainingCourses.id, course.id)));
    await audit(tx, ctx, { action: 'delete', entityType: 'training_course', entityId: course.id });
    return { id: course.id };
  });
}

/** Writes a module's quiz: the questions everyone may read, and the answers only managers of training may. */
async function writeQuestions(
  tx: Tx,
  ctx: TenantContext,
  moduleId: string,
  questions: ModuleInput['questions'],
) {
  // Replaced as a whole: results belong to the module, not to individual questions.
  await tx
    .delete(trainingQuestions)
    .where(
      and(eq(trainingQuestions.tenantId, ctx.tenantId), eq(trainingQuestions.moduleId, moduleId)),
    );
  for (const [position, question] of questions.entries()) {
    const [row] = await tx
      .insert(trainingQuestions)
      .values({
        tenantId: ctx.tenantId,
        moduleId,
        prompt: question.prompt,
        options: question.options,
        position,
      })
      .returning({ id: trainingQuestions.id });
    if (!row) throw new AppError('INTERNAL', 'The quiz could not be saved.');
    await tx.insert(trainingQuestionKeys).values({
      tenantId: ctx.tenantId,
      questionId: row.id,
      correctOption: question.correctOption,
    });
  }
}

export async function createModule(
  ctx: TenantContext,
  input: ModuleInput & { courseId: string },
): Promise<{ id: string }> {
  requirePermission(ctx, 'training.manage');
  return withRls(ctx, async (tx) => {
    await findCourse(tx, ctx, input.courseId);
    const [lesson] = await tx
      .insert(trainingModules)
      .values({
        tenantId: ctx.tenantId,
        courseId: input.courseId,
        title: input.title,
        body: input.body,
        videoUrl: input.videoUrl,
        passMark: input.passMark,
        position: input.position,
        createdBy: ctx.userId,
        updatedBy: ctx.userId,
      })
      .returning({ id: trainingModules.id });
    if (!lesson) throw new AppError('INTERNAL', 'The module could not be saved.');
    await writeQuestions(tx, ctx, lesson.id, input.questions);
    await audit(tx, ctx, {
      action: 'create',
      entityType: 'training_module',
      entityId: lesson.id,
      context: { courseId: input.courseId, questions: input.questions.length },
    });
    return lesson;
  });
}

/**
 * Saves a module's content and quiz. Results already earned stand: someone who passed the old
 * quiz is not asked to take the new one.
 */
export async function updateModule(
  ctx: TenantContext,
  input: ModuleInput & { id: string },
): Promise<{ id: string }> {
  requirePermission(ctx, 'training.manage');
  return withRls(ctx, async (tx) => {
    const lesson = await findModule(tx, ctx, input.id);
    await tx
      .update(trainingModules)
      .set({
        title: input.title,
        body: input.body,
        videoUrl: input.videoUrl,
        passMark: input.passMark,
        position: input.position,
        updatedBy: ctx.userId,
      })
      .where(and(eq(trainingModules.tenantId, ctx.tenantId), eq(trainingModules.id, lesson.id)));
    await writeQuestions(tx, ctx, lesson.id, input.questions);
    await audit(tx, ctx, {
      action: 'update',
      entityType: 'training_module',
      entityId: lesson.id,
      context: { questions: input.questions.length },
    });
    return { id: lesson.id };
  });
}

/** A module someone has already completed is kept as the record of it. */
export async function deleteModule(
  ctx: TenantContext,
  id: string,
): Promise<{ id: string; courseId: string }> {
  requirePermission(ctx, 'training.manage');
  return withRls(ctx, async (tx) => {
    const lesson = await findModule(tx, ctx, id);
    const [row] = await tx
      .select({ results: sql<number>`count(*)::int` })
      .from(trainingCompletions)
      .where(
        and(eq(trainingCompletions.tenantId, ctx.tenantId), eq(trainingCompletions.moduleId, id)),
      );
    if (row && row.results > 0) {
      throw new AppError(
        'CONFLICT',
        'People have already done this module, so it is kept as their record. Archive the course instead, or edit the module.',
      );
    }
    // A published course always has something to do; an empty one would read as complete.
    const [course] = await tx
      .select({
        status: trainingCourses.status,
        modules: sql<number>`(select count(*)::int from training_modules m
          where m.tenant_id = training_courses.tenant_id and m.course_id = training_courses.id)`,
      })
      .from(trainingCourses)
      .where(
        and(eq(trainingCourses.tenantId, ctx.tenantId), eq(trainingCourses.id, lesson.courseId)),
      )
      .limit(1);
    if (course?.status === 'published' && course.modules <= 1) {
      throw new AppError(
        'CONFLICT',
        'This is the course’s only module. Take the course back to draft before deleting it.',
      );
    }
    await tx
      .delete(trainingModules)
      .where(and(eq(trainingModules.tenantId, ctx.tenantId), eq(trainingModules.id, id)));
    await audit(tx, ctx, { action: 'delete', entityType: 'training_module', entityId: id });
    return { id, courseId: lesson.courseId };
  });
}

export async function addAssignment(
  ctx: TenantContext,
  input: AssignmentInput,
): Promise<{ id: string }> {
  requirePermission(ctx, 'training.manage');
  return withRls(ctx, async (tx) => {
    await findCourse(tx, ctx, input.courseId);
    if (input.audience === 'person' && input.targetId) {
      const [member] = await tx
        .select({ id: tenantMemberships.id })
        .from(tenantMemberships)
        .where(
          and(
            eq(tenantMemberships.tenantId, ctx.tenantId),
            eq(tenantMemberships.userId, input.targetId),
            eq(tenantMemberships.isSupport, false),
          ),
        )
        .limit(1);
      if (!member) {
        throw new AppError('VALIDATION', 'Choose someone in this business.', {
          targetId: ['Choose someone in this business'],
        });
      }
    }
    if (input.audience === 'role' || input.audience === 'department') {
      // A role or department of this business only; anything else is "choose again", not an error.
      const [exists] = (await tx.execute(
        input.audience === 'role'
          ? sql`select 1 from roles where tenant_id = ${ctx.tenantId} and id = ${input.targetId}`
          : sql`select 1 from departments where tenant_id = ${ctx.tenantId} and id = ${input.targetId}
                  and deleted_at is null`,
      )) as unknown as unknown[];
      if (!exists) {
        throw new AppError('VALIDATION', 'Choose who to assign it to.', {
          targetId: ['That is no longer available. Choose again.'],
        });
      }
    }
    const [assignment] = await tx
      .insert(trainingAssignments)
      .values({
        tenantId: ctx.tenantId,
        courseId: input.courseId,
        audience: input.audience,
        roleId: input.audience === 'role' ? input.targetId : null,
        departmentId: input.audience === 'department' ? input.targetId : null,
        userId: input.audience === 'person' ? input.targetId : null,
        createdBy: ctx.userId,
      })
      .onConflictDoNothing()
      .returning({ id: trainingAssignments.id });
    // Already assigned that way: nothing to add.
    if (!assignment) return { id: input.courseId };
    await audit(tx, ctx, {
      action: 'create',
      entityType: 'training_assignment',
      entityId: assignment.id,
      context: { courseId: input.courseId, audience: input.audience },
    });
    return assignment;
  });
}

export async function removeAssignment(ctx: TenantContext, id: string): Promise<{ id: string }> {
  requirePermission(ctx, 'training.manage');
  return withRls(ctx, async (tx) => {
    const [removed] = await tx
      .delete(trainingAssignments)
      .where(and(eq(trainingAssignments.tenantId, ctx.tenantId), eq(trainingAssignments.id, id)))
      .returning({ id: trainingAssignments.id, courseId: trainingAssignments.courseId });
    if (!removed) throw new AppError('NOT_FOUND', 'That assignment was not found.');
    await audit(tx, ctx, {
      action: 'delete',
      entityType: 'training_assignment',
      entityId: removed.id,
      context: { courseId: removed.courseId },
    });
    return { id: removed.id };
  });
}

/**
 * Completes a module: marks the quiz, or records it as done when it has none. Every question must
 * be answered. The database does the marking, so the right answers never reach the browser.
 */
export async function submitModule(
  ctx: TenantContext,
  input: SubmitModuleInput,
): Promise<{ passed: boolean; score: number | null }> {
  requirePermission(ctx, 'training.learn');
  return withRls(ctx, async (tx) => {
    const questions = await tx
      .select({ id: trainingQuestions.id, options: trainingQuestions.options })
      .from(trainingQuestions)
      .where(
        and(eq(trainingQuestions.tenantId, ctx.tenantId), eq(trainingQuestions.moduleId, input.id)),
      );
    const unanswered = questions.filter((question) => {
      const answer = input.answers[question.id];
      return answer === undefined || answer >= question.options.length;
    });
    if (unanswered.length > 0) {
      throw new AppError('VALIDATION', 'Answer every question before you submit.');
    }
    let result: { result_passed: boolean; result_score: number | null } | undefined;
    try {
      [result] = (await tx.execute(
        sql`select * from app.submit_training_module(${input.id}, ${JSON.stringify(input.answers)}::jsonb)`,
      )) as unknown as { result_passed: boolean; result_score: number | null }[];
    } catch (cause) {
      const code = (cause as { cause?: { code?: string } }).cause?.code;
      // Not assigned, not published or not in this business: as if it did not exist.
      if (code === '42501') throw new AppError('NOT_FOUND', MODULE_GONE);
      throw cause;
    }
    if (!result) throw new AppError('INTERNAL', 'Your answers could not be marked.');
    await audit(tx, ctx, {
      action: 'update',
      entityType: 'training_module',
      entityId: input.id,
      context: { attempt: true, passed: result.result_passed, score: result.result_score },
    });
    return { passed: result.result_passed, score: result.result_score };
  });
}
