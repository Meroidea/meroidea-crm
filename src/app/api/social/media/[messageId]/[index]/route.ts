import { z } from 'zod';

import { serveSocialMedia } from '@/modules/social/media-route';
import { mediaPath } from '@/modules/social/queries';

const paramsSchema = z.object({
  messageId: z.uuid(),
  index: z.coerce.number().int().min(0).max(9),
});

/** A photo, video, voice note or file a customer sent, saved in our storage (ADR-065). */
export async function GET(
  _request: Request,
  { params }: RouteContext<'/api/social/media/[messageId]/[index]'>,
) {
  const parsed = paramsSchema.safeParse(await params);
  if (!parsed.success) return new Response('Not found', { status: 404 });
  return serveSocialMedia((ctx) => mediaPath(ctx, parsed.data.messageId, parsed.data.index));
}
