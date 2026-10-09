'use server';

import { authedAction } from '@/server/action';

import {
  assignDepartmentSchema,
  createDepartmentSchema,
  departmentIdSchema,
  endEmploymentSchema,
  linkLoginSchema,
  renameDepartmentSchema,
  updateProfileSchema,
} from './staff-schemas';
import * as staffService from './staff-service';

const PATHS = ['/staff', '/hiring'];
const manage = { permission: 'employees.manage', revalidate: PATHS } as const;

export const createDepartmentAction = authedAction(
  { ...manage, input: createDepartmentSchema },
  (ctx, input) => staffService.createDepartment(ctx, input.name),
);

export const renameDepartmentAction = authedAction(
  { ...manage, input: renameDepartmentSchema },
  (ctx, input) => staffService.renameDepartment(ctx, input),
);

export const deleteDepartmentAction = authedAction(
  { ...manage, input: departmentIdSchema },
  (ctx, input) => staffService.deleteDepartment(ctx, input.id),
);

export const assignDepartmentAction = authedAction(
  { ...manage, input: assignDepartmentSchema },
  (ctx, input) => staffService.assignDepartment(ctx, input),
);

export const updateEmployeeProfileAction = authedAction(
  { ...manage, input: updateProfileSchema },
  (ctx, input) => staffService.updateEmployeeProfile(ctx, input),
);

export const endEmploymentAction = authedAction(
  { ...manage, input: endEmploymentSchema },
  (ctx, input) => staffService.endEmployment(ctx, input),
);

export const linkEmployeeLoginAction = authedAction(
  { ...manage, input: linkLoginSchema },
  (ctx, input) => staffService.linkEmployeeLogin(ctx, input),
);
