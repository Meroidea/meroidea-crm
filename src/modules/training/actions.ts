'use server';

import { authedAction } from '@/server/action';

import {
  assignmentSchema,
  courseSchema,
  courseStatusSchema,
  createModuleSchema,
  idSchema,
  submitModuleSchema,
  updateCourseSchema,
  updateModuleSchema,
} from './schemas';
import * as trainingService from './service';

const PATHS = ['/training'];
const manage = { permission: 'training.manage', revalidate: PATHS } as const;

export const createCourseAction = authedAction({ ...manage, input: courseSchema }, (ctx, input) =>
  trainingService.createCourse(ctx, input),
);
export const updateCourseAction = authedAction(
  { ...manage, input: updateCourseSchema },
  (ctx, input) => trainingService.updateCourse(ctx, input),
);
export const setCourseStatusAction = authedAction(
  { ...manage, input: courseStatusSchema },
  (ctx, input) => trainingService.setCourseStatus(ctx, input),
);
export const deleteCourseAction = authedAction({ ...manage, input: idSchema }, (ctx, input) =>
  trainingService.deleteCourse(ctx, input.id),
);
export const createModuleAction = authedAction(
  { ...manage, input: createModuleSchema },
  (ctx, input) => trainingService.createModule(ctx, input),
);
export const updateModuleAction = authedAction(
  { ...manage, input: updateModuleSchema },
  (ctx, input) => trainingService.updateModule(ctx, input),
);
export const deleteModuleAction = authedAction({ ...manage, input: idSchema }, (ctx, input) =>
  trainingService.deleteModule(ctx, input.id),
);
export const addAssignmentAction = authedAction(
  { ...manage, input: assignmentSchema },
  (ctx, input) => trainingService.addAssignment(ctx, input),
);
export const removeAssignmentAction = authedAction({ ...manage, input: idSchema }, (ctx, input) =>
  trainingService.removeAssignment(ctx, input.id),
);
export const submitModuleAction = authedAction(
  { permission: 'training.learn', input: submitModuleSchema, revalidate: PATHS },
  (ctx, input) => trainingService.submitModule(ctx, input),
);
