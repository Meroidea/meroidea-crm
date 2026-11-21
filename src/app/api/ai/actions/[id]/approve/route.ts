import { approvePendingAction } from '@/modules/assistant/pending';
import { authedRoute, jsonOk, routeId } from '@/server/authed-route';

/** A staff email to many people is sent one by one. */
export const maxDuration = 60;

/**
 * Approve & Execute (ADR-064): only the person who asked, in the same business, before it lapses,
 * and once. The module's own service then checks the permission for the change itself.
 */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  return authedRoute(request, async (ctx) =>
    jsonOk(await approvePendingAction(ctx, await routeId(params))),
  );
}
