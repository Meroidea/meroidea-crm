import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { customerReviews, ticketMessages, tickets } from '@/db/schema';
import { AppError } from '@/lib/errors';
import {
  getPublicForm,
  getPublicTicket,
  replyAsCustomer,
  submitPublicTicket,
} from '@/modules/helpdesk/public';
import {
  getHelpdeskForm,
  getTicket,
  getTicketCounts,
  listTickets,
} from '@/modules/helpdesk/queries';
import {
  createTicketSchema,
  publicTicketSchema,
  replySchema,
  responseDueAt,
} from '@/modules/helpdesk/schemas';
import {
  createTicket,
  deleteTicket,
  replyToTicket,
  setFormOpen,
  updateTicket,
} from '@/modules/helpdesk/service';
import { getPublicReviewLink, submitReview } from '@/modules/reviews/public';
import { getReviewSummary, listReviewLinks, listReviews } from '@/modules/reviews/queries';
import { saveLinkSchema, submitReviewSchema } from '@/modules/reviews/schemas';
import { deleteReview, handleReview, saveReviewLink } from '@/modules/reviews/service';
import type { TenantContext } from '@/server/context';
import { adminDb } from '@/server/db/admin';
import { withRls } from '@/server/db/with-rls';

import { addMember, contextFor, createWorkspace, destroyWorkspace } from '../support/workspaces';

const stamp = Date.now();
const mail = (name: string) => `${name}-${stamp}@example.com`;

let alphaTenant: string;
let betaTenant: string;
let alphaUsers: string[];
let betaUsers: string[];
let owner: TenantContext;
let member: TenantContext;
let betaOwner: TenantContext;

const code = (promise: Promise<unknown>) =>
  promise.then(
    () => 'OK',
    (error: unknown) => (error instanceof AppError ? error.code : String(error)),
  );

beforeAll(async () => {
  const alpha = await createWorkspace(`Voice Alpha ${stamp}`, mail('voice-alpha-owner'));
  const beta = await createWorkspace(`Voice Beta ${stamp}`, mail('voice-beta-owner'));
  alphaTenant = alpha.tenantId;
  betaTenant = beta.tenantId;
  const memberId = await addMember(alphaTenant, mail('voice-member'), 'Max Member', 'member');
  alphaUsers = [alpha.ownerId, memberId];
  betaUsers = [beta.ownerId];
  owner = await contextFor(alpha.ownerId, alphaTenant);
  member = await contextFor(memberId, alphaTenant);
  betaOwner = await contextFor(beta.ownerId, betaTenant);
  // A known customer, to check reviews and tickets attach to their record.
  await adminDb().execute(sql`
    insert into contacts (tenant_id, first_name, last_name, email, email_normalized)
    values (${alphaTenant}, 'Rita', 'Regular', ${mail('rita')}, ${mail('rita')})`);
});

afterAll(async () => {
  await destroyWorkspace(alphaTenant, alphaUsers);
  await destroyWorkspace(betaTenant, betaUsers);
});

