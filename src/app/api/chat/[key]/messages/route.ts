import { NextResponse, type NextRequest } from 'next/server';

import { listVisitorMessages, postVisitorMessage } from '@/modules/social/livechat-public';
import { chatMessageSchema, chatPollSchema } from '@/modules/social/livechat-schemas';
import { clientAddress, publicErrorResponse, readJsonBody } from '@/server/request';

const MAX_BODY_BYTES = 12 * 1024;
const NO_STORE = { 'Cache-Control': 'no-store' };

/**
 * A visitor's live chat messages (ADR-072). Their token travels in a header or the body, never in
 * the address, so it stays out of logs and caches.
 */
export async function GET(
  request: NextRequest,
  { params }: RouteContext<'/api/chat/[key]/messages'>,
) {
  const { key } = await params;
  try {
    const input = chatPollSchema.parse({
      token: request.headers.get('x-chat-token') ?? undefined,
      after: request.nextUrl.searchParams.get('after') ?? undefined,
    });
    const data = await listVisitorMessages(key, input);
    return NextResponse.json({ ok: true, data }, { headers: NO_STORE });
  } catch (error) {
    return publicErrorResponse(error);
  }
}

export async function POST(request: Request, { params }: RouteContext<'/api/chat/[key]/messages'>) {
  const { key } = await params;
  try {
    const body = await readJsonBody(request, MAX_BODY_BYTES);
    const data = await postVisitorMessage(
      key,
      chatMessageSchema.parse(body),
      clientAddress(request.headers),
    );
    return NextResponse.json({ ok: true, data }, { headers: NO_STORE });
  } catch (error) {
    return publicErrorResponse(error);
  }
}
