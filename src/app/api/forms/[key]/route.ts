import { NextResponse } from 'next/server';

import { submitWebForm } from '@/modules/leads/public';
import { webFormSubmissionSchema } from '@/modules/leads/schemas';
import { clientAddress, publicErrorResponse, readFormBody, readJsonBody } from '@/server/request';

const MAX_BODY_BYTES = 32 * 1024;

/**
 * Public intake for a business's website form. No session: the form's unguessable key authorises
 * it. The hosted page sends JSON; a plain HTML form on the business's own site posts form fields
 * and is sent back to the hosted page's thank-you (or try-again) screen.
 */
export async function POST(request: Request, { params }: RouteContext<'/api/forms/[key]'>) {
  const { key } = await params;
  const isJson = (request.headers.get('content-type') ?? '').includes('application/json');
  const back = (outcome: 'sent' | 'failed') =>
    NextResponse.redirect(new URL(`/f/${encodeURIComponent(key)}?${outcome}=1`, request.url), 303);
  try {
    const body = isJson
      ? await readJsonBody(request, MAX_BODY_BYTES)
      : Object.fromEntries(
          [...(await readFormBody(request, MAX_BODY_BYTES)).entries()].flatMap(([name, value]) =>
            typeof value === 'string' ? [[name, value]] : [],
          ),
        );
    // A field people never see; anything that fills it in is a script. Answer as if it worked.
    if (body.website) return isJson ? NextResponse.json({ ok: true, data: null }) : back('sent');
    const data = await submitWebForm(
      key,
      webFormSubmissionSchema.parse(body),
      clientAddress(request.headers),
    );
    return isJson ? NextResponse.json({ ok: true, data }) : back('sent');
  } catch (error) {
    return isJson ? publicErrorResponse(error) : back('failed');
  }
}
