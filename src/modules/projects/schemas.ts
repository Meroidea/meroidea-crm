import { z } from 'zod';

const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .nullish()
    .transform((value) => value || null);
const optionalDate = z
  .union([z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Choose a date'), z.literal('')])
  .nullish()
  .transform((value) => value || null);
const optionalUser = z
  .union([z.uuid(), z.literal('')])
  .nullish()
  .transform((value) => value || null);

export const PROJECT_STATUSES = ['active', 'on_hold', 'completed'] as const;
export const PROJECT_STATUS_LABELS: Record<(typeof PROJECT_STATUSES)[number], string> = {
  active: 'Active',
  on_hold: 'On hold',
  completed: 'Completed',
};
export const TASK_STATUSES = ['todo', 'in_progress', 'review', 'done'] as const;
export type TaskStatus = (typeof TASK_STATUSES)[number];
export const TASK_STATUS_LABELS: Record<TaskStatus, string> = {
  todo: 'To do',
  in_progress: 'In progress',
  review: 'In review',
  done: 'Done',
};
export const PRIORITIES = ['low', 'normal', 'high'] as const;
export const PRIORITY_LABELS: Record<(typeof PRIORITIES)[number], string> = {
  low: 'Low',
  normal: 'Normal',
  high: 'High',
};

export const saveProjectSchema = z
  .object({
    id: z.uuid().optional(),
    name: z.string().trim().min(2, 'Enter a name').max(120),
    description: optionalText(2000),
    startsOn: optionalDate,
    dueOn: optionalDate,
    leadUserId: optionalUser,
    status: z.enum(PROJECT_STATUSES).default('active'),
  })
  .refine((value) => !value.startsOn || !value.dueOn || value.dueOn >= value.startsOn, {
    path: ['dueOn'],
    message: 'The due date cannot be before the start',
  });

/** Hours as people say them ("1.5"), stored as whole minutes. */
const hoursToMinutes = (max: number) =>
  z
    .union([z.string(), z.number()])
    .transform((value) => String(value).trim())
    .pipe(z.string().regex(/^\d{1,3}(\.\d{1,2})?$/, 'Enter hours, such as 1.5'))
    .transform((value) => Math.round(Number(value) * 60))
    .refine((minutes) => minutes >= 1 && minutes <= max, 'That is outside what can be recorded');

export const saveTaskSchema = z.object({
  id: z.uuid().optional(),
  projectId: z.uuid(),
  title: z.string().trim().min(2, 'Enter what needs doing').max(200),
  description: optionalText(4000),
  priority: z.enum(PRIORITIES).default('normal'),
  assigneeUserId: optionalUser,
  dueOn: optionalDate,
  estimateHours: z
    .union([hoursToMinutes(100_000), z.literal('')])
    .nullish()
    .transform((value) => (typeof value === 'number' ? value : null)),
});

export const taskStatusSchema = z.object({ id: z.uuid(), status: z.enum(TASK_STATUSES) });
export const idSchema = z.object({ id: z.uuid() });
export const startTimerSchema = z.object({ taskId: z.uuid() });
export const logTimeSchema = z.object({
  taskId: z.uuid(),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Choose a date'),
  hours: hoursToMinutes(1440),
  note: optionalText(300),
});

export type SaveProjectInput = z.output<typeof saveProjectSchema>;
export type SaveProjectValues = z.input<typeof saveProjectSchema>;
export type SaveTaskInput = z.output<typeof saveTaskSchema>;
export type LogTimeInput = z.output<typeof logTimeSchema>;
