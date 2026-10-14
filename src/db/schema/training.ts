import { sql } from 'drizzle-orm';
import {
  boolean,
  foreignKey,
  index,
  integer,
  pgTable,
  primaryKey,
  smallint,
  text,
  timestamp,
  unique,
  uuid,
} from 'drizzle-orm/pg-core';

import { departments } from './hiring';
import { roles, tenants } from './tenancy';

/*
 * Staff training (ADR-050): courses made of modules, each with content to read or watch and, when
 * it has questions, a quiz with a pass mark. A business's admin writes them and decides who must
 * complete each course; everyone works through what is assigned to them.
 */

const timestamps = {
  createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
};

/** A course, such as "Welcome to the cafe" or "Cash handling". Hidden from staff until published. */
export const trainingCourses = pgTable(
  'training_courses',
  {
    id: uuid().primaryKey().defaultRandom(),
    tenantId: uuid()
      .notNull()
      .references(() => tenants.id, { onDelete: 'restrict' }),
    title: text().notNull(),
    description: text(),
    /** Lower comes first in everyone's list. */
    position: integer().notNull().default(0),
    /** draft | published | archived. Archived keeps every result but leaves everyone's list. */
    status: text().notNull().default('draft'),
    createdBy: uuid(),
    updatedBy: uuid(),
    ...timestamps,
  },
  (table) => [
    unique('training_courses_tenant_id_id_key').on(table.tenantId, table.id),
    index('training_courses_tenant_order_idx').on(table.tenantId, table.position),
  ],
);

/** One lesson in a course: what to read or watch, and optionally a quiz. */
export const trainingModules = pgTable(
  'training_modules',
  {
    id: uuid().primaryKey().defaultRandom(),
    tenantId: uuid()
      .notNull()
      .references(() => tenants.id, { onDelete: 'restrict' }),
    courseId: uuid().notNull(),
    title: text().notNull(),
    /** Plain text: "## " lines are headings, "- " lines are bullet points, blank lines split paragraphs. */
    body: text().notNull().default(''),
    /** An https address of a video to watch with it; YouTube and Vimeo play in the page. */
    videoUrl: text(),
    /** Percent of questions to get right to pass. Ignored when the module has no questions. */
    passMark: integer().notNull().default(80),
    position: integer().notNull().default(0),
    createdBy: uuid(),
    updatedBy: uuid(),
    ...timestamps,
  },
  (table) => [
    unique('training_modules_tenant_id_id_key').on(table.tenantId, table.id),
    index('training_modules_course_idx').on(table.tenantId, table.courseId, table.position),
    foreignKey({
      columns: [table.tenantId, table.courseId],
      foreignColumns: [trainingCourses.tenantId, trainingCourses.id],
      name: 'training_modules_course_fk',
    }).onDelete('restrict'),
  ],
);

/** A multiple-choice question in a module's quiz. Which option is right is kept apart, below. */
export const trainingQuestions = pgTable(
  'training_questions',
  {
    id: uuid().primaryKey().defaultRandom(),
    tenantId: uuid()
      .notNull()
      .references(() => tenants.id, { onDelete: 'restrict' }),
    moduleId: uuid().notNull(),
    prompt: text().notNull(),
    options: text()
      .array()
      .notNull()
      .default(sql`'{}'::text[]`),
    position: integer().notNull().default(0),
    ...timestamps,
  },
  (table) => [
    unique('training_questions_tenant_id_id_key').on(table.tenantId, table.id),
    index('training_questions_module_idx').on(table.tenantId, table.moduleId, table.position),
    foreignKey({
      columns: [table.tenantId, table.moduleId],
      foreignColumns: [trainingModules.tenantId, trainingModules.id],
      name: 'training_questions_module_fk',
    }).onDelete('cascade'),
  ],
);

/**
 * The right answer to each question, in its own table so that people taking the quiz can never
 * read it: only training.manage can, and answers are marked by the database (ADR-050).
 */
export const trainingQuestionKeys = pgTable(
  'training_question_keys',
  {
    questionId: uuid().notNull(),
    tenantId: uuid()
      .notNull()
      .references(() => tenants.id, { onDelete: 'restrict' }),
    /** Index into the question's options, from 0. */
    correctOption: smallint().notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.tenantId, table.questionId] }),
    foreignKey({
      columns: [table.tenantId, table.questionId],
      foreignColumns: [trainingQuestions.tenantId, trainingQuestions.id],
      name: 'training_question_keys_question_fk',
    }).onDelete('cascade'),
  ],
);

/**
 * Who must complete a course: everyone, everyone with a role, everyone in a department, or one
 * person. A person can be covered by several rows; they do the course once.
 */
export const trainingAssignments = pgTable(
  'training_assignments',
  {
    id: uuid().primaryKey().defaultRandom(),
    tenantId: uuid()
      .notNull()
      .references(() => tenants.id, { onDelete: 'restrict' }),
    courseId: uuid().notNull(),
    /** everyone | role | department | person; exactly the matching column below is set. */
    audience: text().notNull(),
    roleId: uuid(),
    departmentId: uuid(),
    userId: uuid(),
    createdBy: uuid(),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    unique('training_assignments_tenant_id_id_key').on(table.tenantId, table.id),
    index('training_assignments_course_idx').on(table.tenantId, table.courseId),
    foreignKey({
      columns: [table.tenantId, table.courseId],
      foreignColumns: [trainingCourses.tenantId, trainingCourses.id],
      name: 'training_assignments_course_fk',
    }).onDelete('cascade'),
    foreignKey({
      columns: [table.tenantId, table.roleId],
      foreignColumns: [roles.tenantId, roles.id],
      name: 'training_assignments_role_fk',
    }).onDelete('cascade'),
    foreignKey({
      columns: [table.tenantId, table.departmentId],
      foreignColumns: [departments.tenantId, departments.id],
      name: 'training_assignments_department_fk',
    }).onDelete('cascade'),
  ],
);

/**
 * A person's result on a module: one row per person and module, kept when the course changes.
 * Written only by the database's marking function, never directly by a signed-in user.
 */
export const trainingCompletions = pgTable(
  'training_completions',
  {
    id: uuid().primaryKey().defaultRandom(),
    tenantId: uuid()
      .notNull()
      .references(() => tenants.id, { onDelete: 'restrict' }),
    moduleId: uuid().notNull(),
    userId: uuid().notNull(),
    /** Once passed, stays passed; a later lower score does not undo it. */
    passed: boolean().notNull().default(false),
    /** Percent; null for a module without a quiz. */
    bestScore: integer(),
    lastScore: integer(),
    attempts: integer().notNull().default(0),
    /** When it was first passed. */
    completedAt: timestamp({ withTimezone: true }),
    lastAttemptAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    unique('training_completions_tenant_id_id_key').on(table.tenantId, table.id),
    unique('training_completions_person_key').on(table.tenantId, table.moduleId, table.userId),
    index('training_completions_user_idx').on(table.tenantId, table.userId),
    foreignKey({
      columns: [table.tenantId, table.moduleId],
      foreignColumns: [trainingModules.tenantId, trainingModules.id],
      name: 'training_completions_module_fk',
    }).onDelete('restrict'),
  ],
);
