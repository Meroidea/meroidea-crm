import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { POST as feedbackRoute } from '@/app/api/help/[slug]/feedback/route';
import { POST as viewRoute } from '@/app/api/help/[slug]/view/route';
import { AppError } from '@/lib/errors';
import { anonymizeContact } from '@/modules/contacts/privacy';
import { getPublicArticle, getPublicPortal, listPublicArticles } from '@/modules/kb/public';
import {
  articleViewsForContact,
  getArticle,
  listCategories,
  listArticles,
  searchPublishedArticles,
} from '@/modules/kb/queries';
import { createArticleLink, saveArticle, saveCategory, savePortal } from '@/modules/kb/service';
import type { TenantContext } from '@/server/context';
import { adminDb } from '@/server/db/admin';
import { withRls } from '@/server/db/with-rls';

import { addMember, contextFor, createWorkspace, destroyWorkspace } from '../support/workspaces';

// Knowledge base (ADR-071): editing, the public portal, feedback and tracked links. The database,
// row-level security, the public routes and the services are the real ones.

const stamp = Date.now();
const mail = (name: string) => `${name}-${stamp}@example.com`;

let tenantId: string;
let tenantSlug: string;
let otherTenant: string;
const users: string[] = [];
const otherUsers: string[] = [];
let owner: TenantContext;
let manager: TenantContext;
let staff: TenantContext;
let outsider: TenantContext;
let publishedId: string;
let draftId: string;
let contactId: string;
let ticketId: string;

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

async function sqlState(run: () => Promise<unknown>): Promise<string> {
  try {
    await run();
  } catch (error) {
    const wrapped = error as { code?: string; cause?: { code?: string } };
    return wrapped.cause?.code ?? wrapped.code ?? 'unknown';
  }
  return 'OK';
}

let sender = 0;
type PublicRoute = (
  request: Request,
  context: { params: Promise<{ slug: string }> },
) => Promise<Response>;

function post(
  route: PublicRoute,
  slug: string,
  path: 'view' | 'feedback',
  body: unknown,
): Promise<Response> {
  sender += 1;
  return route(
    new Request(`http://localhost:3000/api/help/${slug}/${path}`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-forwarded-for': `203.0.113.${sender % 250}`,
      },
      body: JSON.stringify(body),
    }),
    { params: Promise.resolve({ slug }) },
  );
}

beforeAll(async () => {
  const one = await createWorkspace(`KB Co ${stamp}`, mail('kb-owner'));
  tenantId = one.tenantId;
  users.push(one.ownerId);
  const two = await createWorkspace(`KB Other ${stamp}`, mail('kb-other'));
  otherTenant = two.tenantId;
  otherUsers.push(two.ownerId);
  const managerId = await addMember(tenantId, mail('kb-manager'), 'Morgan Manager', 'manager');
  const staffId = await addMember(tenantId, mail('kb-staff'), 'Sky Staff', 'member');
  users.push(managerId, staffId);
  owner = await contextFor(one.ownerId, tenantId);
  manager = await contextFor(managerId, tenantId);
  staff = await contextFor(staffId, tenantId);
  outsider = await contextFor(two.ownerId, otherTenant);
  tenantSlug = owner.tenant.slug;
  const [contact] = await rows<{ id: string }>(sql`
    insert into contacts (tenant_id, first_name, owner_user_id)
    values (${tenantId}, 'Robin', ${managerId}) returning id`);
  contactId = contact!.id;
  const [ticket] = await rows<{ id: string }>(sql`
    insert into tickets (tenant_id, number, subject, requester_name, contact_id, public_token, response_due_at)
    values (${tenantId}, 1, 'Booking question', 'Robin', ${contactId}, ${`tok-${stamp}`}, now() + interval '1 day')
    returning id`);
  ticketId = ticket!.id;
});

afterAll(async () => {
  await destroyWorkspace(tenantId, users);
  await destroyWorkspace(otherTenant, otherUsers);
});

