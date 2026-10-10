import { NextResponse } from 'next/server';

import { replyAsCustomer } from '@/modules/helpdesk/public';
import { publicReplySchema } from '@/modules/helpdesk/schemas';
import { publicErrorResponse, readJsonBody } from '@/server/request';

const MAX_BODY_BYTES = 32 * 1024;

/** A customer's reply on their own ticket. No session: the ticket's address authorises it. */
export async function POST(
  request: Request,
  { params }: RouteContext<'/api/support/ticket/[token]'>,
) {
  const { token } = await params;
  try {
    const { body } = publicReplySchema.parse(await readJsonBody(request, MAX_BODY_BYTES));
    await replyAsCustomer(token, body);
    return NextResponse.json({ ok: true });
  } catch (error) {
    return publicErrorResponse(error);
  }
}
