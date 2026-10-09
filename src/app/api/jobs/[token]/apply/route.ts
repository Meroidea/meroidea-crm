import { NextResponse } from 'next/server';

import { toActionError } from '@/lib/errors';
import { submitApplication } from '@/modules/recruitment/public';
import { MAX_RESUME_BYTES } from '@/modules/recruitment/resumes';
import { applicantFieldsSchema } from '@/modules/recruitment/schemas';

/**
 * Public web-form intake for a job application (multipart, so a résumé can come with it).
 * No session: the job's unguessable address is what authorises writing one application to it.
 */
export async function POST(request: Request, { params }: RouteContext<'/api/jobs/[token]/apply'>) {
  const { token } = await params;
  try {
    const length = Number(request.headers.get('content-length') ?? 0);
    if (length > MAX_RESUME_BYTES + 64 * 1024) {
      return NextResponse.json(
        { ok: false, error: { code: 'VALIDATION', message: 'The résumé can be up to 5 MB.' } },
        { status: 413 },
      );
    }
    const form = await request.formData();
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
    await submitApplication(token, fields, resume);
    return NextResponse.json({ ok: true });
  } catch (error) {
    const mapped = toActionError(error);
    const status = mapped.code === 'NOT_FOUND' ? 404 : mapped.code === 'INTERNAL' ? 500 : 400;
    return NextResponse.json({ ok: false, error: mapped }, { status });
  }
}
