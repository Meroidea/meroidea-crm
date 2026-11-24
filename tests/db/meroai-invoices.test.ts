import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { addDaysToDate, zonedToday } from '@/lib/dates';
import { AppError } from '@/lib/errors';
import { FEATURE_KEYS } from '@/lib/features';
import { chaseOverdueInvoices, draftInvoiceWithMeroAI } from '@/modules/ai/meroai-invoices';
import { meroAIInvoiceDraftSchema } from '@/modules/ai/schemas';
import { createContactSchema } from '@/modules/contacts/schemas';
import { createContact } from '@/modules/contacts/service';
import { saveInvoiceSchema } from '@/modules/invoices/schemas';
import { markInvoicePaid, markInvoiceSent, saveInvoice } from '@/modules/invoices/service';
import type { TenantContext } from '@/server/context';
import { adminDb } from '@/server/db/admin';

import { addMember, contextFor, createWorkspace, destroyWorkspace } from '../support/workspaces';

// Ask MeroAI on the invoices page (ADR-077), against the real database and RLS. Only the model
// that reads a sentence is replaced; reminders never use one.

const model = vi.hoisted(() => ({ read: null as unknown, calls: 0 }));

vi.mock('@/server/ai', () => {
  const modelFor = (tier: string) => (tier === 'reasoning' ? 'test-reasoning' : 'test-fast');
  return {
    isAiConfigured: () => true,
    modelFor,
    aiService: {
      isConfigured: () => true,
      modelFor,
      responseText: () => '',
      generate: async () => {
        throw new Error('Not expected');
      },
      generateJson: async () => {
        model.calls += 1;
        return model.read;
      },
    },
  };
});

const stamp = Date.now();
const mail = (name: string) => `${name}-${stamp}@example.com`;
const rows = async <T>(query: ReturnType<typeof sql>) =>
  (await adminDb().execute(query)) as unknown as T[];

async function expectCode(run: () => Promise<unknown>, code: AppError['code']) {
  const error = await run().then(
    () => null,
    (caught: unknown) => caught,
  );
  expect(error).toBeInstanceOf(AppError);
  expect((error as AppError).code).toBe(code);
}

let alphaTenant: string;
let betaTenant: string;
const alphaUsers: string[] = [];
const betaUsers: string[] = [];
let owner: TenantContext;
let staff: TenantContext;
let betaOwner: TenantContext;
let overdueId: string;
let contactId: string;

const today = zonedToday('Australia/Sydney');

async function invoice(
  ctx: TenantContext,
  customerName: string,
  issueOffset: number,
  dueOffset: number,
) {
  return saveInvoice(
    ctx,
    saveInvoiceSchema.parse({
      customerName,
      customerEmail: 'olivia@example.com',
      issueDate: addDaysToDate(today, issueOffset),
      dueDate: addDaysToDate(today, dueOffset),
      taxRate: '10',
      lines: [{ description: 'Catering', quantity: '1', unitPrice: '100.00' }],
    }),
  );
}

const draft = (ctx: TenantContext, text: string) =>
  draftInvoiceWithMeroAI(ctx, meroAIInvoiceDraftSchema.parse({ text }));

beforeAll(async () => {
  const a = await createWorkspace('Alpha Catering', mail('inv-alpha'));
  alphaTenant = a.tenantId;
  const staffId = await addMember(alphaTenant, mail('inv-staff'), 'Sam Staff', 'member');
  alphaUsers.push(a.ownerId, staffId);
  owner = await contextFor(a.ownerId, alphaTenant);
  staff = await contextFor(staffId, alphaTenant);

  const b = await createWorkspace('Beta Events', mail('inv-beta'));
  betaTenant = b.tenantId;
  betaUsers.push(b.ownerId);
  betaOwner = await contextFor(b.ownerId, betaTenant);

  contactId = (
    await createContact(
      owner,
      createContactSchema.parse({
        firstName: 'Olivia',
        lastName: 'Example',
        email: 'olivia@example.com',
      }),
    )
  ).id;

  // Overdue by 20 days, sent: the only one to chase.
  overdueId = (await invoice(owner, 'Olivia Example', -30, -20)).id;
  await markInvoiceSent(owner, overdueId);
  // Sent but not yet due; a draft with a past due date; and one that was paid.
  await markInvoiceSent(owner, (await invoice(owner, 'Not Yet Due', -2, 12)).id);
  await invoice(owner, 'Still A Draft', -30, -20);
  const paid = (await invoice(owner, 'Already Paid', -30, -20)).id;
  await markInvoiceSent(owner, paid);
  await markInvoicePaid(owner, paid);
  // Another business's overdue invoice must never appear.
  await markInvoiceSent(betaOwner, (await invoice(betaOwner, 'Beta Customer', -30, -20)).id);
}, 120_000);

