import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { addDaysToDate, zonedToday } from '@/lib/dates';
import { AppError } from '@/lib/errors';
import { renderOrderEmail } from '@/modules/purchasing/channels';
import {
  getOrder,
  getSupplier,
  listOrders,
  listSupplierItems,
  listSuppliers,
} from '@/modules/purchasing/queries';
import {
  createSupplierSchema,
  importPriceListSchema,
  placeOrderSchema,
} from '@/modules/purchasing/schemas';
import {
  cancelOrder,
  createSupplier,
  importPriceList,
  placeOrder,
  resendOrder,
  setSupplierActive,
} from '@/modules/purchasing/service';
import type { TenantContext } from '@/server/context';
import { withRls } from '@/server/db/with-rls';

import { addMember, contextFor, createWorkspace, destroyWorkspace } from '../support/workspaces';

const stamp = Date.now();
const mail = (name: string) => `${name}-${stamp}@example.com`;

let alphaTenant: string;
let betaTenant: string;
let alphaUsers: string[];
let betaUsers: string[];
let owner: TenantContext;
let manager: TenantContext;
let outsider: TenantContext;
let supplierId: string;
let deliveryDate: string;

async function expectCode(run: () => Promise<unknown>, code: AppError['code']) {
  const error = await run().then(
    () => null,
    (caught: unknown) => caught,
  );
  expect(error).toBeInstanceOf(AppError);
  expect((error as AppError).code).toBe(code);
}

const supplier = (overrides: Record<string, unknown> = {}) =>
  createSupplierSchema.parse({
    name: 'Harbour Foods',
    orderEmail: 'orders@example.com',
    accountNumber: 'ACC-77',
    leadDays: 2,
    ...overrides,
  });

const priceList = (items: Record<string, unknown>[], replace = false) =>
  importPriceListSchema.parse({ supplierId, replace, items });

async function order(lines: [string, string][], overrides: Record<string, unknown> = {}) {
  const items = await listSupplierItems(owner, supplierId);
  return placeOrderSchema.parse({
    supplierId,
    deliveryDate,
    lines: lines.map(([name, quantity]) => ({
      supplierItemId: items.find((item) => item.name === name)?.id,
      quantity,
    })),
    ...overrides,
  });
}

beforeAll(async () => {
  const alpha = await createWorkspace('Buying Alpha', mail('buy-alpha'));
  const managerId = await addMember(alpha.tenantId, mail('buy-mgr'), 'Mia Manager', 'manager');
  const beta = await createWorkspace('Buying Beta', mail('buy-beta'));
  alphaTenant = alpha.tenantId;
  betaTenant = beta.tenantId;
  alphaUsers = [alpha.ownerId, managerId];
  betaUsers = [beta.ownerId];
  owner = await contextFor(alpha.ownerId, alphaTenant);
  manager = await contextFor(managerId, alphaTenant);
  outsider = await contextFor(beta.ownerId, betaTenant);

  supplierId = (await createSupplier(owner, supplier())).id;
  // Any day is a delivery day for this supplier; five days out clears the two-day lead time.
  deliveryDate = addDaysToDate(zonedToday(owner.tenant.timezone), 5);
}, 120_000);

afterAll(async () => {
  if (alphaTenant) await destroyWorkspace(alphaTenant, alphaUsers);
  if (betaTenant) await destroyWorkspace(betaTenant, betaUsers);
}, 60_000);

describe('who can buy', () => {
  it('keeps suppliers to the owner: a manager is refused by the service and the database', async () => {
    await expectCode(() => createSupplier(manager, supplier({ name: 'Other' })), 'FORBIDDEN');
    await expectCode(() => listSuppliers(manager), 'FORBIDDEN');
    const rows = (await withRls(manager, (tx) =>
      tx.execute(sql`select
        (select count(*)::int from suppliers) as suppliers,
        (select count(*)::int from supplier_items) as items,
        (select count(*)::int from purchase_orders) as orders`),
    )) as unknown as Record<string, number>[];
    expect(rows[0]).toEqual({ suppliers: 0, items: 0, orders: 0 });
  });

  it('never shows another workspace’s suppliers or lets it order from them', async () => {
    expect(await getSupplier(outsider, supplierId)).toBeNull();
    expect(await listSuppliers(outsider)).toEqual([]);
    await expectCode(
      () => importPriceList(outsider, priceList([{ name: 'Rice', unitPrice: '1.00' }])),
      'NOT_FOUND',
    );
  });

  it('refuses a second supplier with the same name', async () => {
    await expectCode(() => createSupplier(owner, supplier({ name: 'harbour foods' })), 'CONFLICT');
  });
});

