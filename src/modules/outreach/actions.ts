'use server';

import { authedAction } from '@/server/action';

import { enrollmentIdSchema, enrollSchema, sendEmailSchema } from './schemas';
import { enrollInSequence, sendContactEmail, stopEnrollment } from './service';

const PATHS = ['/contacts', '/leads', '/tasks', '/my-day'];

export const sendContactEmailAction = authedAction(
  { permission: 'activities.create', input: sendEmailSchema, revalidate: PATHS },
  (ctx, input) => sendContactEmail(ctx, input),
);

export const enrollInSequenceAction = authedAction(
  { permission: 'tasks.manage', input: enrollSchema, revalidate: PATHS },
  (ctx, input) => enrollInSequence(ctx, input),
);

export const stopEnrollmentAction = authedAction(
  { permission: 'tasks.manage', input: enrollmentIdSchema, revalidate: PATHS },
  (ctx, input) => stopEnrollment(ctx, input.enrollmentId),
);
