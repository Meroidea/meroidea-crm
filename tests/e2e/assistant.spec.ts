import { expect, test, type Page } from '@playwright/test';
import postgres from 'postgres';

import { onboardBusiness, switchOnFeature } from './support/flows';

/*
 * Meroidea AI's approval flow in a real browser (ADR-064). The model is the only thing replaced:
 * the chat endpoint's stream is answered here with what Gemini would send after calling
 * propose_invoice, pointing at a real proposal row. The drawer, the card, and the approve and
 * cancel endpoints, with their session, ownership and permission checks, all run for real.
 */

const db = () => {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('Browser tests need DATABASE_URL.');
  return postgres(url, { max: 1 });
};

/** Records a proposal as propose_invoice would, for the business's admin. */
async function seedInvoiceProposal(company: string, adminEmail: string, customer: string) {
  const sql = db();
  try {
    const payload = {
      invoice: {
        customerName: customer,
        customerEmail: null,
        customerAddress: null,
        fromDetails: company,
        issueDate: '2031-03-01',
        dueDate: '2031-03-15',
        taxRate: '10',
        notes: null,
        lines: [
          { description: 'Consulting', quantity: '2', unitPrice: '150.00' },
          { description: 'Setup', quantity: '1', unitPrice: '99.95' },
        ],
      },
    };
    const summary = `Draft invoice for ${customer}: 2 lines, AUD 439.95 due 2031-03-15`;
    const [row] = await sql<{ id: string; expires_at: Date }[]>`
      insert into ai_pending_actions (tenant_id, created_by, kind, payload, summary)
      select t.id, u.id, 'invoice', ${sql.json(payload)}, ${summary}
      from tenants t, auth.users u
      where t.name = ${company} and u.email = ${adminEmail}
      returning id, expires_at`;
    if (!row) throw new Error('no proposal seeded');
    return {
      id: row.id,
      kind: 'invoice',
      payload,
      summary,
      status: 'pending',
      error: null,
      result: null,
      expiresAt: row.expires_at.toISOString(),
    };
  } finally {
    await sql.end();
  }
}

/** Answers the next chat turn with a propose_invoice result, as the AI SDK streams it. */
async function streamProposal(page: Page, proposal: Record<string, unknown>) {
  await page.route('**/api/ai/chat', async (route) => {
    const events = [
      { type: 'start', messageId: `m-${proposal.id}` },
      { type: 'start-step' },
      {
        type: 'tool-input-available',
        toolCallId: `c-${proposal.id}`,
        toolName: 'propose_invoice',
        input: {},
      },
      {
        type: 'tool-output-available',
        toolCallId: `c-${proposal.id}`,
        output: { proposal, next: 'Waiting for approval.' },
      },
      { type: 'finish-step' },
      { type: 'start-step' },
      { type: 'text-start', id: 't1' },
      {
        type: 'text-delta',
        id: 't1',
        delta: 'I prepared a **draft invoice**. Approve it to save.',
      },
      { type: 'text-end', id: 't1' },
      { type: 'finish-step' },
      { type: 'finish' },
    ];
    await route.fulfill({
      status: 200,
      headers: {
        'content-type': 'text/event-stream',
        'x-vercel-ai-ui-message-stream': 'v1',
      },
      body: `${events.map((event) => `data: ${JSON.stringify(event)}\n\n`).join('')}data: [DONE]\n\n`,
    });
  });
}

test('an AI proposal waits for approval, then runs once; cancel runs nothing', async ({
  page,
  context,
  browser,
}, testInfo) => {
  test.slow();
  const stamp = `${Date.now()}-${testInfo.project.name}`;
  const { company, adminEmail } = await onboardBusiness(page, context, stamp, 'services');
  await switchOnFeature(browser, company, /^AI assistant/);

  await page.goto('/dashboard');
  await page.waitForLoadState('networkidle');
  await expect(page.getByRole('button', { name: /Open Meroidea AI/ })).toBeVisible();
  await page.keyboard.press('Control+k');
  const drawer = page.getByRole('dialog', { name: 'Meroidea AI' });
  await expect(drawer).toBeVisible();
  await expect(
    drawer.getByRole('button', { name: 'Draft an invoice for a customer' }),
  ).toBeVisible();

  // Approve: the card shows exactly what will be saved, and approving creates one draft.
  const first = await seedInvoiceProposal(company, adminEmail, 'Example Pty Ltd');
  await streamProposal(page, first);
  await drawer.getByLabel('Message Meroidea AI').fill('Invoice Example Pty Ltd for consulting');
  await drawer.getByLabel('Message Meroidea AI').press('Enter');

  const card = drawer.getByLabel('Draft invoice proposal');
  await expect(card).toContainText('Awaiting your approval');
  await expect(card).toContainText('Example Pty Ltd');
  await expect(card).toContainText('$439.95');
  await expect(drawer.getByText('draft invoice', { exact: false }).first()).toBeVisible();

  await card.getByRole('button', { name: 'Approve & Execute' }).click();
  await expect(card).toContainText('Approved');
  await expect(card).toContainText('Draft invoice #1 created');
  await expect(card.getByRole('button', { name: 'Approve & Execute' })).toHaveCount(0);

  const sql = db();
  try {
    const invoices = await sql<{ status: string; total: string }[]>`
      select i.status, i.total::text as total from invoices i join tenants t on t.id = i.tenant_id
      where t.name = ${company}`;
    expect(invoices).toEqual([{ status: 'draft', total: '439.95' }]);

    // Approving again from outside the card is refused: it can run only once.
    const again = await page.request.post(`/api/ai/actions/${first.id}/approve`, {
      headers: { origin: new URL(page.url()).origin },
    });
    expect(again.status()).toBe(409);

    // Cancel: the second proposal is marked cancelled and nothing is created.
    await page.unroute('**/api/ai/chat');
    const second = await seedInvoiceProposal(company, adminEmail, 'Second Pty Ltd');
    await streamProposal(page, second);
    await drawer.getByLabel('Message Meroidea AI').fill('Invoice Second Pty Ltd');
    await drawer.getByLabel('Message Meroidea AI').press('Enter');
    const secondCard = drawer.getByLabel('Draft invoice proposal').nth(1);
    await secondCard.getByRole('button', { name: 'Cancel' }).click();
    await expect(secondCard).toContainText('Cancelled');
    const [{ count } = { count: -1 }] = await sql<{ count: number }[]>`
      select count(*)::int as count from invoices i join tenants t on t.id = i.tenant_id
      where t.name = ${company}`;
    expect(count).toBe(1);
  } finally {
    await sql.end();
  }
});
