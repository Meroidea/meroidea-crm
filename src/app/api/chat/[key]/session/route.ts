import { NextResponse } from 'next/server';

import { startChatSession } from '@/modules/social/livechat-public';
import { chatSessionSchema } from '@/modules/social/livechat-schemas';
import { clientAddress, publicErrorResponse, readJsonBody } from '@/server/request';

const MAX_BODY_BYTES = 4 * 1024;
const NO_STORE = { 'Cache-Control': 'no-store' };

/**
 * Starts or resumes a visitor's live chat (ADR-072). No session: the widget's public key decides
 * the business, and the visitor's token, which only they hold, decides the chat.
 */
export async function POST(request: Request, { params }: RouteContext<'/api/chat/[key]/session'>) {
  const { key } = await params;
  try {
    const body = await readJsonBody(request, MAX_BODY_BYTES);
    // A field people never see; anything that fills it in is a script.
    if (body.website) {
      return NextResponse.json(
        { ok: false, error: { code: 'VALIDATION', message: 'Try again.' } },
        { status: 400 },
      );
    }
    const data = await startChatSession(
      key,
      chatSessionSchema.parse(body),
      clientAddress(request.headers),
    );
    return NextResponse.json({ ok: true, data }, { headers: NO_STORE });
  } catch (error) {
    return publicErrorResponse(error);
  }
}
