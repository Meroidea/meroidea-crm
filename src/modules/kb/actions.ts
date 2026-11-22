'use server';

import { authedAction } from '@/server/action';

import { searchPublishedArticles } from './queries';
import {
  articleLinkSchema,
  articleSchema,
  articleSearchSchema,
  categorySchema,
  idSchema,
  portalSchema,
} from './schemas';
import * as kb from './service';

const paths = ['/kb'];

export const saveArticleAction = authedAction(
  { permission: 'kb.manage', input: articleSchema, revalidate: paths },
  (ctx, input) => kb.saveArticle(ctx, input),
);
export const deleteArticleAction = authedAction(
  { permission: 'kb.manage', input: idSchema, revalidate: paths },
  (ctx, input) => kb.deleteArticle(ctx, input.id),
);
export const saveCategoryAction = authedAction(
  { permission: 'kb.manage', input: categorySchema, revalidate: paths },
  (ctx, input) => kb.saveCategory(ctx, input),
);
export const deleteCategoryAction = authedAction(
  { permission: 'kb.manage', input: idSchema, revalidate: paths },
  (ctx, input) => kb.deleteCategory(ctx, input.id),
);
export const savePortalAction = authedAction(
  { permission: 'kb.manage', input: portalSchema, revalidate: paths },
  (ctx, input) => kb.savePortal(ctx, input),
);

/** Published articles to link from a reply; the service checks who may send them. */
export const searchArticlesAction = authedAction(
  { permission: null, input: articleSearchSchema },
  (ctx, input) => searchPublishedArticles(ctx, input.q),
);

/** A link to an article for a reply in a conversation or on a ticket (ADR-071). */
export const createArticleLinkAction = authedAction(
  { permission: null, input: articleLinkSchema },
  (ctx, input) => kb.createArticleLink(ctx, input),
);
