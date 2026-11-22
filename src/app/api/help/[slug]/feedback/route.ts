import { NextResponse } from 'next/server';

import { AppError } from '@/lib/errors';
import { getPublicPortal, submitArticleFeedback } from '@/modules/kb/public';
import { feedbackSchema } from '@/modules/kb/schemas';
import { clientAddress, publicErrorResponse, readJsonBody } from '@/server/request';

const MAX_BODY_BYTES = 8 * 1024;

/** "Was this helpful?" from the public portal (ADR-071). No session: the portal's slug decides. */
export async function POST(
  request: Request,
  { params }: RouteContext<'/api/help/[slug]/feedback'>,
) {
  const { slug } = await params;
  try {
    const body = await readJsonBody(request, MAX_BODY_BYTES);
    // A field people never see; anything that fills it in is a script. Answer as if it worked.
    if (body.website) return NextResponse.json({ ok: true, data: null });
    const portal = await getPublicPortal(slug);
    if (!portal) throw new AppError('NOT_FOUND', 'This help centre is not available.');
    await submitArticleFeedback(portal, feedbackSchema.parse(body), clientAddress(request.headers));
    return NextResponse.json({ ok: true, data: null });
  } catch (error) {
    return publicErrorResponse(error);
  }
}
