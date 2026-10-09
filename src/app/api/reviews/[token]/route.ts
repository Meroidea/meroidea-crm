import { NextResponse } from 'next/server';

import { toActionError } from '@/lib/errors';
import { submitReview } from '@/modules/reviews/public';
import { submitReviewSchema } from '@/modules/reviews/schemas';

/**
 * Public web-form intake for a customer review. No session: the link's unguessable address is
 * what authorises writing one review to it.
 */
export async function POST(request: Request, { params }: RouteContext<'/api/reviews/[token]'>) {
  const { token } = await params;
  try {
    if (Number(request.headers.get('content-length') ?? 0) > 16 * 1024) {
      return NextResponse.json({ ok: false }, { status: 413 });
    }
    const body = (await request.json()) as Record<string, unknown>;
    // A field people never see; anything that fills it in is a script. Answer as if it worked.
    if (body.website) return NextResponse.json({ ok: true });
    await submitReview(token, submitReviewSchema.parse(body));
    return NextResponse.json({ ok: true });
  } catch (error) {
    const mapped =
      error instanceof SyntaxError
        ? { code: 'VALIDATION' as const, message: 'That could not be read. Try again.' }
        : toActionError(error);
    const status = mapped.code === 'NOT_FOUND' ? 404 : mapped.code === 'INTERNAL' ? 500 : 400;
    return NextResponse.json({ ok: false, error: mapped }, { status });
  }
}