describe('customer reviews', () => {
  let token: string;
  const review = (rating: number, extra = {}) => submitReviewSchema.parse({ rating, ...extra });

  it('a review link gets its own public address; staff without the permission cannot make one', async () => {
    const input = saveLinkSchema.parse({ name: 'Front counter', prompt: 'How was your visit?' });
    expect(await code(saveReviewLink(member, input))).toBe('FORBIDDEN');
    await saveReviewLink(owner, input);
    const [link] = await listReviewLinks(owner);
    token = link!.publicToken;
    expect(token).toMatch(/^[A-Za-z0-9_-]{20}$/);
    expect(await getPublicReviewLink(token)).toEqual({
      prompt: 'How was your visit?',
      businessName: owner.tenant.name,
    });
    expect(await getPublicReviewLink('nope-nope-nope-nope')).toBeNull();
  });

  it('the public form refuses ratings outside 1 to 5 and a bad email', () => {
    expect(submitReviewSchema.safeParse({ rating: 0 }).success).toBe(false);
    expect(submitReviewSchema.safeParse({ rating: 6 }).success).toBe(false);
    expect(submitReviewSchema.safeParse({ rating: 4, customerEmail: 'nope' }).success).toBe(false);
    expect(review(5, { customerEmail: '' }).customerEmail).toBeNull();
  });

  it('a customer review lands in the business, tied to their record when the email is known', async () => {
    await submitReview(
      token,
      review(5, {
        comment: 'Lovely coffee',
        customerName: 'Rita',
        customerEmail: mail('RITA'),
        contactAllowed: true,
      }),
    );
    await submitReview(token, review(2, { comment: 'Slow service', contactAllowed: true }));
    const rows = await listReviews(owner);
    expect(rows).toHaveLength(2);
    const rita = rows.find((row) => row.rating === 5)!;
    expect(rita).toMatchObject({ status: 'new', contactAllowed: true, linkName: 'Front counter' });
    expect(rita.contactId).not.toBeNull();
    // Consent to contact means nothing without a way to reach them.
    expect(rows.find((row) => row.rating === 2)).toMatchObject({
      contactAllowed: false,
      contactId: null,
    });
    expect(await getReviewSummary(owner)).toMatchObject({
      total: 2,
      average: '3.5',
      waiting: 2,
      distribution: [0, 1, 0, 0, 1],
    });
  });

  it('other businesses and staff without the permission see none of it', async () => {
    expect(await listReviews(betaOwner)).toEqual([]);
    expect((await getReviewSummary(betaOwner)).total).toBe(0);
    expect(await code(listReviews(member))).toBe('FORBIDDEN');
    const raw = await withRls(member, (tx) =>
      tx.select({ id: customerReviews.id }).from(customerReviews),
    );
    expect(raw).toEqual([]);
  });

  it('a review is followed up or removed only by its own business', async () => {
    const [first] = await listReviews(owner, { rating: 2 });
    const input = {
      id: first!.id,
      status: 'resolved' as const,
      internalNote: 'Called and apologised',
    };
    expect(await code(handleReview(betaOwner, input))).toBe('NOT_FOUND');
    expect(await code(deleteReview(betaOwner, first!.id))).toBe('NOT_FOUND');
    await handleReview(owner, input);
    expect((await listReviews(owner, { status: 'resolved' }))[0]?.internalNote).toBe(
      'Called and apologised',
    );
    await deleteReview(owner, first!.id);
    expect((await getReviewSummary(owner)).total).toBe(1);
  });

  it('a switched-off link, or a business without the feature, takes no reviews', async () => {
    const [link] = await listReviewLinks(owner);
    await saveReviewLink(owner, {
      id: link!.id,
      name: link!.name,
      prompt: link!.prompt,
      isActive: false,
    });
    expect(await getPublicReviewLink(token)).toBeNull();
    expect(await code(submitReview(token, review(4)))).toBe('NOT_FOUND');
    await saveReviewLink(owner, {
      id: link!.id,
      name: link!.name,
      prompt: link!.prompt,
      isActive: true,
    });
    await adminDb().execute(
      sql`update tenants set features = array_remove(features, 'reviews') where id = ${alphaTenant}`,
    );
    expect(await code(submitReview(token, review(4)))).toBe('NOT_FOUND');
    await adminDb().execute(
      sql`update tenants set features = array_append(features, 'reviews') where id = ${alphaTenant}`,
    );
  });
});

