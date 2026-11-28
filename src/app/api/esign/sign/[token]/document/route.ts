import { cookies } from 'next/headers';

import { notFound, pdfResponse } from '@/modules/esign/pdf-response';
import { readSignerDocument } from '@/modules/esign/public';

/**
 * The document a signer may see: the original while it is out, the signed copy once complete.
 * The link's secret is the credential, plus the session cookie when an emailed code is required.
 */
export async function GET(
  request: Request,
  { params }: RouteContext<'/api/esign/sign/[token]/document'>,
) {
  const { token } = await params;
  if (!/^[A-Za-z0-9_-]{40,50}$/.test(token)) return notFound();
  const store = await cookies();
  const file = await readSignerDocument(token, (name) => store.get(name)?.value).catch(() => null);
  if (!file) return notFound();
  return pdfResponse(file, new URL(request.url).searchParams.get('download') === '1');
}
