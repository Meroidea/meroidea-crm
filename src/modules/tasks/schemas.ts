import { z } from 'zod';

export const TASK_TYPES = ['follow_up', 'call', 'email', 'meeting', 'document', 'other'] as const;
export const TASK_PRIORITIES = ['low', 'normal', 'high'] as const;

export const TASK_TYPE_LABELS: Record<(typeof TASK_TYPES)[number], string> = {
  follow_up: 'Follow-up',
  call: 'Call',
  email: 'Email',
  meeting: 'Meeting',
  document: 'Document',
  other: 'Other',
};

export const createTaskSchema = z.object({
  title: z.string().trim().min(1, 'What needs doing?').max(200),
  type: z.enum(TASK_TYPES).default('follow_up'),
  priority: z.enum(TASK_PRIORITIES).default('normal'),
  /** A calendar day in the workspace timezone; the service turns it into an instant. */
  dueDate: z
    .union([z.literal(''), z.iso.date('Use a valid date')])
    .optional()
    .transform((value) => value || null),
  assignedTo: z
    .union([z.literal(''), z.uuid()])
    .optional()
    .transform((value) => value || null),
  contactId: z.uuid().optional(),
  opportunityId: z.uuid().optional(),
});

export const taskIdSchema = z.object({ id: z.uuid() });

export type TaskFormValues = z.input<typeof createTaskSchema>;
export type CreateTaskInput = z.output<typeof createTaskSchema>;

export const taskListFiltersSchema = z.object({
  q: z.string().trim().max(100).optional().catch(undefined),
  view: z.enum(['open', 'overdue', 'today', 'upcoming', 'completed']).optional().catch(undefined),
  assignee: z
    .union([z.literal('me'), z.uuid()])
    .optional()
    .catch(undefined),
});

export type TaskListFilters = z.output<typeof taskListFiltersSchema>;
