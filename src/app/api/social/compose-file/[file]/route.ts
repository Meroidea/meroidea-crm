import { z } from 'zod';

import { serveSocialMedia } from '@/modules/social/media-route';
import { composeFilePath } from '@/modules/social/service';

const paramsSchema = z.object({ file: z.string().regex(/^[0-9a-f-]{36}\.[a-z0-9]{1,8}$/) });

/**
 * A picture the signed-in person put in an email they are writing, a draft or their signature
 * (ADR-091), shown back to them in the editor. Only the file's name comes from the address: the
 * folder is always their own, so nobody can read another person's unsent files.
 */
export async function GET(
  _request: Request,
  { params }: RouteContext<'/api/social/compose-file/[file]'>,
) {
  const parsed = paramsSchema.safeParse(await params);
  if (!parsed.success) return new Response('Not found', { status: 404 });
  return serveSocialMedia(async (ctx) => composeFilePath(ctx, parsed.data.file));
}
