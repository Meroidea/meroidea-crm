import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { AppError } from '@/lib/errors';
import { formatDelta, formatQuantity } from '@/modules/inventory/format';
import {
  getInventorySummary,
  getItem,
  listCategories,
  listItems,
  listMovements,
} from '@/modules/inventory/queries';
import {
  createItemSchema,
  inventoryFiltersSchema,
  recordMovementSchema,
  updateItemSchema,
} from '@/modules/inventory/schemas';
import { createItem, recordMovement, setItemActive, updateItem } from '@/modules/inventory/service';
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
let member: TenantContext;
let outsider: TenantContext;
let flour: string;

async function expectCode(run: () => Promise<unknown>, code: AppError['code']) {
  const error = await run().then(
    () => null,
    (caught: unknown) => caught,
  );
  expect(error).toBeInstanceOf(AppError);
  expect((error as AppError).code).toBe(code);
}

async function rejectionMessage(run: () => Promise<unknown>): Promise<string> {
  try {
    await run();
  } catch (error) {
    const wrapped = error as { message?: string; cause?: { message?: string } };
    return `${wrapped.message ?? ''} ${wrapped.cause?.message ?? ''}`;
  }
  throw new Error('expected the query to be rejected');
}

const item = (overrides: Record<string, unknown> = {}) =>
  createItemSchema.parse({ name: 'Flour', unit: 'kg', category: 'Dry goods', ...overrides });
const movement = (kind: string, quantity: string, extra: Record<string, unknown> = {}) =>
  recordMovementSchema.parse({ itemId: flour, kind, quantity, ...extra });
const filters = (input: Record<string, string> = {}) => inventoryFiltersSchema.parse(input);

beforeAll(async () => {
  const alpha = await createWorkspace('Stock Alpha', mail('stock-alpha'));
  const managerId = await addMember(alpha.tenantId, mail('stock-mgr'), 'Mia Manager', 'manager');
  const memberId = await addMember(alpha.tenantId, mail('stock-mem'), 'Max Member', 'member');
  const beta = await createWorkspace('Stock Beta', mail('stock-beta'));
  alphaTenant = alpha.tenantId;
  betaTenant = beta.tenantId;
  alphaUsers = [alpha.ownerId, managerId, memberId];
  betaUsers = [beta.ownerId];
  owner = await contextFor(alpha.ownerId, alphaTenant);
  manager = await contextFor(managerId, alphaTenant);
  member = await contextFor(memberId, alphaTenant);
  outsider = await contextFor(beta.ownerId, betaTenant);

  flour = (
    await createItem(
      owner,
      item({ sku: 'FLR-01', reorderLevel: '10', unitCost: '1.80', openingQuantity: '25' }),
    )
  ).id;
}, 120_000);

afterAll(async () => {
  if (alphaTenant) await destroyWorkspace(alphaTenant, alphaUsers);
  if (betaTenant) await destroyWorkspace(betaTenant, betaUsers);
}, 60_000);

describe('who can use inventory', () => {
  it('creates an item with its opening count as the first ledger row', async () => {
    expect(await getItem(owner, flour)).toMatchObject({
      name: 'Flour',
      sku: 'FLR-01',
      categoryName: 'Dry goods',
      quantityOnHand: '25.000',
      stockValue: '45.00',
      level: 'ok',
    });
    const ledger = await listMovements(owner, flour);
    expect(ledger).toHaveLength(1);
    expect(ledger[0]).toMatchObject({
      type: 'stocktake',
      quantityDelta: '25.000',
      note: 'Opening count',
    });
  });

  it('lets a manager manage stock and a member only look', async () => {
    await recordMovement(manager, movement('used', '2.5'));
    expect((await getItem(member, flour))?.quantityOnHand).toBe('22.500');

    await expectCode(() => createItem(member, item({ name: 'Sugar' })), 'FORBIDDEN');
    await expectCode(() => recordMovement(member, movement('used', '1')), 'FORBIDDEN');
    await expectCode(() => setItemActive(member, { id: flour, isActive: false }), 'FORBIDDEN');
    await expectCode(
      () => updateItem(member, updateItemSchema.parse({ id: flour, name: 'Hacked', unit: 'kg' })),
      'FORBIDDEN',
    );
  });

  it('is refused by the database itself when a member writes past the service', async () => {
    const message = await rejectionMessage(() =>
      withRls(member, (tx) =>
        tx.execute(sql`insert into inventory_items (tenant_id, name, currency)
                       values (${alphaTenant}, 'Sneaked in', 'AUD')`),
      ),
    );
    expect(message).toMatch(/row-level security/i);

    await withRls(member, (tx) =>
      tx.execute(sql`update inventory_items set quantity_on_hand = 999 where id = ${flour}`),
    );
    expect((await getItem(owner, flour))?.quantityOnHand).toBe('22.500');
  });

  it('never shows or changes another workspace’s stock', async () => {
    expect(await getItem(outsider, flour)).toBeNull();
    expect(await listItems(outsider, filters())).toEqual([]);
    expect(await listMovements(outsider, flour)).toEqual([]);
    await expectCode(() => recordMovement(outsider, movement('received', '5')), 'NOT_FOUND');
    await expectCode(() => setItemActive(outsider, { id: flour, isActive: false }), 'NOT_FOUND');
  });

  it('keeps the ledger append-only, even for the owner', async () => {
    const message = await rejectionMessage(() =>
      withRls(owner, (tx) =>
        tx.execute(sql`update inventory_movements set note = 'tampered' where item_id = ${flour}`),
      ),
    );
    expect(message).toMatch(/permission denied/i);
  });
});

