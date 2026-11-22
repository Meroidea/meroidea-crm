import { NextResponse } from 'next/server';

import { getPublicPortal, recordArticleView } from '@/modules/kb/public';
import { viewSchema } from '@/modules/kb/schemas';
import { clientAddress, publicErrorResponse, readJsonBody } from '@/server/request';

const MAX_BODY_BYTES = 2 * 1024;

/**
 * An article page reports it was shown in a browser (ADR-071): the read count, and a known
 * customer's read when the page came from a link sent to them. No session; the portal's slug
 * and the article's address decide everything, and nothing is said back about either.
 */
export async function POST(request: Request, { params }: RouteContext<'/api/help/[slug]/view'>) {
  const { slug } = await params;
  try {
    const parsed = viewSchema.safeParse(await readJsonBody(request, MAX_BODY_BYTES));
    const portal = parsed.success ? await getPublicPortal(slug) : null;
    if (portal && parsed.success) {
      await recordArticleView(portal, parsed.data, clientAddress(request.headers));
    }
    return NextResponse.json({ ok: true, data: null });
  } catch (error) {
    return publicErrorResponse(error);
  }
}
