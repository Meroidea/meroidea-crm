import { NextResponse } from 'next/server';

import { submitApplication } from '@/modules/recruitment/public';
import { MAX_RESUME_BYTES } from '@/modules/recruitment/resumes';
import { applicantFieldsSchema } from '@/modules/recruitment/schemas';
import {
  clientAddress,
  PayloadTooLargeError,
  publicErrorResponse,
  readFormBody,
} from '@/server/request';

/** The résumé plus room for the text fields and multipart framing. */
const MAX_BODY_BYTES = MAX_RESUME_BYTES + 64 * 1024;

/**
 * Public web-form intake for a job application (multipart, so a résumé can come with it).
 * No session: the job's unguessable address is what authorises writing one application to it.
 */
export async function POST(request: Request, { params }: RouteContext<'/api/jobs/[token]/apply'>) {
  const { token } = await params;
  try {
    const form = await readFormBody(request, MAX_BODY_BYTES);
    // A field people never see; anything that fills it in is a script. Answer as if it worked.
    if (form.get('website')) return NextResponse.json({ ok: true });

    const text = (name: string) => {
      const value = form.get(name);
      return typeof value === 'string' ? value : '';
    };
    const fields = applicantFieldsSchema.parse({
      fullName: text('fullName'),
      email: text('email'),
      phone: text('phone'),
      coverNote: text('coverNote'),
    });
    const file = form.get('resume');
    const resume =
      file instanceof File && file.size > 0
        ? { name: file.name, bytes: Buffer.from(await file.arrayBuffer()) }
        : null;
    await submitApplication(token, fields, resume, clientAddress(request.headers));
    return NextResponse.json({ ok: true });
  } catch (error) {
    if (error instanceof PayloadTooLargeError) {
      return NextResponse.json(
        { ok: false, error: { code: 'VALIDATION', message: 'The résumé can be up to 5 MB.' } },
        { status: 413 },
      );
    }
    return publicErrorResponse(error);
  }
}
