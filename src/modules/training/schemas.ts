import { z } from 'zod';

export const COURSE_STATUS_LABELS = {
  draft: 'Draft',
  published: 'Published',
  archived: 'Archived',
} as const;
export type CourseStatus = keyof typeof COURSE_STATUS_LABELS;

/** Who must complete a course (ADR-050). */
export const AUDIENCE_LABELS = {
  everyone: 'Everyone',
  role: 'Everyone with a role',
  department: 'Everyone in a department',
  person: 'One person',
} as const;
export type Audience = keyof typeof AUDIENCE_LABELS;

const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .nullish()
    .transform((value) => value || null);

const position = z.coerce
  .number('Enter a number')
  .int('Use a whole number')
  .min(0, 'Use 0 or more')
  .max(999, 'Use 999 or less');

export const courseSchema = z.object({
  title: z.string().trim().min(2, 'Give the course a title').max(150),
  description: optionalText(2000),
  position: position.default(0),
});
export type CourseValues = z.input<typeof courseSchema>;
export type CourseInput = z.output<typeof courseSchema>;

export const updateCourseSchema = courseSchema.extend({ id: z.uuid() });
export const courseStatusSchema = z.object({
  id: z.uuid(),
  status: z.enum(['draft', 'published', 'archived']),
});
export const idSchema = z.object({ id: z.uuid() });

const question = z
  .object({
    prompt: z.string().trim().min(3, 'Write the question').max(500),
    options: z
      .array(z.string().trim().min(1, 'Fill in every answer, or remove it').max(200))
      .min(2, 'Give at least two answers')
      .max(6, 'Give at most six answers'),
    correctOption: z.coerce.number().int().min(0).max(5),
  })
  .refine((value) => value.correctOption < value.options.length, {
    path: ['correctOption'],
    message: 'Choose the right answer',
  });

export const moduleSchema = z.object({
  title: z.string().trim().min(2, 'Give the module a title').max(150),
  body: z.string().trim().max(50_000, 'Keep the content under 50,000 characters').default(''),
  videoUrl: z
    .union([z.literal(''), z.url({ protocol: /^https$/, error: 'Use an https:// address' })])
    .nullish()
    .transform((value) => value || null),
  passMark: z.coerce.number().int().min(1, 'At least 1%').max(100, 'At most 100%').default(80),
  position: position.default(0),
  questions: z.array(question).max(30, 'Up to 30 questions').default([]),
});
export type ModuleValues = z.input<typeof moduleSchema>;
export type ModuleInput = z.output<typeof moduleSchema>;

export const createModuleSchema = moduleSchema.extend({ courseId: z.uuid() });
export const updateModuleSchema = moduleSchema.extend({ id: z.uuid() });

export const assignmentSchema = z
  .object({
    courseId: z.uuid(),
    audience: z.enum(['everyone', 'role', 'department', 'person']),
    targetId: z
      .union([z.uuid(), z.literal('')])
      .nullish()
      .transform((value) => value || null),
  })
  .refine((value) => value.audience === 'everyone' || value.targetId !== null, {
    path: ['targetId'],
    message: 'Choose who',
  });
export type AssignmentInput = z.output<typeof assignmentSchema>;

/** Answers to a module's quiz: question id → index of the chosen answer. */
export const submitModuleSchema = z.object({
  id: z.uuid(),
  answers: z.record(z.uuid(), z.coerce.number().int().min(0).max(5)).default({}),
});
export type SubmitModuleInput = z.output<typeof submitModuleSchema>;

export const trainingParamsSchema = z.object({
  course: z.uuid().optional().catch(undefined),
});
