'use server';

import { authedAction } from '@/server/action';

import { updateMyProfileSchema } from './schemas';
import * as profileService from './service';

/** Anyone signed in may edit their own details, so no permission beyond membership. */
export const updateMyProfileAction = authedAction(
  { permission: null, input: updateMyProfileSchema, revalidate: ['/profile'] },
  (ctx, input) => profileService.updateMyProfile(ctx, input),
);
