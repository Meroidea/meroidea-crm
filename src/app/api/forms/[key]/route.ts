import { NextResponse } from 'next/server';

import { submitWebForm } from '@/modules/leads/public';
import { clientAddress, publicErrorResponse, readFormBody, readJsonBody } from '@/server/request';

const MAX_BODY_BYTES = 32 * 1024;

/** A plain HTML form's fields; a name sent more than once (a multi-choice) becomes a list. */
function formFields(data: FormData): Record<string, unknown> {
  const body: Record<string, unknown> = {};
  for (const name of new Set(data.keys())) {
    const values = data.getAll(name).filter((value): value is string => typeof value === 'string');
    body[name] = values.length > 1 ? values : (values[0] ?? '');
  }
  return body;
}

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
    const body: Record<string, unknown> = isJson
      ? await readJsonBody(request, MAX_BODY_BYTES)
      : formFields(await readFormBody(request, MAX_BODY_BYTES));
    // A field people never see; anything that fills it in is a script. Answer as if it worked.
    if (body.website) return isJson ? NextResponse.json({ ok: true, data: null }) : back('sent');
    const data = await submitWebForm(key, body, clientAddress(request.headers));
    return isJson ? NextResponse.json({ ok: true, data }) : back('sent');
  } catch (error) {
    return isJson ? publicErrorResponse(error) : back('failed');
  }
}
