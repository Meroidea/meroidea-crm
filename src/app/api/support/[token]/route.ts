import { NextResponse } from 'next/server';

import { toActionError } from '@/lib/errors';
import { submitPublicTicket } from '@/modules/helpdesk/public';
import { publicTicketSchema } from '@/modules/helpdesk/schemas';

/** Public web-form intake for a support request. No session: the form's address authorises it. */
export async function POST(request: Request, { params }: RouteContext<'/api/support/[token]'>) {
  const { token } = await params;
  try {
    if (Number(request.headers.get('content-length') ?? 0) > 32 * 1024) {
      return NextResponse.json({ ok: false }, { status: 413 });
    }
    const body = (await request.json()) as Record<string, unknown>;
    // A field people never see; anything that fills it in is a script. Answer as if it worked.
    if (body.website) return NextResponse.json({ ok: true, data: null });
    const data = await submitPublicTicket(token, publicTicketSchema.parse(body));
    return NextResponse.json({ ok: true, data });
  } catch (error) {
    const mapped =
      error instanceof SyntaxError
        ? { code: 'VALIDATION' as const, message: 'That could not be read. Try again.' }
        : toActionError(error);
    const status = mapped.code === 'NOT_FOUND' ? 404 : mapped.code === 'INTERNAL' ? 500 : 400;
    return NextResponse.json({ ok: false, error: mapped }, { status });
  }
}
