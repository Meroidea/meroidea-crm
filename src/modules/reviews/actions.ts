'use server';

import { authedAction } from '@/server/action';

import { handleReviewSchema, idSchema, saveLinkSchema } from './schemas';
import * as reviewService from './service';

const PATHS = ['/reviews'];
const manage = { permission: 'reviews.manage', revalidate: PATHS } as const;

export const saveReviewLinkAction = authedAction(
  { ...manage, input: saveLinkSchema },
  (ctx, input) => reviewService.saveReviewLink(ctx, input),
);
export const handleReviewAction = authedAction(
  { ...manage, input: handleReviewSchema },
  (ctx, input) => reviewService.handleReview(ctx, input),
);
export const deleteReviewAction = authedAction({ ...manage, input: idSchema }, (ctx, input) =>
  reviewService.deleteReview(ctx, input.id),
);