describe('a supplier’s price list', () => {
  it('loads items, then on a second file updates matches, adds new ones and can drop the rest', async () => {
    expect(
      await importPriceList(
        owner,
        priceList([
          { name: 'Plain flour', code: 'FL-01', unit: '12.5 kg bag', unitPrice: '21.40' },
          { name: 'Olive oil', unitPrice: '48.00' },
          { name: 'Sea salt', code: 'SA-02', unitPrice: '3.10' },
        ]),
      ),
    ).toEqual({ added: 3, updated: 0, removed: 0 });

    expect(
      await importPriceList(
        owner,
        priceList(
          [
            {
              name: 'Plain flour (new pack)',
              code: 'fl-01',
              unit: '10 kg bag',
              unitPrice: '19.90',
            },
            { name: 'olive oil', unitPrice: '51.25' },
            { name: 'Rice', code: 'RI-09', unitPrice: '2.75' },
          ],
          true,
        ),
      ),
    ).toEqual({ added: 1, updated: 2, removed: 1 });

    const items = await listSupplierItems(owner, supplierId);
    expect(items.map((item) => [item.name, item.code, item.unitPrice])).toEqual([
      ['olive oil', null, '51.25'],
      ['Plain flour (new pack)', 'fl-01', '19.90'],
      ['Rice', 'RI-09', '2.75'],
    ]);
    expect((await getSupplier(owner, supplierId))?.itemCount).toBe(3);
  });
});

