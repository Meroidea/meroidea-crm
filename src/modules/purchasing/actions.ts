'use server';

import { authedAction } from '@/server/action';

import {
  createSupplierSchema,
  importPriceListSchema,
  orderIdSchema,
  placeOrderSchema,
  setSupplierActiveSchema,
  updateSupplierSchema,
} from './schemas';
import * as purchasingService from './service';

const PATHS = ['/suppliers', '/orders'];
const manage = { permission: 'purchasing.manage', revalidate: PATHS } as const;

export const createSupplierAction = authedAction(
  { ...manage, input: createSupplierSchema },
  (ctx, input) => purchasingService.createSupplier(ctx, input),
);

export const updateSupplierAction = authedAction(
  { ...manage, input: updateSupplierSchema },
  (ctx, input) => purchasingService.updateSupplier(ctx, input),
);

export const setSupplierActiveAction = authedAction(
  { ...manage, input: setSupplierActiveSchema },
  (ctx, input) => purchasingService.setSupplierActive(ctx, input),
);

export const importPriceListAction = authedAction(
  { ...manage, input: importPriceListSchema },
  (ctx, input) => purchasingService.importPriceList(ctx, input),
);

export const placeOrderAction = authedAction({ ...manage, input: placeOrderSchema }, (ctx, input) =>
  purchasingService.placeOrder(ctx, input),
);

export const resendOrderAction = authedAction({ ...manage, input: orderIdSchema }, (ctx, input) =>
  purchasingService.resendOrder(ctx, input.id),
);

export const cancelOrderAction = authedAction({ ...manage, input: orderIdSchema }, (ctx, input) =>
  purchasingService.cancelOrder(ctx, input.id),
);
