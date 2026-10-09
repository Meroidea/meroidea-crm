'use server';

import { authedAction } from '@/server/action';

import { createTaskSchema, taskIdSchema } from './schemas';
import * as tasksService from './service';

const PATHS = ['/my-day', '/tasks', '/dashboard', '/contacts', '/opportunities', '/pipeline'];

export const createTaskAction = authedAction(
  { permission: 'tasks.manage', input: createTaskSchema, revalidate: PATHS },
  (ctx, input) => tasksService.createTask(ctx, input),
);

export const completeTaskAction = authedAction(
  { permission: 'tasks.manage', input: taskIdSchema, revalidate: PATHS },
  (ctx, input) => tasksService.completeTask(ctx, input.id),
);

export const reopenTaskAction = authedAction(
  { permission: 'tasks.manage', input: taskIdSchema, revalidate: PATHS },
  (ctx, input) => tasksService.reopenTask(ctx, input.id),
);

export const cancelTaskAction = authedAction(
  { permission: 'tasks.manage', input: taskIdSchema, revalidate: PATHS },
  (ctx, input) => tasksService.cancelTask(ctx, input.id),
);
