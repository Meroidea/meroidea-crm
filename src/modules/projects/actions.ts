'use server';

import { z } from 'zod';

import { authedAction } from '@/server/action';

import {
  idSchema,
  logTimeSchema,
  saveProjectSchema,
  saveTaskSchema,
  startTimerSchema,
  taskStatusSchema,
} from './schemas';
import * as projectService from './service';

const PATHS = ['/projects', '/productivity'];
const manage = { permission: 'projects.manage', revalidate: PATHS } as const;
const view = { permission: 'projects.view', revalidate: PATHS } as const;

export const saveProjectAction = authedAction(
  { ...manage, input: saveProjectSchema },
  (ctx, input) => projectService.saveProject(ctx, input),
);
export const deleteProjectAction = authedAction({ ...manage, input: idSchema }, (ctx, input) =>
  projectService.deleteProject(ctx, input.id),
);
export const saveTaskAction = authedAction({ ...manage, input: saveTaskSchema }, (ctx, input) =>
  projectService.saveTask(ctx, input),
);
export const deleteTaskAction = authedAction({ ...manage, input: idSchema }, (ctx, input) =>
  projectService.deleteTask(ctx, input.id),
);
export const setTaskStatusAction = authedAction(
  { ...view, input: taskStatusSchema },
  (ctx, input) => projectService.setTaskStatus(ctx, input),
);
export const startTimerAction = authedAction({ ...view, input: startTimerSchema }, (ctx, input) =>
  projectService.startTimer(ctx, input.taskId),
);
export const stopTimerAction = authedAction({ ...view, input: z.object({}) }, (ctx) =>
  projectService.stopTimer(ctx),
);
export const logTimeAction = authedAction({ ...view, input: logTimeSchema }, (ctx, input) =>
  projectService.logTime(ctx, input),
);
