import { z } from 'zod';

import { notFound, pdfResponse } from '@/modules/esign/pdf-response';
import { readRequestDocument } from '@/modules/esign/service';
import { getTenantContext, hasPermission, workspaceClosedReason } from '@/server/context';

const paramsSchema = z.object({ id: z.uuid() });

/** The original PDF of a signature request, for the field editor and the request page. */
export async function GET(
  _request: Request,
  { params }: RouteContext<'/api/esign/requests/[id]/document'>,
) {
  const parsed = paramsSchema.safeParse(await params);
  const ctx = await getTenantContext();
  if (
    !parsed.success ||
    !ctx ||
    workspaceClosedReason(ctx) ||
    !hasPermission(ctx, 'files.request_signatures')
  ) {
    return notFound();
  }
  const file = await readRequestDocument(ctx, parsed.data.id).catch(() => null);
  return file ? pdfResponse(file, false) : notFound();
}