describe('writing articles', () => {
  it('needs kb.manage', async () => {
    await expectCode(
      () =>
        saveArticle(staff, {
          title: 'X',
          bodyMarkdown: 'x',
          status: 'draft',
          categoryId: null,
          summary: null,
        }),
      'FORBIDDEN',
    );
  });

  it('makes the address from the title, unique within the business', async () => {
    const { id: categoryId } = await saveCategory(manager, {
      name: 'Bookings',
      description: null,
      position: 0,
    });
    const published = await saveArticle(manager, {
      title: 'How do I change my booking?',
      categoryId,
      summary: 'Change the date or the number of people.',
      bodyMarkdown: '## Online\n\nOpen your **confirmation** email.',
      status: 'published',
    });
    publishedId = published.id;
    expect(published.slug).toBe('how-do-i-change-my-booking');
    const draft = await saveArticle(manager, {
      title: 'Secret upcoming menu',
      categoryId: null,
      summary: null,
      bodyMarkdown: 'Not yet.',
      status: 'draft',
    });
    draftId = draft.id;
    await expectCode(
      () =>
        saveArticle(manager, {
          title: 'How do I change my booking?',
          categoryId: null,
          summary: null,
          bodyMarkdown: 'again',
          status: 'draft',
        }),
      'DUPLICATE',
    );
    // Another business may use the same address.
    await saveArticle(outsider, {
      title: 'How do I change my booking?',
      categoryId: null,
      summary: null,
      bodyMarkdown: 'theirs',
      status: 'published',
    });
  });

  it('refuses another business’s category', async () => {
    const { id: theirs } = await saveCategory(outsider, {
      name: 'Theirs',
      description: null,
      position: 0,
    });
    await expectCode(
      () =>
        saveArticle(manager, {
          title: 'Wrong category',
          categoryId: theirs,
          summary: null,
          bodyMarkdown: '',
          status: 'draft',
        }),
      'VALIDATION',
    );
  });

  it('keeps read counts and feedback tallies out of editors’ hands', async () => {
    expect(
      await sqlState(() =>
        withRls(manager, (tx) =>
          tx.execute(sql`update kb_articles set view_count = 9999 where id = ${publishedId}`),
        ),
      ),
    ).toBe('42501');
  });
});

describe('categories', () => {
  it('count their live articles', async () => {
    const categories = await listCategories(manager);
    expect(categories.find((category) => category.name === 'Bookings')?.articles).toBe(1);
  });
});

describe('who sees what', () => {
  it('people who answer customers find published articles, never drafts', async () => {
    const found = await searchPublishedArticles(staff, '');
    expect(found.map((item) => item.id)).toContain(publishedId);
    expect(found.map((item) => item.id)).not.toContain(draftId);
    const direct = await withRls(staff, (tx) =>
      tx.execute(sql`select id from kb_articles where id = ${draftId}`),
    );
    expect(direct).toHaveLength(0);
  });

  it('searches the words of articles', async () => {
    const found = await searchPublishedArticles(staff, 'confirmation');
    expect(found.map((item) => item.id)).toEqual([publishedId]);
  });

  it('another business sees none of it', async () => {
    expect((await listArticles(outsider)).map((item) => item.id)).not.toContain(publishedId);
    expect(await getArticle(outsider, publishedId)).toBeNull();
    const direct = await withRls(outsider, (tx) =>
      tx.execute(sql`select id from kb_articles where tenant_id = ${tenantId}`),
    );
    expect(direct).toHaveLength(0);
  });
});

describe('the public portal', () => {
  it('is closed until the business opens it', async () => {
    expect(await getPublicPortal(tenantSlug)).toBeNull();
    await savePortal(manager, { isPublic: true, title: 'Help centre', intro: null });
    expect((await getPublicPortal(tenantSlug))?.title).toBe('Help centre');
  });

  it('shows published articles only', async () => {
    const portal = (await getPublicPortal(tenantSlug))!;
    const { articles } = await listPublicArticles(portal);
    expect(articles.map((item) => item.slug)).toEqual(['how-do-i-change-my-booking']);
    expect(await getPublicArticle(portal, 'secret-upcoming-menu')).toBeNull();
    const searched = await listPublicArticles(portal, 'secret');
    expect(searched.articles).toHaveLength(0);
  });

  it('closes again while the feature is switched off', async () => {
    await adminDb().execute(
      sql`update tenants set features = array_remove(features, 'knowledge_base') where id = ${tenantId}`,
    );
    try {
      expect(await getPublicPortal(tenantSlug)).toBeNull();
    } finally {
      await adminDb().execute(
        sql`update tenants set features = features || array['knowledge_base'] where id = ${tenantId}`,
      );
    }
  });

  it('takes "Was this helpful?", ignoring scripts that fill the hidden field', async () => {
    const article = 'how-do-i-change-my-booking';
    expect(
      (
        await post(feedbackRoute, tenantSlug, 'feedback', {
          article,
          helpful: false,
          comment: 'Spam',
          website: 'x',
        })
      ).status,
    ).toBe(200);
    expect(
      (
        await post(feedbackRoute, tenantSlug, 'feedback', {
          article,
          helpful: true,
          comment: 'ignored',
        })
      ).status,
    ).toBe(200);
    expect(
      (
        await post(feedbackRoute, tenantSlug, 'feedback', {
          article,
          helpful: false,
          comment: 'No phone number',
        })
      ).status,
    ).toBe(200);
    const [counts] = await rows<{ helpful_count: number; not_helpful_count: number }>(
      sql`select helpful_count, not_helpful_count from kb_articles where id = ${publishedId}`,
    );
    expect(counts).toEqual({ helpful_count: 1, not_helpful_count: 1 });
    const comments = await rows<{ comment: string | null }>(
      sql`select comment from kb_article_feedback where article_id = ${publishedId} order by created_at`,
    );
    expect(comments.map((row) => row.comment)).toEqual([null, 'No phone number']);
    // A draft takes no feedback.
    expect(
      (
        await post(feedbackRoute, tenantSlug, 'feedback', {
          article: 'secret-upcoming-menu',
          helpful: true,
        })
      ).status,
    ).toBe(404);
  });
});