describe('placing an order', () => {
  let orderId: string;

  it('saves the order with exact totals and snapshots, numbered from one', async () => {
    const placed = await placeOrder(
      owner,
      await order(
        [
          ['Plain flour (new pack)', '3'],
          ['olive oil', '1.5'],
        ],
        { notes: 'Leave at the back door' },
      ),
    );
    orderId = placed.id;
    expect(placed.number).toBe(1);

    const saved = await getOrder(owner, orderId);
    // 3 × 19.90 = 59.70; 1.5 × 51.25 = 76.875, rounded to 76.88.
    expect(saved).toMatchObject({
      total: '136.58',
      currency: 'AUD',
      supplierName: 'Harbour Foods',
    });
    expect(
      saved?.lines.map((line) => [line.name, line.quantity, line.unitPrice, line.lineTotal]),
    ).toEqual([
      ['Plain flour (new pack)', '3.000', '19.90', '59.70'],
      ['olive oil', '1.500', '51.25', '76.88'],
    ]);
  });

  it('keeps an order that could not be emailed, marked as not sent with the reason', async () => {
    // Automated tests never send real email, so every send reports that email is not set up.
    const saved = await getOrder(owner, orderId);
    expect(saved).toMatchObject({ status: 'not_sent', sentAt: null });
    const again = await resendOrder(owner, orderId);
    expect(again.sent).toBe(false);
    expect(again.reason).toMatch(/email/i);
  });

  it('writes an email a supplier can act on, without prices in the plain text', async () => {
    const saved = await getOrder(owner, orderId);
    if (!saved) throw new Error('no order');
    const email = renderOrderEmail({
      number: saved.number,
      buyerName: 'Buying Alpha',
      buyerEmail: 'owner@example.com',
      supplierName: saved.supplierName,
      accountNumber: 'ACC-77',
      orderEmail: 'orders@example.com',
      deliveryDate: '2026-10-12',
      notes: saved.notes,
      currency: saved.currency,
      total: saved.total,
      lines: saved.lines,
    });
    expect(email.subject).toBe('Order PO-0001 from Buying Alpha for delivery 12 Oct 2026');
    expect(email.text).toContain('3 x fl-01 Plain flour (new pack) (10 kg bag)');
    expect(email.text).toContain('1.5 x olive oil');
    expect(email.text).toContain('Account: ACC-77');
    expect(email.text).toContain('Leave at the back door');
    expect(email.html).toContain('<td');
  });

  it('keeps the price an order was placed at when the list changes later', async () => {
    await importPriceList(owner, priceList([{ name: 'olive oil', unitPrice: '99.00' }]));
    const saved = await getOrder(owner, orderId);
    expect(saved?.lines[1]).toMatchObject({ unitPrice: '51.25', lineTotal: '76.88' });
    expect(saved?.total).toBe('136.58');
  });

  it('numbers the next order two, and lists newest first', async () => {
    const second = await placeOrder(owner, await order([['Rice', '10']]));
    expect(second.number).toBe(2);
    expect((await listOrders(owner)).map((row) => row.number)).toEqual([2, 1]);
    expect(await listOrders(outsider)).toEqual([]);
  });

  it('refuses a delivery date the supplier cannot make', async () => {
    const tooSoon = addDaysToDate(zonedToday(owner.tenant.timezone), 1);
    await expectCode(
      async () => placeOrder(owner, await order([['Rice', '1']], { deliveryDate: tooSoon })),
      'VALIDATION',
    );
  });

  it('refuses items from another supplier’s list, duplicates, and an archived supplier', async () => {
    const other = await createSupplier(owner, supplier({ name: 'Second Supplier' }));
    await importPriceList(
      owner,
      importPriceListSchema.parse({
        supplierId: other.id,
        items: [{ name: 'Foreign item', unitPrice: '1.00' }],
      }),
    );
    const [foreign] = await listSupplierItems(owner, other.id);
    const base = { supplierId, deliveryDate };
    await expectCode(
      () =>
        placeOrder(
          owner,
          placeOrderSchema.parse({
            ...base,
            lines: [{ supplierItemId: foreign?.id, quantity: '1' }],
          }),
        ),
      'VALIDATION',
    );
    const [rice] = (await listSupplierItems(owner, supplierId)).filter(
      (item) => item.name === 'Rice',
    );
    await expectCode(
      () =>
        placeOrder(
          owner,
          placeOrderSchema.parse({
            ...base,
            lines: [
              { supplierItemId: rice?.id, quantity: '1' },
              { supplierItemId: rice?.id, quantity: '2' },
            ],
          }),
        ),
      'VALIDATION',
    );

    await setSupplierActive(owner, { id: supplierId, isActive: false });
    await expectCode(async () => placeOrder(owner, await order([['Rice', '1']])), 'CONFLICT');
    await setSupplierActive(owner, { id: supplierId, isActive: true });
  });

  it('refuses to order from a supplier with no order email', async () => {
    const silent = await createSupplier(owner, supplier({ name: 'No Email Co', orderEmail: '' }));
    await importPriceList(
      owner,
      importPriceListSchema.parse({
        supplierId: silent.id,
        items: [{ name: 'Thing', unitPrice: '1.00' }],
      }),
    );
    const [thing] = await listSupplierItems(owner, silent.id);
    await expectCode(
      () =>
        placeOrder(
          owner,
          placeOrderSchema.parse({
            supplierId: silent.id,
            deliveryDate,
            lines: [{ supplierItemId: thing?.id, quantity: '1' }],
          }),
        ),
      'VALIDATION',
    );
  });

  it('cancels once, keeps the record, and will not send a cancelled order', async () => {
    await cancelOrder(owner, orderId);
    expect((await getOrder(owner, orderId))?.status).toBe('cancelled');
    await expectCode(() => cancelOrder(owner, orderId), 'NOT_FOUND');
    await expectCode(() => resendOrder(owner, orderId), 'CONFLICT');
    await expectCode(() => cancelOrder(manager, orderId), 'FORBIDDEN');
  });
});