describe('stock arithmetic', () => {
  it('adds what is received and takes on the latest purchase cost', async () => {
    const result = await recordMovement(owner, movement('received', '10', { unitCost: '2.00' }));
    expect(result.quantityAfter).toBe('32.500');
    expect(await getItem(owner, flour)).toMatchObject({ unitCost: '2.00', stockValue: '65.00' });
  });

  it('refuses to remove more than is on hand, and leaves the balance alone', async () => {
    await expectCode(() => recordMovement(owner, movement('used', '100')), 'CONFLICT');
    expect((await getItem(owner, flour))?.quantityOnHand).toBe('32.500');
    expect(await listMovements(owner, flour)).toHaveLength(3);
  });

  it('needs a reason for waste and for corrections', () => {
    expect(
      recordMovementSchema.safeParse({ itemId: flour, kind: 'wasted', quantity: '1' }).success,
    ).toBe(false);
    expect(
      recordMovementSchema.safeParse({ itemId: flour, kind: 'remove', quantity: '1' }).success,
    ).toBe(false);
    expect(
      recordMovementSchema.safeParse({ itemId: flour, kind: 'used', quantity: '0' }).success,
    ).toBe(false);
    expect(
      recordMovementSchema.safeParse({ itemId: flour, kind: 'used', quantity: '1.2345' }).success,
    ).toBe(false);
  });

  it('records waste and corrections with their sign', async () => {
    await recordMovement(owner, movement('wasted', '0.5', { note: 'Bag split' }));
    await recordMovement(owner, movement('add', '1', { note: 'Found in the back' }));
    const [latest, previous] = await listMovements(owner, flour);
    expect(latest).toMatchObject({
      type: 'adjusted',
      quantityDelta: '1.000',
      quantityAfter: '33.000',
    });
    expect(previous).toMatchObject({ type: 'wasted', quantityDelta: '-0.500', note: 'Bag split' });
  });

  it('sets the balance to a stocktake count and records the difference, including none', async () => {
    await recordMovement(owner, movement('stocktake', '8'));
    expect((await listMovements(owner, flour))[0]).toMatchObject({
      type: 'stocktake',
      quantityDelta: '-25.000',
      quantityAfter: '8.000',
    });
    await recordMovement(owner, movement('stocktake', '8'));
    expect((await listMovements(owner, flour))[0]?.quantityDelta).toBe('0.000');
  });

  it('keeps decimals exact where floating point would drift', async () => {
    const id = (
      await createItem(owner, item({ name: 'Oil', unit: 'L', category: null, sku: null }))
    ).id;
    const add = (quantity: string) =>
      recordMovement(owner, recordMovementSchema.parse({ itemId: id, kind: 'received', quantity }));
    await add('0.1');
    await add('0.2');
    expect((await getItem(owner, id))?.quantityOnHand).toBe('0.300');
  });
});

describe('lists and levels', () => {
  it('flags an item at or under its reorder level as low, and at zero as out', async () => {
    expect((await getItem(owner, flour))?.level).toBe('low');
    expect((await listItems(owner, filters({ view: 'low' }))).map((row) => row.id)).toEqual([
      flour,
    ]);

    await recordMovement(owner, movement('stocktake', '0'));
    expect((await getItem(owner, flour))?.level).toBe('out');
    const summary = await getInventorySummary(owner);
    expect(summary).toMatchObject({ items: 2, low: 0, out: 1, archived: 0 });
  });

  it('filters by search and category, and reuses a category whatever its capitalisation', async () => {
    await createItem(owner, item({ name: 'Rice', category: 'DRY GOODS', sku: 'RIC-01' }));
    const categories = await listCategories(owner);
    expect(categories.map((category) => category.name)).toEqual(['Dry goods']);
    const dry = categories[0]?.id ?? '';
    expect((await listItems(owner, filters({ category: dry }))).map((row) => row.name)).toEqual([
      'Flour',
      'Rice',
    ]);
    expect((await listItems(owner, filters({ q: 'ric-' }))).map((row) => row.name)).toEqual([
      'Rice',
    ]);
  });

  it('refuses a code another live item already uses', async () => {
    await expectCode(
      () => createItem(owner, item({ name: 'Other flour', sku: 'flr-01' })),
      'CONFLICT',
    );
  });

  it('moves an archived item out of the working list but keeps its history', async () => {
    await setItemActive(owner, { id: flour, isActive: false });
    expect((await listItems(owner, filters())).map((row) => row.id)).not.toContain(flour);
    expect((await listItems(owner, filters({ view: 'archived' }))).map((row) => row.id)).toEqual([
      flour,
    ]);
    expect((await listMovements(owner, flour)).length).toBeGreaterThan(5);
    await setItemActive(owner, { id: flour, isActive: true });
  });
});

describe('display helpers', () => {
  it('trims trailing zeros without touching the value', () => {
    expect(formatQuantity('12.500')).toBe('12.5');
    expect(formatQuantity('3.000')).toBe('3');
    expect(formatQuantity('100')).toBe('100');
    expect(formatDelta('-0.500')).toBe('−0.5');
    expect(formatDelta('25.000')).toBe('+25');
  });
});