describe('tracked links', () => {
  let token: string;

  it('a link sent on a known customer’s ticket carries a token, stored only as a hash', async () => {
    const link = await createArticleLink(staff, { articleId: publishedId, ticketId });
    expect(link.tracked).toBe(true);
    const url = new URL(link.url);
    expect(url.pathname).toBe(`/help/${tenantSlug}/how-do-i-change-my-booking`);
    token = url.searchParams.get('r')!;
    expect(token).toMatch(/^[A-Za-z0-9_-]{32}$/);
    const stored = await rows<{ token_hash: string }>(
      sql`select token_hash from kb_article_links where tenant_id = ${tenantId}`,
    );
    expect(stored.map((row) => row.token_hash)).not.toContain(token);
  });

  it('cannot link a draft, another business’s ticket, or while the portal is closed', async () => {
    await expectCode(() => createArticleLink(staff, { articleId: draftId, ticketId }), 'NOT_FOUND');
    await expectCode(
      () => createArticleLink(outsider, { articleId: publishedId, ticketId }),
      'NOT_FOUND',
    );
    await savePortal(manager, { isPublic: false, title: 'Help centre', intro: null });
    await expectCode(
      () => createArticleLink(staff, { articleId: publishedId, ticketId }),
      'CONFLICT',
    );
    await savePortal(manager, { isPublic: true, title: 'Help centre', intro: null });
  });

  it('opening it records the customer’s read, once a day', async () => {
    const article = 'how-do-i-change-my-booking';
    await post(viewRoute, tenantSlug, 'view', { article, ref: token });
    await post(viewRoute, tenantSlug, 'view', { article, ref: token });
    const reads = await rows<{ contact_id: string }>(
      sql`select contact_id from kb_article_views where tenant_id = ${tenantId}`,
    );
    expect(reads).toEqual([{ contact_id: contactId }]);
    const [counts] = await rows<{ view_count: number }>(
      sql`select view_count from kb_articles where id = ${publishedId}`,
    );
    expect(counts?.view_count).toBe(2);
  });

  it('a token is worthless on another article or another business’s portal', async () => {
    await savePortal(outsider, { isPublic: true, title: null, intro: null });
    await post(viewRoute, outsider.tenant.slug, 'view', {
      article: 'how-do-i-change-my-booking',
      ref: token,
    });
    const theirs = await rows(sql`select 1 from kb_article_views where tenant_id = ${otherTenant}`);
    expect(theirs).toHaveLength(0);
    const ours = await rows(sql`select 1 from kb_article_views where tenant_id = ${tenantId}`);
    expect(ours).toHaveLength(1);
  });

  it('shows on the contact’s timeline for their business only', async () => {
    const reads = await articleViewsForContact(manager, contactId);
    expect(reads.map((read) => read.title)).toEqual(['How do I change my booking?']);
    expect(await articleViewsForContact(outsider, contactId)).toEqual([]);
  });

  it('erasing the person removes what they read', async () => {
    await anonymizeContact(owner, contactId);
    const left = await rows(sql`
      select 1 from kb_article_views where contact_id = ${contactId}
      union all select 1 from kb_article_links where contact_id = ${contactId}`);
    expect(left).toHaveLength(0);
  });
});
