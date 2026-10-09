'use server';

import { authedAction } from '@/server/action';

import {
  createItemSchema,
  recordMovementSchema,
  setItemActiveSchema,
  updateItemSchema,
} from './schemas';
import * as inventoryService from './service';

const PATHS = ['/inventory'];
const manage = { permission: 'inventory.manage', revalidate: PATHS } as const;

export const createItemAction = authedAction({ ...manage, input: createItemSchema }, (ctx, input) =>
  inventoryService.createItem(ctx, input),
);

export const updateItemAction = authedAction({ ...manage, input: updateItemSchema }, (ctx, input) =>
  inventoryService.updateItem(ctx, input),
);

export const setItemActiveAction = authedAction(
  { ...manage, input: setItemActiveSchema },
  (ctx, input) => inventoryService.setItemActive(ctx, input),
);

export const recordMovementAction = authedAction(
  { ...manage, input: recordMovementSchema },
  (ctx, input) => inventoryService.recordMovement(ctx, input),
);