describe('helpdesk', () => {
  let ticketId: string;
  let formToken: string;
  let customerToken: string;
  const ticket = (extra = {}) =>
    createTicketSchema.parse({
      subject: 'Wrong order delivered',
      description: 'I ordered oat milk and got soy.',
      requesterName: 'Rita Regular',
      requesterEmail: mail('RITA'),
      priority: 'high',
      ...extra,
    });

  it('sets the first-reply target from the priority', () => {
    const from = new Date('2031-01-01T00:00:00Z');
    expect(responseDueAt(from, 'urgent').toISOString()).toBe('2031-01-01T01:00:00.000Z');
    expect(responseDueAt(from, 'low').toISOString()).toBe('2031-01-04T00:00:00.000Z');
  });

  it('numbers tickets per business and ties them to a known customer', async () => {
    const first = await createTicket(owner, ticket());
    const second = await createTicket(
      member,
      ticket({ subject: 'Second one', requesterEmail: '' }),
    );
    const elsewhere = await createTicket(betaOwner, ticket());
    expect([first.number, second.number, elsewhere.number]).toEqual([1, 2, 1]);
    ticketId = first.id;
    const saved = await getTicket(owner, ticketId);
    expect(saved).toMatchObject({ status: 'open', priority: 'high', source: 'manual' });
    expect(saved?.contactId).not.toBeNull();
    expect(saved?.messages.map((message) => message.body)).toEqual([
      'I ordered oat milk and got soy.',
    ]);
  });

  it('two tickets created at once never share a number', async () => {
    const created = await Promise.all(
      [1, 2, 3, 4].map((n) => createTicket(owner, ticket({ subject: `Rush ${n}` }))),
    );
    expect(new Set(created.map((row) => row.number)).size).toBe(4);
  });

  it('another business cannot see, answer, change or delete a ticket', async () => {
    expect(await getTicket(betaOwner, ticketId)).toBeNull();
    expect((await listTickets(betaOwner, { queue: 'all' })).map((row) => row.number)).toEqual([1]);
    const reply = replySchema.parse({ ticketId, body: 'Hello from elsewhere' });
    expect(await code(replyToTicket(betaOwner, reply))).toBe('NOT_FOUND');
    expect(await code(updateTicket(betaOwner, { id: ticketId, status: 'closed' }))).toBe(
      'NOT_FOUND',
    );
    expect(await code(deleteTicket(betaOwner, ticketId))).toBe('NOT_FOUND');
    const raw = await withRls(betaOwner, (tx) =>
      tx.select({ id: ticketMessages.id }).from(ticketMessages),
    );
    expect(raw).toHaveLength(1);
  });

  it('a reply records the first response, takes the ticket, and waits on the customer', async () => {
    expect((await getTicketCounts(owner)).unassigned).toBeGreaterThan(0);
    const result = await replyToTicket(
      member,
      replySchema.parse({ ticketId, body: 'Sorry! Replacing it now.' }),
    );
    expect(result.emailed).toBe(false);
    const saved = await getTicket(owner, ticketId);
    expect(saved).toMatchObject({ status: 'pending', assigneeUserId: member.userId });
    expect(saved?.firstResponseAt).not.toBeNull();
    customerToken = saved!.publicToken;
  });

  it('nobody can write a message in someone else’s name, even straight at the database', async () => {
    await expect(
      withRls(member, (tx) =>
        tx.insert(ticketMessages).values({
          tenantId: alphaTenant,
          ticketId,
          authorUserId: owner.userId,
          authorName: 'The Owner',
          body: 'Forged',
        }),
      ),
    ).rejects.toThrow();
    await expect(
      withRls(member, (tx) =>
        tx.insert(ticketMessages).values({
          tenantId: alphaTenant,
          ticketId,
          authorUserId: null,
          authorName: 'Rita Regular',
          body: 'Forged customer message',
        }),
      ),
    ).rejects.toThrow();
  });

  it('the customer never sees private notes, and their reply reopens the ticket', async () => {
    await replyToTicket(
      owner,
      replySchema.parse({ ticketId, body: 'Refund approved by Dana', isInternal: true }),
    );
    const view = await getPublicTicket(customerToken);
    expect(view?.messages.map((message) => [message.fromStaff, message.body])).toEqual([
      [false, 'I ordered oat milk and got soy.'],
      [true, 'Sorry! Replacing it now.'],
    ]);
    expect(JSON.stringify(view)).not.toContain('Refund approved');
    expect((await getTicket(owner, ticketId))?.status).toBe('pending');

    await replyAsCustomer(customerToken, 'Thank you, received.');
    expect((await getTicket(owner, ticketId))?.status).toBe('open');
    expect(await getPublicTicket('wrong-token-wrong-token')).toBeNull();
    expect(await code(replyAsCustomer('wrong-token-wrong-token', 'hi'))).toBe('NOT_FOUND');
  });

  it('solving, closing and reopening keep the right timestamps; a closed ticket takes no replies', async () => {
    await updateTicket(owner, { id: ticketId, status: 'solved' });
    expect((await getTicket(owner, ticketId))?.solvedAt).not.toBeNull();
    await updateTicket(owner, { id: ticketId, status: 'closed' });
    expect(await code(replyAsCustomer(customerToken, 'One more thing'))).toBe('CONFLICT');
    expect(
      await code(replyToTicket(owner, replySchema.parse({ ticketId, body: 'Late reply' }))),
    ).toBe('CONFLICT');
    await updateTicket(owner, { id: ticketId, status: 'open' });
    expect((await getTicket(owner, ticketId))?.solvedAt).toBeNull();
  });

  it('a ticket cannot be assigned to someone outside the business', async () => {
    expect(
      await code(updateTicket(owner, { id: ticketId, assigneeUserId: betaOwner.userId })),
    ).toBe('VALIDATION');
    await updateTicket(owner, { id: ticketId, assigneeUserId: null });
    expect((await getTicket(owner, ticketId))?.assigneeUserId).toBeNull();
  });

  it('the public form is off until a manager switches it on', async () => {
    expect(await getHelpdeskForm(owner)).toBeNull();
    expect(await code(setFormOpen(member, true))).toBe('FORBIDDEN');
    await setFormOpen(owner, true);
    formToken = (await getHelpdeskForm(owner))!.publicToken;
    expect(await getPublicForm(formToken)).toEqual({ businessName: owner.tenant.name });
  });

  it('a customer raises a ticket from the form and can follow it', async () => {
    const input = publicTicketSchema.parse({
      requesterName: 'Nico New',
      requesterEmail: mail('Nico'),
      subject: 'Do you cater?',
      description: 'Looking for catering for forty people in March.',
    });
    const created = await submitPublicTicket(formToken, input);
    const view = await getPublicTicket(created.ticketToken);
    expect(view).toMatchObject({
      number: created.number,
      subject: 'Do you cater?',
      status: 'open',
    });
    const [row] = await listTickets(owner, { queue: 'open', q: `#${created.number}` });
    expect(row).toMatchObject({
      source: 'web_form',
      requesterEmail: mail('nico'),
      assigneeName: null,
    });

    await setFormOpen(owner, false);
    expect(await getPublicForm(formToken)).toBeNull();
    expect(await code(submitPublicTicket(formToken, input))).toBe('NOT_FOUND');
  });

  it('only a manager deletes a ticket', async () => {
    expect(await code(deleteTicket(member, ticketId))).toBe('FORBIDDEN');
    await deleteTicket(owner, ticketId);
    expect(await getTicket(owner, ticketId)).toBeNull();
    expect(await getPublicTicket(customerToken)).toBeNull();
    const raw = await withRls(owner, (tx) => tx.select({ id: tickets.id }).from(tickets));
    expect(raw.length).toBeGreaterThan(0);
  });
});
