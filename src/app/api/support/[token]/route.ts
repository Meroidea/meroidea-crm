import { NextResponse } from 'next/server';

import { submitPublicTicket } from '@/modules/helpdesk/public';
import { publicTicketSchema } from '@/modules/helpdesk/schemas';
import { clientAddress, publicErrorResponse, readJsonBody } from '@/server/request';

const MAX_BODY_BYTES = 32 * 1024;

/** Public web-form intake for a support request. No session: the form's address authorises it. */
export async function POST(request: Request, { params }: RouteContext<'/api/support/[token]'>) {
  const { token } = await params;
  try {
    const body = await readJsonBody(request, MAX_BODY_BYTES);
    // A field people never see; anything that fills it in is a script. Answer as if it worked.
    if (body.website) return NextResponse.json({ ok: true, data: null });
    const data = await submitPublicTicket(
      token,
      publicTicketSchema.parse(body),
      clientAddress(request.headers),
    );
    return NextResponse.json({ ok: true, data });
  } catch (error) {
    return publicErrorResponse(error);
  }
}
