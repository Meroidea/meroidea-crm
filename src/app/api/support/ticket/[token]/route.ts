import { NextResponse } from 'next/server';

import { toActionError } from '@/lib/errors';
import { replyAsCustomer } from '@/modules/helpdesk/public';
import { publicReplySchema } from '@/modules/helpdesk/schemas';

/** A customer's reply on their own ticket. No session: the ticket's address authorises it. */
export async function POST(
  request: Request,
  { params }: RouteContext<'/api/support/ticket/[token]'>,
) {
  const { token } = await params;
  try {
    if (Number(request.headers.get('content-length') ?? 0) > 32 * 1024) {
      return NextResponse.json({ ok: false }, { status: 413 });
    }
    const { body } = publicReplySchema.parse(await request.json());
    await replyAsCustomer(token, body);
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
