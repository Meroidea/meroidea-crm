import { z } from 'zod';

import { serveSocialMedia } from '@/modules/social/media-route';
import { avatarPath } from '@/modules/social/queries';

/** The customer's saved picture (ADR-065). */
export async function GET(
  _request: Request,
  { params }: RouteContext<'/api/social/avatar/[conversationId]'>,
) {
  const parsed = z.object({ conversationId: z.uuid() }).safeParse(await params);
  if (!parsed.success) return new Response('Not found', { status: 404 });
  return serveSocialMedia((ctx) => avatarPath(ctx, parsed.data.conversationId));
}
