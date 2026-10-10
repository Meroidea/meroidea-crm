import { NextResponse } from 'next/server';

import { submitReview } from '@/modules/reviews/public';
import { submitReviewSchema } from '@/modules/reviews/schemas';
import { clientAddress, publicErrorResponse, readJsonBody } from '@/server/request';

const MAX_BODY_BYTES = 16 * 1024;

/**
 * Public web-form intake for a customer review. No session: the link's unguessable address is
 * what authorises writing one review to it.
 */
export async function POST(request: Request, { params }: RouteContext<'/api/reviews/[token]'>) {
  const { token } = await params;
  try {
    const body = await readJsonBody(request, MAX_BODY_BYTES);
    // A field people never see; anything that fills it in is a script. Answer as if it worked.
    if (body.website) return NextResponse.json({ ok: true });
    await submitReview(token, submitReviewSchema.parse(body), clientAddress(request.headers));
    return NextResponse.json({ ok: true });
  } catch (error) {
    return publicErrorResponse(error);
  }
}