afterAll(async () => {
  if (alphaTenant) await destroyWorkspace(alphaTenant, alphaUsers);
  if (betaTenant) await destroyWorkspace(betaTenant, betaUsers);
}, 60_000);

beforeEach(() => {
  model.read = null;
  model.calls = 0;
});

describe('chasing overdue invoices', () => {
  it('writes one reminder per sent, unpaid, overdue invoice, firmer for a late one, without a model', async () => {
    const reminders = await chaseOverdueInvoices(owner);
    expect(reminders).toHaveLength(1);
    expect(reminders[0]).toMatchObject({
      invoiceId: overdueId,
      customerName: 'Olivia Example',
      customerEmail: 'olivia@example.com',
      balance: '110.00',
      daysOverdue: 20,
      tone: 'firm',
    });
    expect(reminders[0]?.body).toContain('$110');
    expect(model.calls).toBe(0);

    const [entry] = await rows<{ text: string }>(sql`
      select context::text as text from audit_logs where tenant_id = ${alphaTenant} and action = 'ai_assist'
      order by id desc limit 1`);
    expect(entry?.text).toContain('"action": "chase"');
    expect(entry?.text).not.toContain('Olivia');
  });

  it('another business only ever sees its own', async () => {
    const reminders = await chaseOverdueInvoices(betaOwner);
    expect(reminders.map((reminder) => reminder.customerName)).toEqual(['Beta Customer']);
  });

  it('is for people who manage invoices, while the business has MeroAI', async () => {
    await expectCode(() => chaseOverdueInvoices(staff), 'FORBIDDEN');
    await adminDb().execute(sql`
      update tenants set features = ${sql.raw(
        `array[${FEATURE_KEYS.filter((key) => key !== 'ai_assistant')
          .map((key) => `'${key}'`)
          .join(',')}]::text[]`,
      )} where id = ${alphaTenant}`);
    try {
      await expectCode(
        async () => chaseOverdueInvoices(await contextFor(owner.userId, alphaTenant)),
        'FORBIDDEN',
      );
    } finally {
      await adminDb().execute(sql`
        update tenants set features = ${sql.raw(`array[${FEATURE_KEYS.map((key) => `'${key}'`).join(',')}]::text[]`)}
        where id = ${alphaTenant}`);
    }
  });
});

describe('drafting an invoice from a sentence', () => {
  const invoiceCount = async (tenantId: string) =>
    Number(
      (
        await rows<{ n: number }>(
          sql`select count(*)::int as n from invoices where tenant_id = ${tenantId}`,
        )
      )[0]?.n,
    );

  it('matches the customer, works out the totals and saves nothing', async () => {
    const before = await invoiceCount(alphaTenant);
    model.read = {
      clientName: 'Olivia Example',
      lineItems: [
        { description: 'Consulting', quantity: 2, unitPrice: 150 },
        { description: 'Travel', quantity: 1, unitPrice: 40 },
      ],
      dueDate: addDaysToDate(today, 7),
      notes: null,
    };
    const { artifact } = await draft(
      owner,
      'Olivia Example, 2 hours consulting at $150 and $40 travel, due in 7 days',
    );
    expect(model.calls).toBe(1);
    expect(artifact.customer).toMatchObject({
      name: 'Olivia Example',
      contactId,
      email: 'olivia@example.com',
    });
    expect(artifact).toMatchObject({
      subtotal: '340.00',
      taxTotal: '34.00',
      total: '374.00',
      dueDate: addDaysToDate(today, 7),
    });
    expect(await invoiceCount(alphaTenant)).toBe(before);
  });

  it('asks for what to charge rather than inventing it', async () => {
    model.read = { clientName: 'Olivia Example', lineItems: [], dueDate: null, notes: null };
    await expectCode(() => draft(owner, 'Invoice Olivia please'), 'VALIDATION');
  });

  it('never matches a customer in another business', async () => {
    model.read = {
      clientName: 'Olivia Example',
      lineItems: [{ description: 'Hire', quantity: 1, unitPrice: 50 }],
      dueDate: null,
      notes: null,
    };
    const { artifact } = await draft(betaOwner, 'Olivia Example, hire $50');
    expect(artifact.customer).toEqual({
      name: 'Olivia Example',
      email: null,
      address: null,
      contactId: null,
    });
  });

  it('staff cannot draft invoices', async () => {
    await expectCode(() => draft(staff, 'Olivia Example, hire $50'), 'FORBIDDEN');
  });
});
