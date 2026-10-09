'use server';

import { authedAction } from '@/server/action';

import {
  addApplicantSchema,
  addNoteSchema,
  idSchema,
  moveApplicantSchema,
  openingStatusSchema,
  rateApplicantSchema,
  saveOpeningSchema,
} from './schemas';
import * as recruitmentService from './service';

const PATHS = ['/recruitment'];
const manage = { permission: 'recruitment.manage', revalidate: PATHS } as const;

export const saveOpeningAction = authedAction(
  { ...manage, input: saveOpeningSchema },
  (ctx, input) => recruitmentService.saveOpening(ctx, input),
);
export const setOpeningStatusAction = authedAction(
  { ...manage, input: openingStatusSchema },
  (ctx, input) => recruitmentService.setOpeningStatus(ctx, input),
);
export const addApplicantAction = authedAction(
  { ...manage, input: addApplicantSchema },
  (ctx, input) => recruitmentService.addApplicant(ctx, input),
);
export const moveApplicantAction = authedAction(
  { ...manage, input: moveApplicantSchema },
  (ctx, input) => recruitmentService.moveApplicant(ctx, input),
);
export const rateApplicantAction = authedAction(
  { ...manage, input: rateApplicantSchema },
  (ctx, input) => recruitmentService.rateApplicant(ctx, input),
);
export const addApplicantNoteAction = authedAction(
  { ...manage, input: addNoteSchema },
  (ctx, input) => recruitmentService.addApplicantNote(ctx, input),
);
export const deleteApplicantAction = authedAction({ ...manage, input: idSchema }, (ctx, input) =>
  recruitmentService.deleteApplicant(ctx, input.id),
);
export const getResumeUrlAction = authedAction(
  { permission: 'recruitment.manage', input: idSchema },
  (ctx, input) => recruitmentService.getResumeUrl(ctx, input.id),
);
